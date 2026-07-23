import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Category, Entry } from './types.js';

type Row = Record<string, any>;

export class AppDatabase {
  readonly db: Database.Database;

  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audio_cache (
        cache_key TEXT PRIMARY KEY, filename TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL, voice TEXT NOT NULL, language TEXT NOT NULL,
        settings TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY, source_text TEXT NOT NULL, translated_text TEXT NOT NULL,
        source_language TEXT NOT NULL, target_language TEXT NOT NULL,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        audio_status TEXT NOT NULL CHECK(audio_status IN ('ready','failed','pending')),
        audio_cache_key TEXT REFERENCES audio_cache(cache_key) ON DELETE SET NULL,
        translation_provider TEXT NOT NULL, speech_provider TEXT NOT NULL,
        speech_voice TEXT NOT NULL, batch_id TEXT, batch_index INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS entries_created_idx ON entries(created_at DESC);
      CREATE INDEX IF NOT EXISTS entries_category_idx ON entries(category_id);
      CREATE TABLE IF NOT EXISTS monthly_usage (
        provider_kind TEXT NOT NULL, month TEXT NOT NULL, characters INTEGER NOT NULL,
        PRIMARY KEY(provider_kind, month)
      );
    `);
    const columns = this.db.prepare('PRAGMA table_info(entries)').all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'batch_id')) this.db.exec('ALTER TABLE entries ADD COLUMN batch_id TEXT');
    if (!columns.some((column) => column.name === 'batch_index')) this.db.exec('ALTER TABLE entries ADD COLUMN batch_index INTEGER');
    this.db.exec('CREATE INDEX IF NOT EXISTS entries_batch_idx ON entries(batch_id, batch_index)');
  }

  close() { this.db.close(); }

  listCategories(): Category[] {
    return this.db.prepare('SELECT id, name, created_at createdAt, updated_at updatedAt FROM categories ORDER BY name COLLATE NOCASE').all() as Category[];
  }

  createCategory(id: string, name: string, now: string): Category {
    this.db.prepare('INSERT INTO categories (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(id, name, now, now);
    return { id, name, createdAt: now, updatedAt: now };
  }

  updateCategory(id: string, name: string, now: string): Category | null {
    const result = this.db.prepare('UPDATE categories SET name=?, updated_at=? WHERE id=?').run(name, now, id);
    return result.changes ? this.db.prepare('SELECT id,name,created_at createdAt,updated_at updatedAt FROM categories WHERE id=?').get(id) as Category : null;
  }

  deleteCategory(id: string): boolean {
    return this.db.prepare('DELETE FROM categories WHERE id=?').run(id).changes > 0;
  }

  categoryExists(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM categories WHERE id=?').get(id));
  }

  insertEntry(input: Omit<Entry, 'categoryName' | 'audioUrl'> & { audioCacheKey: string | null }) {
    this.db.prepare(`INSERT INTO entries
      (id,source_text,translated_text,source_language,target_language,category_id,audio_status,audio_cache_key,translation_provider,speech_provider,speech_voice,batch_id,batch_index,created_at,updated_at)
      VALUES (@id,@sourceText,@translatedText,@sourceLanguage,@targetLanguage,@categoryId,@audioStatus,@audioCacheKey,@translationProvider,@speechProvider,@speechVoice,@batchId,@batchIndex,@createdAt,@updatedAt)`)
      .run(input);
  }

  updateEntryAudio(id: string, status: 'ready' | 'failed' | 'pending', cacheKey: string | null, now: string) {
    this.db.prepare('UPDATE entries SET audio_status=?, audio_cache_key=?, updated_at=? WHERE id=?').run(status, cacheKey, now, id);
  }

  updateBatchAudio(batchId: string, status: 'ready' | 'failed' | 'pending', cacheKey: string | null, now: string) {
    this.db.prepare('UPDATE entries SET audio_status=?, audio_cache_key=?, updated_at=? WHERE batch_id=?').run(status, cacheKey, now, batchId);
  }

  updateEntryCategory(id: string, categoryId: string | null, now: string): boolean {
    return this.db.prepare('UPDATE entries SET category_id=?, updated_at=? WHERE id=?').run(categoryId, now, id).changes > 0;
  }

  deleteEntry(id: string, removeAudioFile: (filename: string) => void): boolean {
    return this.db.transaction(() => {
      const entry = this.db.prepare(
        'SELECT batch_id batchId, audio_cache_key audioCacheKey FROM entries WHERE id=?',
      ).get(id) as { batchId: string | null; audioCacheKey: string | null } | undefined;
      if (!entry) return false;

      this.db.prepare('DELETE FROM entries WHERE id=?').run(id);
      if (entry.batchId) {
        this.db.prepare(
          "UPDATE entries SET audio_status='failed', audio_cache_key=NULL, updated_at=? WHERE batch_id=?",
        ).run(new Date().toISOString(), entry.batchId);
      }

      if (entry.audioCacheKey) {
        const orphanedAudio = this.db.prepare(`
          SELECT ac.filename
          FROM audio_cache ac
          WHERE ac.cache_key=?
            AND NOT EXISTS (
              SELECT 1 FROM entries e WHERE e.audio_cache_key=ac.cache_key
            )
        `).get(entry.audioCacheKey) as { filename: string } | undefined;
        if (orphanedAudio) {
          removeAudioFile(orphanedAudio.filename);
          this.db.prepare('DELETE FROM audio_cache WHERE cache_key=?').run(entry.audioCacheKey);
        }
      }
      return true;
    })();
  }

  listEntriesByBatch(batchId: string): Entry[] {
    return (this.db.prepare(`${entrySelect} WHERE e.batch_id=? ORDER BY e.batch_index ASC`).all(batchId) as Row[]).map((row) => this.mapEntry(row)!);
  }

  private mapEntry(row: Row | undefined): Entry | null {
    if (!row) return null;
    return {
      id: row.id, sourceText: row.sourceText, translatedText: row.translatedText,
      sourceLanguage: row.sourceLanguage, targetLanguage: row.targetLanguage,
      categoryId: row.categoryId, categoryName: row.categoryName,
      audioStatus: row.audioStatus, audioUrl: row.audioCacheKey ? `/api/audio/${row.audioCacheKey}` : null,
      translationProvider: row.translationProvider, speechProvider: row.speechProvider,
      speechVoice: row.speechVoice, batchId: row.batchId ?? null, batchIndex: row.batchIndex ?? null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  getEntry(id: string): Entry | null {
    return this.mapEntry(this.db.prepare(`${entrySelect} WHERE e.id=?`).get(id) as Row | undefined);
  }

  listEntries(search?: string, categoryId?: string): Entry[] {
    const where: string[] = [];
    const values: string[] = [];
    if (search) { where.push('(e.source_text LIKE ? ESCAPE \'\\\' OR e.translated_text LIKE ? ESCAPE \'\\\')'); const q = `%${search.replace(/[\\%_]/g, '\\$&')}%`; values.push(q, q); }
    if (categoryId) { where.push('e.category_id=?'); values.push(categoryId); }
    const sql = `${entrySelect}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY e.created_at DESC, e.batch_index ASC LIMIT 500`;
    return (this.db.prepare(sql).all(...values) as Row[]).map((row) => this.mapEntry(row)!);
  }

  getAudioCache(cacheKey: string): { filename: string } | null {
    return (this.db.prepare('SELECT filename FROM audio_cache WHERE cache_key=?').get(cacheKey) as { filename: string } | undefined) ?? null;
  }

  addAudioCache(input: { cacheKey: string; filename: string; provider: string; voice: string; language: string; settings: string; createdAt: string }) {
    this.db.prepare(`INSERT OR IGNORE INTO audio_cache (cache_key,filename,provider,voice,language,settings,created_at)
      VALUES (@cacheKey,@filename,@provider,@voice,@language,@settings,@createdAt)`).run(input);
  }

  reserveUsage(kind: 'translation' | 'speech', month: string, characters: number, limit: number): boolean {
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT characters FROM monthly_usage WHERE provider_kind=? AND month=?').get(kind, month) as { characters: number } | undefined;
      if ((row?.characters ?? 0) + characters > limit) return false;
      this.db.prepare(`INSERT INTO monthly_usage(provider_kind,month,characters) VALUES(?,?,?)
        ON CONFLICT(provider_kind,month) DO UPDATE SET characters=characters+excluded.characters`).run(kind, month, characters);
      return true;
    })();
  }

  getUsage(month: string) {
    const rows = this.db.prepare('SELECT provider_kind kind, characters FROM monthly_usage WHERE month=?').all(month) as { kind: string; characters: number }[];
    return Object.fromEntries(rows.map((row) => [row.kind, row.characters]));
  }
}

const entrySelect = `SELECT e.id, e.source_text sourceText, e.translated_text translatedText,
  e.source_language sourceLanguage, e.target_language targetLanguage, e.category_id categoryId,
  c.name categoryName, e.audio_status audioStatus, e.audio_cache_key audioCacheKey,
  e.translation_provider translationProvider, e.speech_provider speechProvider,
  e.speech_voice speechVoice, e.batch_id batchId, e.batch_index batchIndex,
  e.created_at createdAt, e.updated_at updatedAt
  FROM entries e LEFT JOIN categories c ON c.id=e.category_id`;
