import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await buildApp({ config });

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, 'graceful shutdown');
  await app.close();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
