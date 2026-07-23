import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig, type AppConfig } from '../src/config.js';
import { AppDatabase } from '../src/db.js';
import { AzureTranslationProvider, createSpeechSsml, escapeSsml } from '../src/providers.js';
import { LearningService, safeAudioPath } from '../src/service.js';
import type { SpeechProvider, SpeechRequest, TranslationProvider } from '../src/types.js';

const temporaryDirectories: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function testConfig(overrides: Partial<NodeJS.ProcessEnv> = {}): AppConfig {
  const data = mkdtempSync(join(tmpdir(), 'meine-saetze-'));
  temporaryDirectories.push(data);
  return loadConfig({ NODE_ENV: 'test', PROVIDER_MODE: 'mock', DATA_DIR: data, ...overrides });
}

class Translator implements TranslationProvider {
  readonly name = 'test-translator';
  calls = 0;
  constructor(private readonly output = 'La traduzione') {}
  async translate() { this.calls += 1; return this.output; }
}

class Speech implements SpeechProvider {
  readonly name = 'test-speech';
  calls = 0;
  lastRequest?: SpeechRequest;
  constructor(private readonly shouldFail = false) {}
  async synthesize(request: SpeechRequest) {
    this.calls += 1; this.lastRequest = request;
    if (this.shouldFail) throw new Error('provider response must not leak');
    return Buffer.from('ID3-test-audio');
  }
}

describe('configuration and validation', () => {
  it('allows mock mode without secrets and rejects incomplete Azure mode', () => {
    expect(loadConfig({ NODE_ENV: 'test', PROVIDER_MODE: 'mock', DATA_DIR: '/tmp/test' }).PROVIDER_MODE).toBe('mock');
    expect(() => loadConfig({ NODE_ENV: 'test', PROVIDER_MODE: 'azure', DATA_DIR: '/tmp/test' })).toThrow(/AZURE_TRANSLATOR_KEY/);
    const azure = loadConfig({
      NODE_ENV: 'test', PROVIDER_MODE: 'azure', DATA_DIR: '/tmp/test',
      AZURE_TRANSLATOR_KEY: 'translator-secret', AZURE_SPEECH_KEY: 'speech-secret', AZURE_SPEECH_REGION: 'westeurope',
    });
    expect(azure.AZURE_TRANSLATOR_KEY).toBe('translator-secret');
  });

  it('rejects empty, oversized, and malformed generation requests', async () => {
    const config = testConfig({ MAX_TEXT_LENGTH: '10' });
    const app = await buildApp({ config });
    expect((await app.inject({ method: 'POST', url: '/api/entries', payload: { sourceText: '   ', targetLanguage: 'it', categoryId: null } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/entries', payload: { sourceText: '12345678901', targetLanguage: 'it', categoryId: null } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/entries', payload: { sourceText: 'Hallo', targetLanguage: 'fr', categoryId: null } })).statusCode).toBe(400);
    await app.close();
  });

  it('exposes only non-HD Italian voices and rejects unknown voice selections', async () => {
    const config = testConfig();
    const app = await buildApp({ config });
    const info = await app.inject({ method: 'GET', url: '/api/info' });
    expect(info.headers['cache-control']).toBe('no-store');
    expect(info.json().voices).toContainEqual({ id: 'it-IT-DiegoNeural', name: 'Diego', gender: 'male' });
    expect(info.json().voices.every((voice: { id: string }) => !voice.id.includes('HD'))).toBe(true);
    const invalid = await app.inject({ method: 'POST', url: '/api/entries', payload: {
      sourceText: 'Hallo', targetLanguage: 'it', categoryId: null, voice: 'it-IT-Isabella:DragonHDLatestNeural',
    } });
    expect(invalid.statusCode).toBe(400);
    await app.close();
  });
});

describe('provider requests', () => {
  it('escapes every XML-sensitive SSML character and builds safe speech requests', () => {
    expect(escapeSsml(`A&B <tag> "x" 'y'`)).toBe('A&amp;B &lt;tag&gt; &quot;x&quot; &apos;y&apos;');
    const ssml = createSpeechSsml({ text: 'Pane & <vino>', language: 'it-IT', voice: 'it-IT-ElsaNeural', rate: '0%', pitch: '0%' });
    expect(ssml).toContain('xml:lang="it-IT"');
    expect(ssml).toContain('voice name="it-IT-ElsaNeural"');
    expect(ssml).toContain('Pane &amp; &lt;vino&gt;');
    expect(ssml).not.toContain('Pane & <vino>');
    const batchSsml = createSpeechSsml({ text: 'Prima.\n\nSeconda.', language: 'it-IT', voice: 'it-IT-ElsaNeural', rate: '0%', pitch: '0%' });
    expect(batchSsml).toContain('Prima.<break time="650ms"/>Seconda.');
  });

  it('validates the Azure Translator response shape', async () => {
    const config = testConfig({ PROVIDER_MODE: 'azure', AZURE_TRANSLATOR_KEY: 'secret', AZURE_SPEECH_KEY: 'secret', AZURE_SPEECH_REGION: 'region' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ translations: [{ text: 'Ciao!' }] }]), { status: 200 })));
    await expect(new AzureTranslationProvider(config).translate('Hallo!', 'de', 'it')).resolves.toBe('Ciao!');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{ unexpected: true }]), { status: 200 })));
    await expect(new AzureTranslationProvider(config).translate('Hallo!', 'de', 'it')).rejects.toMatchObject({ code: 'PROVIDER_FAILED' });
  });
});

describe('persistence, cache, and safeguards', () => {
  it('uses one stored audio file for matching speech inputs and does not recount cache hits', async () => {
    const config = testConfig();
    const db = new AppDatabase(':memory:');
    const speech = new Speech();
    const service = new LearningService(db, config, new Translator('Stesso testo'), speech);
    const first = await service.generate('Erster Satz', null);
    const second = await service.generate('Zweiter Satz', null);
    expect(first.audioUrl).toBe(second.audioUrl);
    expect(speech.calls).toBe(1);
    expect(speech.lastRequest).toEqual({ text: 'Stesso testo', language: 'it-IT', voice: 'it-IT-ElsaNeural', rate: '0%', pitch: '0%' });
    expect(db.getUsage(new Date().toISOString().slice(0, 7)).speech).toBe('Stesso testo'.length);
    expect(readFileSync(service.audioPath(first.audioUrl!.split('/').pop()!)!)).toEqual(Buffer.from('ID3-test-audio'));
    db.close();
  });

  it('enforces monthly character limits atomically', () => {
    const db = new AppDatabase(':memory:');
    expect(db.reserveUsage('translation', '2026-07', 7, 10)).toBe(true);
    expect(db.reserveUsage('translation', '2026-07', 4, 10)).toBe(false);
    expect(db.reserveUsage('translation', '2026-08', 10, 10)).toBe(true);
    expect(db.getUsage('2026-07').translation).toBe(7);
    db.close();
  });

  it('deletes a category without deleting its entries', async () => {
    const config = testConfig();
    const db = new AppDatabase(':memory:');
    const category = db.createCategory(crypto.randomUUID(), 'Reisen', new Date().toISOString());
    const service = new LearningService(db, config, new Translator(), new Speech());
    const entry = await service.generate('Am Bahnhof', category.id);
    expect(db.deleteCategory(category.id)).toBe(true);
    expect(db.getEntry(entry.id)).toMatchObject({ categoryId: null, sourceText: 'Am Bahnhof' });
    db.close();
  });

  it('stores batch sentences separately while generating and retrying one combined voice-specific track', async () => {
    const config = testConfig();
    const db = new AppDatabase(':memory:');
    const speech = new Speech();
    const translator: TranslationProvider = { name: 'echo-translator', translate: async (text) => `IT ${text}` };
    const service = new LearningService(db, config, translator, speech);
    const entries = await service.generateBatch(['Erster Satz.', 'Zweiter Satz.'], null, 'it-IT-DiegoNeural');

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.sourceText)).toEqual(['Erster Satz.', 'Zweiter Satz.']);
    expect(entries[0]?.batchId).toBe(entries[1]?.batchId);
    expect(entries[0]?.audioUrl).toBe(entries[1]?.audioUrl);
    expect(speech.lastRequest).toMatchObject({ text: 'IT Erster Satz.\n\nIT Zweiter Satz.', voice: 'it-IT-DiegoNeural' });

    expect(service.deleteEntry(entries[0]!.id)).toBe(true);
    const remaining = db.getEntry(entries[1]!.id)!;
    expect(remaining).toMatchObject({ audioStatus: 'failed', audioUrl: null });
    await service.retryAudio(remaining.id);
    expect(speech.calls).toBe(2);
    expect(speech.lastRequest).toMatchObject({ text: 'IT Zweiter Satz.', voice: 'it-IT-DiegoNeural' });
    db.close();
  });

  it('deletes an entry and its unreferenced audio through the HTTP endpoint', async () => {
    const config = testConfig();
    const db = new AppDatabase(':memory:');
    const app = await buildApp({ config, db, translator: new Translator('Da eliminare'), speech: new Speech() });
    const created = await app.inject({
      method: 'POST',
      url: '/api/entries',
      payload: { sourceText: 'Bitte löschen', targetLanguage: 'it', categoryId: null },
    });
    const entry = created.json().entry as { id: string; audioUrl: string };
    const cacheKey = entry.audioUrl.split('/').pop()!;
    const audioPath = join(config.DATA_DIR, 'audio', `${cacheKey}.mp3`);
    expect(existsSync(audioPath)).toBe(true);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/entries/${entry.id}` });

    expect(deleted.statusCode).toBe(204);
    expect(db.getEntry(entry.id)).toBeNull();
    expect(db.getAudioCache(cacheKey)).toBeNull();
    expect(existsSync(audioPath)).toBe(false);
    expect((await app.inject({ method: 'GET', url: `/api/audio/${cacheKey}` })).statusCode).toBe(404);
    await app.close();
  });

  it('keeps shared audio until its final entry is deleted', async () => {
    const config = testConfig();
    const db = new AppDatabase(':memory:');
    const service = new LearningService(db, config, new Translator('Condiviso'), new Speech());
    const first = await service.generate('Erster Satz', null);
    const second = await service.generate('Zweiter Satz', null);
    const cacheKey = first.audioUrl!.split('/').pop()!;
    const audioPath = service.audioPath(cacheKey)!;

    expect(service.deleteEntry(first.id)).toBe(true);
    expect(existsSync(audioPath)).toBe(true);
    expect(db.getAudioCache(cacheKey)).not.toBeNull();

    expect(service.deleteEntry(second.id)).toBe(true);
    expect(existsSync(audioPath)).toBe(false);
    expect(db.getAudioCache(cacheKey)).toBeNull();
    db.close();
  });

  it('retains a translation when initial speech generation fails', async () => {
    const config = testConfig();
    const db = new AppDatabase(':memory:');
    const service = new LearningService(db, config, new Translator('Traduzione riuscita'), new Speech(true));
    const entry = await service.generate('Übersetzung behalten', null);
    expect(entry).toMatchObject({ translatedText: 'Traduzione riuscita', audioStatus: 'failed', audioUrl: null });
    expect(db.listEntries()).toHaveLength(1);
    db.close();
  });

  it('prevents path traversal and accepts only generated MP3 names', () => {
    expect(() => safeAudioPath('/data/audio', '../secret')).toThrow(/Ungültige Audiodatei/);
    expect(() => safeAudioPath('/data/audio', 'anything.mp3')).toThrow(/Ungültige Audiodatei/);
    const filename = `${'a'.repeat(64)}.mp3`;
    expect(safeAudioPath('/data/audio', filename)).toBe(`/data/audio/${filename}`);
  });
});
