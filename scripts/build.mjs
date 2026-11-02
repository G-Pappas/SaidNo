// Builds the extension into dist/ and prints a SHA-256 of its contents, so anyone
// can rebuild from source and check they get the same bytes as the store version.
//
//   npm ci --ignore-scripts && npm run build

import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const src = join(root, 'src');
const dist = join(root, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(dist);

await build({
  entryPoints: {
    background: join(src, 'background.js'),
    content: join(src, 'content.js'),
    popup: join(src, 'popup.js'),
  },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  legalComments: 'eof',
  charset: 'utf8',
  logLevel: 'warning',
});

for (const file of ['manifest.json', 'popup.html', 'popup.css', 'icons']) {
  await cp(join(src, file), join(dist, file), { recursive: true });
}

// Deterministic digest over sorted relative paths and file contents.
async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)])),
  );
  return nested.flat();
}

const hash = createHash('sha256');
for (const file of (await listFiles(dist)).sort()) {
  hash.update(relative(dist, file) + '\0');
  hash.update(await readFile(file));
}
console.log(`dist/ sha256: ${hash.digest('hex')}`);
