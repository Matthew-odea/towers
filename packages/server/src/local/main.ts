import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlayerId } from '@towers/engine';
import type { TestHooks } from '../core/types';
import { startLocalServer } from './server';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const port = Number(process.env.TOWERS_SERVER_PORT ?? process.env.PORT ?? 8787);

/**
 * End-to-end test mode (TOWERS_TEST=1, local server only): every match uses a fixed seed, the
 * creator gets a fixed seat and optional dice are queued, so Playwright runs are repeatable.
 *   TOWERS_TEST_SEED (default "e2e"), TOWERS_TEST_SEAT (red|black, default red),
 *   TOWERS_TEST_FIRST (red|black, default red), TOWERS_TEST_DICE ("3,4,6,6", default none).
 * Stats go to a separate file so tests never touch real stats.
 */
function testHooks(): TestHooks | undefined {
  if (process.env.TOWERS_TEST !== '1') return undefined;
  const seat = (v: string | undefined, d: PlayerId): PlayerId => (v === 'red' || v === 'black' ? v : d);
  const dice = (process.env.TOWERS_TEST_DICE ?? '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 6);
  return {
    seed: process.env.TOWERS_TEST_SEED || 'e2e',
    creatorSeat: seat(process.env.TOWERS_TEST_SEAT, 'red'),
    firstPlayer: seat(process.env.TOWERS_TEST_FIRST, 'red'),
    dice,
  };
}

const hooks = testHooks();
const srv = await startLocalServer({
  port,
  statsFile: path.join(repoRoot, '.data', hooks ? 'stats.e2e.json' : 'stats.json'),
  clientDir: process.env.TOWERS_CLIENT_DIR ?? path.join(repoRoot, 'packages', 'client', 'dist'),
  testHooks: hooks,
});
console.log(`towers server listening on :${srv.port} (WebSocket at /ws)${hooks ? ' [TEST MODE: fixed seed]' : ''}`);

const shutdown = () => {
  srv.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
