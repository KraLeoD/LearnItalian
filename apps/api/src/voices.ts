import { AppError } from './errors.js';
import type { VoiceOption } from './types.js';

// Azure's standard Italian neural voices. HD/Dragon and multilingual voices are
// deliberately excluded so choosing a voice cannot opt into an HD tier.
export const ITALIAN_VOICES: VoiceOption[] = [
  { id: 'it-IT-ElsaNeural', name: 'Elsa', gender: 'female' },
  { id: 'it-IT-IsabellaNeural', name: 'Isabella', gender: 'female' },
  { id: 'it-IT-FabiolaNeural', name: 'Fabiola', gender: 'female' },
  { id: 'it-IT-FiammaNeural', name: 'Fiamma', gender: 'female' },
  { id: 'it-IT-ImeldaNeural', name: 'Imelda', gender: 'female' },
  { id: 'it-IT-IrmaNeural', name: 'Irma', gender: 'female' },
  { id: 'it-IT-PalmiraNeural', name: 'Palmira', gender: 'female' },
  { id: 'it-IT-PierinaNeural', name: 'Pierina', gender: 'female' },
  { id: 'it-IT-DiegoNeural', name: 'Diego', gender: 'male' },
  { id: 'it-IT-BenignoNeural', name: 'Benigno', gender: 'male' },
  { id: 'it-IT-CalimeroNeural', name: 'Calimero', gender: 'male' },
  { id: 'it-IT-CataldoNeural', name: 'Cataldo', gender: 'male' },
  { id: 'it-IT-GianniNeural', name: 'Gianni', gender: 'male' },
  { id: 'it-IT-GiuseppeNeural', name: 'Giuseppe', gender: 'male' },
  { id: 'it-IT-LisandroNeural', name: 'Lisandro', gender: 'male' },
  { id: 'it-IT-RinaldoNeural', name: 'Rinaldo', gender: 'male' },
];

export function resolveVoice(requested: string | undefined, configuredDefault: string): string {
  const voice = requested ?? configuredDefault;
  if (voice === configuredDefault || ITALIAN_VOICES.some((item) => item.id === voice)) return voice;
  throw new AppError('INVALID_REQUEST', 'Diese italienische Stimme ist nicht verfügbar.', 400);
}
