export interface Category { id: string; name: string; createdAt: string; updatedAt: string }
export interface Entry {
  id: string; sourceText: string; translatedText: string; sourceLanguage: 'de'; targetLanguage: 'it';
  categoryId: string | null; categoryName: string | null; audioStatus: 'ready' | 'failed' | 'pending';
  audioUrl: string | null; translationProvider: string; speechProvider: string; speechVoice: string;
  batchId: string | null; batchIndex: number | null;
  createdAt: string; updatedAt: string;
}
export interface VoiceOption { id: string; name: string; gender: 'female' | 'male' }
export interface Info {
  providerMode: 'mock' | 'azure'; month: string;
  usage: { translation: { used: number; limit: number }; speech: { used: number; limit: number } };
  defaultVoice: string;
  voices: VoiceOption[];
}
