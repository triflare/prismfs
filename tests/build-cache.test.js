import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === '.git' ||
      entry.name === 'build' ||
      entry.name === '.mint-cache'
    )
      continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function runBuild(cwd, args = []) {
  return spawnSync(process.execPath, ['scripts/build.js', ...args], {
    cwd,
    encoding: 'utf8',
  });
}

describe('build cache', () => {
  it('uses cache on second build and can be disabled with --no-cache', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-build-cache-'));
    try {
      copyDir(REPO_ROOT, tempDir);
      fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tempDir, 'node_modules'));

      const first = runBuild(tempDir);
      assert.equal(first.status, 0, first.stderr || first.stdout);
      assert.match(first.stdout, /Cache: \d+ hits, \d+ misses/);
      assert.ok(fs.existsSync(path.join(tempDir, '.mint-cache', 'build-cache.json')));

      const second = runBuild(tempDir);
      assert.equal(second.status, 0, second.stderr || second.stdout);
      assert.match(second.stdout, /Cache: \d+ hits, \d+ misses/);

      const noCache = runBuild(tempDir, ['--no-cache']);
      assert.equal(noCache.status, 0, noCache.stderr || noCache.stdout);
      assert.match(noCache.stdout, /Cache: disabled \(--no-cache\)/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('clears cache with --clean-cache and recreates it', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-build-clean-cache-'));
    try {
      copyDir(REPO_ROOT, tempDir);
      fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tempDir, 'node_modules'));

      const first = runBuild(tempDir);
      assert.equal(first.status, 0, first.stderr || first.stdout);
      const cacheFile = path.join(tempDir, '.mint-cache', 'build-cache.json');
      assert.ok(fs.existsSync(cacheFile));

      const clean = runBuild(tempDir, ['--clean-cache']);
      assert.equal(clean.status, 0, clean.stderr || clean.stdout);
      assert.match(clean.stdout, /Cache cleared: \.mint-cache\//);
      assert.ok(fs.existsSync(cacheFile));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
