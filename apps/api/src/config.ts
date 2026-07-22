import { z } from 'zod';

const blankToUndefined = (value: unknown) => value === '' ? undefined : value;
const positiveInt = (fallback: number) => z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(fallback));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: positiveInt(8080),
  DATA_DIR: z.string().min(1).default('/data'),
  PROVIDER_MODE: z.enum(['mock', 'azure']).default('mock'),
  DEV_ORIGIN: z.string().url().default('http://localhost:8081'),
  AZURE_TRANSLATOR_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  AZURE_SPEECH_KEY: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  AZURE_TRANSLATOR_ENDPOINT: z.string().url().default('https://api.cognitive.microsofttranslator.com'),
  AZURE_TRANSLATOR_REGION: z.preprocess(blankToUndefined, z.string().optional()),
  AZURE_SPEECH_ENDPOINT: z.preprocess(blankToUndefined, z.string().url().optional()),
  AZURE_SPEECH_REGION: z.preprocess(blankToUndefined, z.string().optional()),
  AZURE_SPEECH_VOICE: z.string().default('it-IT-ElsaNeural'),
  TRANSLATION_MONTHLY_CHAR_LIMIT: positiveInt(1_500_000),
  SPEECH_MONTHLY_CHAR_LIMIT: positiveInt(400_000),
  MAX_TEXT_LENGTH: positiveInt(2_000),
  GENERATION_REQUESTS_PER_MINUTE: positiveInt(10),
  PROVIDER_TIMEOUT_MS: positiveInt(10_000),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const config = envSchema.parse(environment);
  if (config.PROVIDER_MODE === 'azure') {
    const missing = [
      !config.AZURE_TRANSLATOR_KEY && 'AZURE_TRANSLATOR_KEY',
      !config.AZURE_SPEECH_KEY && 'AZURE_SPEECH_KEY',
      !config.AZURE_SPEECH_ENDPOINT && !config.AZURE_SPEECH_REGION && 'AZURE_SPEECH_REGION or AZURE_SPEECH_ENDPOINT',
    ].filter(Boolean);
    if (missing.length) throw new Error(`Missing required Azure configuration: ${missing.join(', ')}`);
  }
  return config;
}
