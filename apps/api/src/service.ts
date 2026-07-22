import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { AppConfig } from './config.js';
import { AppDatabase } from './db.js';
import { AppError } from './errors.js';
import type { Entry, SpeechProvider, TranslationProvider } from './types.js';

const speechSettings = { language: 'it-IT' as const, rate: '0%', pitch: '0%' };

export function currentMonth(now = new Date()): string { return now.toISOString().slice(0, 7); }

export function safeAudioPath(audioDirectory: string, filename: string): string {
  if (basename(filename) !== filename || !/^[a-f0-9]{64}\.mp3$/.test(filename)) throw new AppError('INVALID_REQUEST', 'Ungültige Audiodatei.', 400);
  const base = resolve(audioDirectory);
  const result = resolve(base, filename);
  if (!result.startsWith(`${base}${sep}`)) throw new AppError('INVALID_REQUEST', 'Ungültige Audiodatei.', 400);
  return result;
}

export class LearningService {
  readonly audioDirectory: string;
  private readonly generationInFlight = new Map<string, Promise<Entry>>();
  private readonly audioInFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly db: AppDatabase,
    private readonly config: AppConfig,
    private readonly translator: TranslationProvider,
    private readonly speech: SpeechProvider,
  ) {
    this.audioDirectory = join(config.DATA_DIR, 'audio');
    mkdirSync(this.audioDirectory, { recursive: true });
  }

  generate(sourceText: string, categoryId: string | null): Promise<Entry> {
    const key = createHash('sha256').update(JSON.stringify({ sourceText, categoryId, target: 'it' })).digest('hex');
    const existing = this.generationInFlight.get(key);
    if (existing) return existing;
    const task = this.performGeneration(sourceText, categoryId).finally(() => this.generationInFlight.delete(key));
    this.generationInFlight.set(key, task);
    return task;
  }

  private async performGeneration(sourceText: string, categoryId: string | null): Promise<Entry> {
    if (categoryId && !this.db.categoryExists(categoryId)) throw new AppError('INVALID_REQUEST', 'Die gewählte Kategorie existiert nicht mehr.', 400);
    if (!this.db.reserveUsage('translation', currentMonth(), sourceText.length, this.config.TRANSLATION_MONTHLY_CHAR_LIMIT)) {
      throw new AppError('QUOTA_EXCEEDED', 'Das monatliche Übersetzungskontingent wurde erreicht.', 429);
    }
    const translatedText = await this.translator.translate(sourceText, 'de', 'it');
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.insertEntry({
      id, sourceText, translatedText, sourceLanguage: 'de', targetLanguage: 'it', categoryId,
      audioStatus: 'pending', audioCacheKey: null, translationProvider: this.translator.name,
      speechProvider: this.speech.name, speechVoice: this.config.AZURE_SPEECH_VOICE, createdAt: now, updatedAt: now,
    });
    try {
      const cacheKey = await this.ensureAudio(translatedText);
      this.db.updateEntryAudio(id, 'ready', cacheKey, new Date().toISOString());
    } catch {
      // The successful translation remains available and can be retried explicitly.
      this.db.updateEntryAudio(id, 'failed', null, new Date().toISOString());
    }
    return this.db.getEntry(id)!;
  }

  async retryAudio(entryId: string): Promise<Entry> {
    const entry = this.db.getEntry(entryId);
    if (!entry) throw new AppError('NOT_FOUND', 'Der Eintrag wurde nicht gefunden.', 404);
    if (entry.audioStatus === 'ready') return entry;
    this.db.updateEntryAudio(entryId, 'pending', null, new Date().toISOString());
    try {
      const cacheKey = await this.ensureAudio(entry.translatedText);
      this.db.updateEntryAudio(entryId, 'ready', cacheKey, new Date().toISOString());
    } catch (error) {
      this.db.updateEntryAudio(entryId, 'failed', null, new Date().toISOString());
      throw error;
    }
    return this.db.getEntry(entryId)!;
  }

  private async ensureAudio(text: string): Promise<string> {
    const settings = JSON.stringify(speechSettings);
    const cacheKey = createHash('sha256').update(JSON.stringify({ text, voice: this.config.AZURE_SPEECH_VOICE, provider: this.speech.name, settings })).digest('hex');
    const cached = this.db.getAudioCache(cacheKey);
    if (cached && existsSync(safeAudioPath(this.audioDirectory, cached.filename))) return cacheKey;
    const existing = this.audioInFlight.get(cacheKey);
    if (existing) return existing;
    const task = this.createAudio(cacheKey, text, settings).finally(() => this.audioInFlight.delete(cacheKey));
    this.audioInFlight.set(cacheKey, task);
    return task;
  }

  private async createAudio(cacheKey: string, text: string, settings: string): Promise<string> {
    if (!this.db.reserveUsage('speech', currentMonth(), text.length, this.config.SPEECH_MONTHLY_CHAR_LIMIT)) {
      throw new AppError('QUOTA_EXCEEDED', 'Das monatliche Audio-Kontingent wurde erreicht.', 429);
    }
    const bytes = await this.speech.synthesize({ text, voice: this.config.AZURE_SPEECH_VOICE, ...speechSettings });
    const filename = `${cacheKey}.mp3`;
    const finalPath = safeAudioPath(this.audioDirectory, filename);
    const tempPath = `${finalPath}.${randomUUID()}.tmp`;
    writeFileSync(tempPath, bytes, { flag: 'wx', mode: 0o600 });
    renameSync(tempPath, finalPath);
    this.db.addAudioCache({ cacheKey, filename, provider: this.speech.name, voice: this.config.AZURE_SPEECH_VOICE, language: speechSettings.language, settings, createdAt: new Date().toISOString() });
    return cacheKey;
  }

  audioPath(cacheKey: string): string | null {
    if (!/^[a-f0-9]{64}$/.test(cacheKey)) return null;
    const cached = this.db.getAudioCache(cacheKey);
    if (!cached) return null;
    const path = safeAudioPath(this.audioDirectory, cached.filename);
    return existsSync(path) ? path : null;
  }
}
