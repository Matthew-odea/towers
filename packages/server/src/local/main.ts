import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalServer } from './server';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const port = Number(process.env.PORT ?? 8787);

const srv = await startLocalServer({
  port,
  statsFile: path.join(repoRoot, '.data', 'stats.json'),
  clientDir: path.join(repoRoot, 'packages', 'client', 'dist'),
});
console.log(`towers server listening on :${srv.port} (WebSocket at /ws)`);

const shutdown = () => {
  srv.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
