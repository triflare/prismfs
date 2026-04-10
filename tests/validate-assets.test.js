/**
 * Unit tests for scripts/validate-assets.js
 *
 * Uses temporary directories so no real src/assets files are required.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { collectAssetReferences, validateAssetReferences } from '../scripts/validate-assets.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a temporary directory tree and return its path.
 * The caller is responsible for removing it after the test.
 * @param {Record<string, string>} files - relative path → file content
 * @returns {string} absolute path of the temp root
 */
function makeTempSrc(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-asset-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
  }
  return root;
}

// ---------------------------------------------------------------------------
// collectAssetReferences
// ---------------------------------------------------------------------------

describe('collectAssetReferences()', () => {
  it('returns empty array when srcDir does not exist', () => {
    const missingDir = path.join(
      os.tmpdir(),
      `mint-asset-test-missing-${process.pid}-${Date.now()}`
    );
    assert.ok(!fs.existsSync(missingDir));
    const refs = collectAssetReferences(missingDir);
    assert.deepEqual(refs, []);
  });

  it('returns empty array when no source files reference assets', () => {
    const srcDir = makeTempSrc({ 'module.js': 'const x = 1;\n' });
    try {
      const refs = collectAssetReferences(srcDir);
      assert.deepEqual(refs, []);
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('collects a single mint.assets.get reference with single quotes', () => {
    const srcDir = makeTempSrc({ 'ext.js': "mint.assets.get('icons/menu.png')\n" });
    try {
      const refs = collectAssetReferences(srcDir);
      assert.equal(refs.length, 1);
      assert.equal(refs[0].file, 'ext.js');
      assert.equal(refs[0].assetPath, 'icons/menu.png');
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('collects a single mint.assets.get reference with double quotes', () => {
    const srcDir = makeTempSrc({ 'ext.js': 'mint.assets.get("icons/block.png")\n' });
    try {
      const refs = collectAssetReferences(srcDir);
      assert.equal(refs.length, 1);
      assert.equal(refs[0].assetPath, 'icons/block.png');
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('collects a mint.assets.exists reference', () => {
    const srcDir = makeTempSrc({ 'ext.js': "mint.assets.exists('optional.png')\n" });
    try {
      const refs = collectAssetReferences(srcDir);
      assert.equal(refs.length, 1);
      assert.equal(refs[0].assetPath, 'optional.png');
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('collects multiple references across multiple files', () => {
    const srcDir = makeTempSrc({
      '01-a.js': "mint.assets.get('a.png')\nmint.assets.get('b.png')\n",
      '02-b.js': "mint.assets.get('c.png')\n",
    });
    try {
      const refs = collectAssetReferences(srcDir);
      assert.equal(refs.length, 3);
      const paths = refs.map(r => r.assetPath);
      assert.ok(paths.includes('a.png'));
      assert.ok(paths.includes('b.png'));
      assert.ok(paths.includes('c.png'));
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('ignores non-.js and non-.ts files', () => {
    const srcDir = makeTempSrc({ 'readme.md': "__ASSET__('image.png')\n" });
    try {
      const refs = collectAssetReferences(srcDir);
      assert.deepEqual(refs, []);
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('collects mint.assets.get references from .ts files', () => {
    const srcDir = makeTempSrc({ 'ext.ts': "mint.assets.get('icons/menu.png')\n" });
    try {
      const refs = collectAssetReferences(srcDir);
      assert.equal(refs.length, 1);
      assert.equal(refs[0].file, 'ext.ts');
      assert.equal(refs[0].assetPath, 'icons/menu.png');
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('collects references from mixed .js and .ts files', () => {
    const srcDir = makeTempSrc({
      '01-a.js': "mint.assets.get('a.png')\n",
      '02-b.ts': "mint.assets.get('b.png')\n",
    });
    try {
      const refs = collectAssetReferences(srcDir);
      assert.equal(refs.length, 2);
      const paths = refs.map(r => r.assetPath);
      assert.ok(paths.includes('a.png'));
      assert.ok(paths.includes('b.png'));
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// validateAssetReferences
// ---------------------------------------------------------------------------

describe('validateAssetReferences()', () => {
  it('returns no errors and no warnings when there are no references and no assets', () => {
    const srcDir = makeTempSrc({ 'ext.js': 'const x = 1;\n' });
    try {
      const { errors, warnings } = validateAssetReferences(srcDir);
      assert.deepEqual(errors, []);
      assert.deepEqual(warnings, []);
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('returns no errors when all referenced assets exist', () => {
    const srcDir = makeTempSrc({
      'ext.js': "mint.assets.get('icons/menu.png')\n",
      'assets/icons/menu.png': 'PNG_DATA',
    });
    try {
      const { errors } = validateAssetReferences(srcDir);
      assert.deepEqual(errors, []);
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('returns an error for each missing asset, including source file name and path', () => {
    const srcDir = makeTempSrc({
      '01-core.js': "mint.assets.get('icons/missing.png')\n",
    });
    try {
      const { errors } = validateAssetReferences(srcDir);
      assert.equal(errors.length, 1);
      assert.ok(errors[0].includes('01-core.js'), 'error should include source file name');
      assert.ok(
        errors[0].includes('icons/missing.png'),
        'error should include the missing asset path'
      );
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('reports one error per missing reference', () => {
    const srcDir = makeTempSrc({
      'a.js': "mint.assets.get('one.png')\nmint.assets.get('two.png')\n",
    });
    try {
      const { errors } = validateAssetReferences(srcDir);
      assert.equal(errors.length, 2);
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('warns about unreferenced assets', () => {
    const srcDir = makeTempSrc({
      'ext.js': 'const x = 1;\n',
      'assets/unused.png': 'PNG_DATA',
    });
    try {
      const { errors, warnings } = validateAssetReferences(srcDir);
      assert.deepEqual(errors, []);
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0].includes('unused.png'), 'warning should mention the unused asset');
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('does not warn about assets that are referenced', () => {
    const srcDir = makeTempSrc({
      'ext.js': "mint.assets.get('logo.png')\nmint.assets.get('icons\\\\menu.png')\n",
      'assets/logo.png': 'PNG_DATA',
      'assets/icons/menu.png': 'PNG_DATA',
    });
    try {
      const { errors, warnings } = validateAssetReferences(srcDir);
      assert.deepEqual(errors, []);
      assert.deepEqual(warnings, []);
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('handles missing srcDir gracefully — no errors, no warnings', () => {
    const missingDir = path.join(os.tmpdir(), `mint-asset-missing-${process.pid}-${Date.now()}`);
    if (fs.existsSync(missingDir)) {
      fs.rmSync(missingDir, { recursive: true, force: true });
    }
    const { errors, warnings } = validateAssetReferences(missingDir);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  it('rejects path traversal references with an error', () => {
    const srcDir = makeTempSrc({
      'ext.js': "mint.assets.get('../escape.png')\n",
    });
    try {
      const { errors } = validateAssetReferences(srcDir);
      assert.equal(errors.length, 1);
      assert.ok(errors[0].includes('traversal'), 'error should mention traversal');
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });

  it('rejects a reference that resolves to a directory, not a file', () => {
    const srcDir = makeTempSrc({
      'ext.js': "mint.assets.get('subdir')\n",
      // create a subdirectory (not a file) with that name
      'assets/subdir/.keep': '',
    });
    try {
      const { errors } = validateAssetReferences(srcDir);
      assert.equal(errors.length, 1);
      assert.ok(errors[0].includes('subdir'), 'error should mention the asset path');
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true });
    }
  });
});
