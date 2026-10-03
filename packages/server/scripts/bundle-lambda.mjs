// Bundles src/aws/handler.ts (+ the engine) into infra/build/lambda/index.mjs and zips it.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const outDir = path.join(repoRoot, 'infra', 'build', 'lambda');
const zipFile = path.join(repoRoot, 'infra', 'build', 'lambda.zip');

rmSync(outDir, { recursive: true, force: true });
rmSync(zipFile, { force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [path.join(here, '..', 'src', 'aws', 'handler.ts')],
  outfile: path.join(outDir, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  legalComments: 'none',
  // The Node 22 Lambda runtime ships AWS SDK v3. `ws` is never imported by the Lambda code.
  external: ['@aws-sdk/*'],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});

if (!existsSync(path.join(outDir, 'index.mjs'))) throw new Error('bundle missing');
execFileSync('zip', ['-q', '-j', '-X', zipFile, 'index.mjs'], { cwd: outDir, stdio: 'inherit' });
console.log(`lambda.zip: ${(statSync(zipFile).size / 1024).toFixed(0)} KB (handler: index.handler)`);
