#!/usr/bin/env node

/**
 * Test runner — discovers all *.test.js files under the tests/ directory and
 * runs them with Node's built-in test runner (node:test).
 *
 * Usage:
 *   node scripts/test.js           (run all tests once)
 *   node scripts/test.js --watch   (re-run tests on file changes)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = path.join(__dirname, '../tests');

const watchMode = process.argv.includes('--watch');

/**
 * Recursively collect all *.test.js files under a directory, sorted.
 * @param {string} dir
 * @returns {string[]}
 */
function findTestFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  const files = [];

  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(full);
    }
  }

  return files;
}

const testFiles = findTestFiles(TESTS_DIR);

if (testFiles.length === 0) {
  console.error('No test files found in', TESTS_DIR);
  process.exit(1);
}

console.log(`Running ${testFiles.length} test file(s)...\n`);

const args = ['--test', ...(watchMode ? ['--watch'] : []), ...testFiles];
const proc = spawn(process.execPath, args, { stdio: 'inherit' });
proc.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});
