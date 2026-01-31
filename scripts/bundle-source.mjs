#!/usr/bin/env node
/**
 * Bundle source files into a zip for distribution
 * Run before build: node scripts/bundle-source.mjs
 */

import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const outputDir = resolve(rootDir, 'public');
const outputFile = resolve(outputDir, 'source.zip');

// Files and directories to include in the source bundle
const includes = [
  'src/',
  'scripts/',
  'index.html',
  'package.json',
  'vite.config.mjs',
  'README.md',
  'sample.svg'
];

// Ensure public dir exists
if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

const output = createWriteStream(outputFile);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const sizeKB = (archive.pointer() / 1024).toFixed(1);
  console.log(`✓ Created source.zip (${sizeKB} KB)`);
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);

// Add files and directories
for (const item of includes) {
  const fullPath = resolve(rootDir, item);
  if (existsSync(fullPath)) {
    if (item.endsWith('/')) {
      archive.directory(fullPath, item);
    } else {
      archive.file(fullPath, { name: item });
    }
  }
}

await archive.finalize();
