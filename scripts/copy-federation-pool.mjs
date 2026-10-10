import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'vendor/federation-pool');
const sibling = join(root, '../federation-pool/dist');

mkdirSync(dest, { recursive: true });
writeFileSync(
  join(dest, 'README.md'),
  'Filled from ../federation-pool/dist at build time when that clone exists. Not an npm package.\n',
);

if (existsSync(join(sibling, 'cli.js'))) {
  cpSync(sibling, dest, { recursive: true });
}
