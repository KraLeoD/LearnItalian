import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { AppConfig } from './config.js';
import { AppDatabase } from './db.js';
import { AppError } from './errors.js';
import type { Entry, SpeechProvider, TranslationProvider } from './types.js';
import { resolveVoice } from './voices.js';

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
  private readonly batchGenerationInFlight = new Map<string, Promise<Entry[]>>();
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

  generate(sourceText: string, categoryId: string | null, requestedVoice?: string): Promise<Entry> {
    const voice = resolveVoice(requestedVoice, this.config.AZURE_SPEECH_VOICE);
    const key = createHash('sha256').update(JSON.stringify({ sourceText, categoryId, voice, target: 'it' })).digest('hex');
    const existing = this.generationInFlight.get(key);
    if (existing) return existing;
    const task = this.performGeneration(sourceText, categoryId, voice).finally(() => this.generationInFlight.delete(key));
    this.generationInFlight.set(key, task);
    return task;
  }

  generateBatch(sourceTexts: string[], categoryId: string | null, requestedVoice?: string): Promise<Entry[]> {
    const voice = resolveVoice(requestedVoice, this.config.AZURE_SPEECH_VOICE);
    const key = createHash('sha256').update(JSON.stringify({ sourceTexts, categoryId, voice, target: 'it' })).digest('hex');
    const existing = this.batchGenerationInFlight.get(key);
    if (existing) return existing;
    const task = this.performBatchGeneration(sourceTexts, categoryId, voice).finally(() => this.batchGenerationInFlight.delete(key));
    this.batchGenerationInFlight.set(key, task);
    return task;
  }

  private async performGeneration(sourceText: string, categoryId: string | null, voice: string): Promise<Entry> {
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
      speechProvider: this.speech.name, speechVoice: voice, batchId: null, batchIndex: null, createdAt: now, updatedAt: now,
    });
    try {
      const cacheKey = await this.ensureAudio(translatedText, voice);
      this.db.updateEntryAudio(id, 'ready', cacheKey, new Date().toISOString());
    } catch {
      // The successful translation remains available and can be retried explicitly.
      this.db.updateEntryAudio(id, 'failed', null, new Date().toISOString());
    }
    return this.db.getEntry(id)!;
  }

  private async performBatchGeneration(sourceTexts: string[], categoryId: string | null, voice: string): Promise<Entry[]> {
    if (categoryId && !this.db.categoryExists(categoryId)) throw new AppError('INVALID_REQUEST', 'Die gewählte Kategorie existiert nicht mehr.', 400);
    const characterCount = sourceTexts.reduce((total, text) => total + text.length, 0);
    if (!this.db.reserveUsage('translation', currentMonth(), characterCount, this.config.TRANSLATION_MONTHLY_CHAR_LIMIT)) {
      throw new AppError('QUOTA_EXCEEDED', 'Das monatliche Übersetzungskontingent wurde erreicht.', 429);
    }
    const translatedTexts: string[] = [];
    for (const sourceText of sourceTexts) translatedTexts.push(await this.translator.translate(sourceText, 'de', 'it'));

    const batchId = randomUUID();
    const now = new Date().toISOString();
    sourceTexts.forEach((sourceText, batchIndex) => this.db.insertEntry({
      id: randomUUID(), sourceText, translatedText: translatedTexts[batchIndex]!, sourceLanguage: 'de', targetLanguage: 'it', categoryId,
      audioStatus: 'pending', audioCacheKey: null, translationProvider: this.translator.name, speechProvider: this.speech.name,
      speechVoice: voice, batchId, batchIndex, createdAt: now, updatedAt: now,
    }));
    try {
      const cacheKey = await this.ensureAudio(translatedTexts.join('\n\n'), voice);
      this.db.updateBatchAudio(batchId, 'ready', cacheKey, new Date().toISOString());
    } catch {
      this.db.updateBatchAudio(batchId, 'failed', null, new Date().toISOString());
    }
    return this.db.listEntriesByBatch(batchId);
  }

  async retryAudio(entryId: string): Promise<Entry> {
    const entry = this.db.getEntry(entryId);
    if (!entry) throw new AppError('NOT_FOUND', 'Der Eintrag wurde nicht gefunden.', 404);
    if (entry.audioStatus === 'ready') return entry;
    const batch = entry.batchId ? this.db.listEntriesByBatch(entry.batchId) : [entry];
    const text = batch.map((item) => item.translatedText).join('\n\n');
    if (entry.batchId) this.db.updateBatchAudio(entry.batchId, 'pending', null, new Date().toISOString());
    else this.db.updateEntryAudio(entryId, 'pending', null, new Date().toISOString());
    try {
      const cacheKey = await this.ensureAudio(text, entry.speechVoice);
      if (entry.batchId) this.db.updateBatchAudio(entry.batchId, 'ready', cacheKey, new Date().toISOString());
      else this.db.updateEntryAudio(entryId, 'ready', cacheKey, new Date().toISOString());
    } catch (error) {
      if (entry.batchId) this.db.updateBatchAudio(entry.batchId, 'failed', null, new Date().toISOString());
      else this.db.updateEntryAudio(entryId, 'failed', null, new Date().toISOString());
      throw error;
    }
    return this.db.getEntry(entryId)!;
  }

  deleteEntry(entryId: string): boolean {
    return this.db.deleteEntry(entryId, (filename) => {
      try {
        unlinkSync(safeAudioPath(this.audioDirectory, filename));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    });
  }

  private async ensureAudio(text: string, voice: string): Promise<string> {
    const settings = JSON.stringify(speechSettings);
    const cacheKey = createHash('sha256').update(JSON.stringify({ text, voice, provider: this.speech.name, settings })).digest('hex');
    const cached = this.db.getAudioCache(cacheKey);
    if (cached && existsSync(safeAudioPath(this.audioDirectory, cached.filename))) return cacheKey;
    const existing = this.audioInFlight.get(cacheKey);
    if (existing) return existing;
    const task = this.createAudio(cacheKey, text, voice, settings).finally(() => this.audioInFlight.delete(cacheKey));
    this.audioInFlight.set(cacheKey, task);
    return task;
  }

  private async createAudio(cacheKey: string, text: string, voice: string, settings: string): Promise<string> {
    if (!this.db.reserveUsage('speech', currentMonth(), text.length, this.config.SPEECH_MONTHLY_CHAR_LIMIT)) {
      throw new AppError('QUOTA_EXCEEDED', 'Das monatliche Audio-Kontingent wurde erreicht.', 429);
    }
    const bytes = await this.speech.synthesize({ text, voice, ...speechSettings });
    const filename = `${cacheKey}.mp3`;
    const finalPath = safeAudioPath(this.audioDirectory, filename);
    const tempPath = `${finalPath}.${randomUUID()}.tmp`;
    writeFileSync(tempPath, bytes, { flag: 'wx', mode: 0o600 });
    renameSync(tempPath, finalPath);
    this.db.addAudioCache({ cacheKey, filename, provider: this.speech.name, voice, language: speechSettings.language, settings, createdAt: new Date().toISOString() });
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
