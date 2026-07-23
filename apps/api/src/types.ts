export type AudioStatus = 'ready' | 'failed' | 'pending';

export interface Category {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLanguage: 'de';
  targetLanguage: 'it';
  categoryId: string | null;
  categoryName: string | null;
  audioStatus: AudioStatus;
  audioUrl: string | null;
  translationProvider: string;
  speechProvider: string;
  speechVoice: string;
  batchId: string | null;
  batchIndex: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'female' | 'male';
}

export interface TranslationProvider {
  readonly name: string;
  translate(text: string, sourceLanguage: 'de', targetLanguage: 'it'): Promise<string>;
}

export interface SpeechRequest {
  text: string;
  language: 'it-IT';
  voice: string;
  rate: string;
  pitch: string;
}

export interface SpeechProvider {
  readonly name: string;
  synthesize(request: SpeechRequest): Promise<Buffer>;
}
