import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import type { SpeechProvider, SpeechRequest, TranslationProvider } from './types.js';

export function escapeSsml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function createSpeechSsml(request: SpeechRequest): string {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${request.language}"><voice name="${escapeSsml(request.voice)}"><prosody rate="${escapeSsml(request.rate)}" pitch="${escapeSsml(request.pitch)}">${escapeSsml(request.text)}</prosody></voice></speak>`;
}

async function fetchWithRetry(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      // Bad input, authentication, throttling and quota errors should never be hammered.
      if (response.status < 500 || attempt === 1) return response;
    } catch {
      if (attempt === 1) break;
    }
  }
  throw new AppError('PROVIDER_FAILED', 'Der Cloud-Dienst ist gerade nicht erreichbar.', 502);
}

export class AzureTranslationProvider implements TranslationProvider {
  readonly name = 'azure-translator';
  constructor(private readonly config: AppConfig) {}

  async translate(text: string, sourceLanguage: 'de', targetLanguage: 'it'): Promise<string> {
    const endpoint = this.config.AZURE_TRANSLATOR_ENDPOINT.replace(/\/$/, '');
    const url = `${endpoint}/translate?api-version=3.0&from=${sourceLanguage}&to=${targetLanguage}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': this.config.AZURE_TRANSLATOR_KEY!,
      'X-ClientTraceId': randomUUID(),
    };
    if (this.config.AZURE_TRANSLATOR_REGION) headers['Ocp-Apim-Subscription-Region'] = this.config.AZURE_TRANSLATOR_REGION;
    const response = await fetchWithRetry(url, { method: 'POST', headers, body: JSON.stringify([{ text }]) }, this.config.PROVIDER_TIMEOUT_MS);
    if (!response.ok) throw providerFailure(response.status, 'Übersetzung');
    try {
      const payload = await response.json() as Array<{ translations?: Array<{ text?: unknown }> }>;
      const translated = payload[0]?.translations?.[0]?.text;
      if (typeof translated !== 'string' || !translated.trim()) throw new Error('Malformed response');
      return translated.trim();
    } catch {
      throw new AppError('PROVIDER_FAILED', 'Die Übersetzung konnte nicht verarbeitet werden.', 502);
    }
  }
}

export class AzureSpeechProvider implements SpeechProvider {
  readonly name = 'azure-speech';
  constructor(private readonly config: AppConfig) {}

  async synthesize(request: SpeechRequest): Promise<Buffer> {
    const url = this.config.AZURE_SPEECH_ENDPOINT ?? `https://${this.config.AZURE_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.config.AZURE_SPEECH_KEY!,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'meine-saetze',
      },
      body: createSpeechSsml(request),
    }, this.config.PROVIDER_TIMEOUT_MS);
    if (!response.ok) throw providerFailure(response.status, 'Audio');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new AppError('PROVIDER_FAILED', 'Audio konnte nicht erstellt werden.', 502);
    return bytes;
  }
}

function providerFailure(status: number, operation: string): AppError {
  if (status === 429) return new AppError('QUOTA_EXCEEDED', 'Das Kontingent des Cloud-Dienstes wurde erreicht.', 429);
  if (status === 400) return new AppError('INVALID_REQUEST', `${operation} konnte für diesen Text nicht erstellt werden.`, 400);
  return new AppError('PROVIDER_FAILED', `${operation} konnte nicht erstellt werden. Bitte versuche es später erneut.`, 502);
}

const mockTranslations = new Map([
  ['Ich lerne jeden Tag Italienisch.', 'Studio italiano ogni giorno.'],
  ['Guten Morgen!', 'Buongiorno!'],
  ['Wo ist der Bahnhof?', 'Dov\'è la stazione?'],
  ['Danke für deine Hilfe.', 'Grazie per il tuo aiuto.'],
]);

export class MockTranslationProvider implements TranslationProvider {
  readonly name = 'mock-translator';
  async translate(text: string): Promise<string> {
    return mockTranslations.get(text.trim()) ?? `[Italiano] ${text.trim()}`;
  }
}

// A deterministic, tiny MP3-like fixture. It starts with an ID3 header and is sufficient for
// API/cache tests; Azure mode returns full speech audio.
const mockAudio = Buffer.from('SUQzBAAAAAAAI1RTU0UAAAAPAAADTGVhcm5JdGFsaWFuAAAA//uQxAAAAAAAAAAAAAAAAAAAAAA=', 'base64');

export class MockSpeechProvider implements SpeechProvider {
  readonly name = 'mock-speech';
  async synthesize(): Promise<Buffer> { return Buffer.from(mockAudio); }
}

export function createProviders(config: AppConfig): { translator: TranslationProvider; speech: SpeechProvider } {
  return config.PROVIDER_MODE === 'azure'
    ? { translator: new AzureTranslationProvider(config), speech: new AzureSpeechProvider(config) }
    : { translator: new MockTranslationProvider(), speech: new MockSpeechProvider() };
}
