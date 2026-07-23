import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { createReadStream, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import { AppDatabase } from './db.js';
import { AppError, publicError } from './errors.js';
import { createProviders } from './providers.js';
import { currentMonth, LearningService } from './service.js';
import type { SpeechProvider, TranslationProvider } from './types.js';
import { ITALIAN_VOICES } from './voices.js';

interface BuildOptions {
  config: AppConfig;
  db?: AppDatabase;
  translator?: TranslationProvider;
  speech?: SpeechProvider;
  webRoot?: string;
}

const categoryBody = z.object({ name: z.string().trim().min(1).max(60) }).strict();
const generateBody = (max: number) => z.object({
  sourceText: z.string().trim().min(1).max(max),
  targetLanguage: z.literal('it').default('it'),
  categoryId: z.string().uuid().nullable().default(null),
  voice: z.string().max(100).optional(),
}).strict();
const generateBatchBody = (max: number) => z.object({
  sourceTexts: z.array(z.string().trim().min(1).max(max)).min(2).max(30),
  targetLanguage: z.literal('it').default('it'),
  categoryId: z.string().uuid().nullable().default(null),
  voice: z.string().max(100).optional(),
}).strict().refine(
  ({ sourceTexts }) => sourceTexts.reduce((total, text) => total + text.length, 0) <= max,
  { message: 'Die Sätze sind zusammen zu lang.', path: ['sourceTexts'] },
);
const categoryAssignment = z.object({ categoryId: z.string().uuid().nullable() }).strict();
const idParams = z.object({ id: z.string().uuid() });
const audioParams = z.object({ cacheKey: z.string().regex(/^[a-f0-9]{64}$/) });

export async function buildApp(options: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.ocp-apim-subscription-key'] },
    bodyLimit: 16 * 1024,
    trustProxy: true,
  });
  const db = options.db ?? new AppDatabase(join(options.config.DATA_DIR, 'app.sqlite'));
  const defaults = createProviders(options.config);
  const service = new LearningService(db, options.config, options.translator ?? defaults.translator, options.speech ?? defaults.speech);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'], mediaSrc: ["'self'", 'blob:'], connectSrc: ["'self'"], upgradeInsecureRequests: null,
      },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });
  if (options.config.NODE_ENV !== 'production') {
    await app.register(cors, { origin: options.config.DEV_ORIGIN, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  }

  const requestsByAddress = new Map<string, number[]>();
  app.addHook('onRequest', async (request) => {
    const isGenerationRequest = request.method === 'POST' && (
      request.url === '/api/entries' || request.url === '/api/entry-batches' || /^\/api\/entries\/[^/]+\/audio$/.test(request.url)
    );
    if (!isGenerationRequest) return;
    const now = Date.now();
    const recent = (requestsByAddress.get(request.ip) ?? []).filter((time) => time > now - 60_000);
    if (recent.length >= options.config.GENERATION_REQUESTS_PER_MINUTE) throw new AppError('QUOTA_EXCEEDED', 'Bitte warte kurz, bevor du weitere Inhalte erstellst.', 429);
    recent.push(now);
    requestsByAddress.set(request.ip, recent);
  });

  app.get('/api/health/live', async () => ({ status: 'ok' }));
  app.get('/api/health/ready', async () => {
    db.db.prepare('SELECT 1').get();
    return { status: 'ready' };
  });

  app.get('/api/categories', async () => ({ categories: db.listCategories() }));
  app.post('/api/categories', async (request, reply) => {
    const { name } = categoryBody.parse(request.body);
    try {
      const category = db.createCategory(crypto.randomUUID(), name, new Date().toISOString());
      return reply.code(201).send({ category });
    } catch (error: any) {
      if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError('CONFLICT', 'Diese Kategorie gibt es bereits.', 409);
      throw error;
    }
  });
  app.patch('/api/categories/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const { name } = categoryBody.parse(request.body);
    try {
      const category = db.updateCategory(id, name, new Date().toISOString());
      if (!category) throw new AppError('NOT_FOUND', 'Die Kategorie wurde nicht gefunden.', 404);
      return { category };
    } catch (error: any) {
      if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError('CONFLICT', 'Diese Kategorie gibt es bereits.', 409);
      throw error;
    }
  });
  app.delete('/api/categories/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    if (!db.deleteCategory(id)) throw new AppError('NOT_FOUND', 'Die Kategorie wurde nicht gefunden.', 404);
    return reply.code(204).send();
  });

  app.get('/api/entries', async (request) => {
    const query = z.object({ search: z.string().trim().max(100).optional(), categoryId: z.string().uuid().optional() }).parse(request.query);
    return { entries: db.listEntries(query.search, query.categoryId) };
  });
  app.post('/api/entries', async (request, reply) => {
    const input = generateBody(options.config.MAX_TEXT_LENGTH).parse(request.body);
    const entry = await service.generate(input.sourceText, input.categoryId, input.voice);
    return reply.code(201).send({ entry });
  });
  app.post('/api/entry-batches', async (request, reply) => {
    const input = generateBatchBody(options.config.MAX_TEXT_LENGTH).parse(request.body);
    const entries = await service.generateBatch(input.sourceTexts, input.categoryId, input.voice);
    return reply.code(201).send({ entries });
  });
  app.patch('/api/entries/:id/category', async (request) => {
    const { id } = idParams.parse(request.params);
    const { categoryId } = categoryAssignment.parse(request.body);
    if (categoryId && !db.categoryExists(categoryId)) throw new AppError('INVALID_REQUEST', 'Die Kategorie existiert nicht.', 400);
    if (!db.updateEntryCategory(id, categoryId, new Date().toISOString())) throw new AppError('NOT_FOUND', 'Der Eintrag wurde nicht gefunden.', 404);
    return { entry: db.getEntry(id) };
  });
  app.post('/api/entries/:id/audio', async (request) => {
    const { id } = idParams.parse(request.params);
    return { entry: await service.retryAudio(id) };
  });
  app.delete('/api/entries/:id', async (request, reply) => {
    const { id } = idParams.parse(request.params);
    if (!service.deleteEntry(id)) throw new AppError('NOT_FOUND', 'Der Eintrag wurde nicht gefunden.', 404);
    return reply.code(204).send();
  });
  app.get('/api/audio/:cacheKey', async (request, reply) => {
    const { cacheKey } = audioParams.parse(request.params);
    const path = service.audioPath(cacheKey);
    if (!path) throw new AppError('NOT_FOUND', 'Audio wurde nicht gefunden.', 404);
    reply.header('Content-Type', 'audio/mpeg').header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(createReadStream(path));
  });
  app.get('/api/info', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const month = currentMonth();
    const usage = db.getUsage(month);
    return {
      providerMode: options.config.PROVIDER_MODE, month,
      usage: {
        translation: { used: usage.translation ?? 0, limit: options.config.TRANSLATION_MONTHLY_CHAR_LIMIT },
        speech: { used: usage.speech ?? 0, limit: options.config.SPEECH_MONTHLY_CHAR_LIMIT },
      },
      defaultVoice: options.config.AZURE_SPEECH_VOICE,
      voices: ITALIAN_VOICES,
    };
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: 'INVALID_REQUEST', message: 'Bitte prüfe deine Eingabe.' });
    const response = publicError(error);
    if (response.statusCode >= 500) request.log.error({ err: error, requestId: request.id }, 'request failed');
    return reply.code(response.statusCode).send(response.body);
  });

  const webRoot = resolve(options.webRoot ?? join(process.cwd(), 'apps/web/web-build'));
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Nicht gefunden.' });
    });
  }

  app.addHook('onClose', async () => db.close());
  return app;
}
