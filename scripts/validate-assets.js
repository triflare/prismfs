#!/usr/bin/env node

/**
 * Pre-build asset reference validation.
 *
 * Scans source files for mint.assets.get('path') / mint.assets.exists('path') usages
 * and verifies each referenced file exists under src/assets/.  Unreferenced assets in
 * src/assets/ produce warnings but do not fail the build.
 *
 * Usage:
 *   node scripts/validate-assets.js           (standalone)
 *   import { validateAssetReferences } from './validate-assets.js'  (from build.js)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '../src');

/**
 * Recursively walk a directory and return all absolute file paths.
 * @param {string} dir
 * @returns {string[]}
 */
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(d => {
      const res = path.join(dir, d.name);
      return d.isDirectory() ? walk(res) : [res];
    });
}

/**
 * Scan all .js source files in the top level of srcDir for
 * mint.assets.get('path') and mint.assets.exists('path') references.
 * Sub-directories are not scanned, matching the same convention used by
 * the build's getSourceFiles() helper.
 *
 * @param {string} srcDir
 * @returns {{ file: string, assetPath: string }[]}
 */
export function collectAssetReferences(srcDir) {
  if (!fs.existsSync(srcDir)) return [];

  const files = fs
    .readdirSync(srcDir)
    .filter(f => (f.endsWith('.js') || f.endsWith('.ts')) && !f.startsWith('.'))
    .sort()
    .map(f => path.join(srcDir, f));

  const refs = [];
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);
    // Use matchAll so each file scan gets a fresh RegExp with no shared lastIndex
    for (const m of content.matchAll(/mint\.assets\.(?:get|exists)\(\s*(['"])([^'"]+)\1\s*\)/g)) {
      refs.push({ file: fileName, assetPath: m[2] });
    }
  }
  return refs;
}

/**
 * Validate that every mint.assets.get/exists('path') reference in source files
 * resolves to an existing file under src/assets/.  Also warns about assets that
 * exist in src/assets/ but are not referenced by any source file.
 *
 * @param {string} [srcDir] - Source directory to scan (defaults to `../src`).
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateAssetReferences(srcDir = SRC_DIR) {
  const assetsDir = path.join(srcDir, 'assets');
  const errors = [];
  const warnings = [];

  const refs = collectAssetReferences(srcDir);

  // --- Check every reference resolves to an existing file ---
  for (const { file, assetPath } of refs) {
    // Normalise separators so keys are consistent across platforms
    const normalisedPath = assetPath.replace(/\\/g, '/');
    const fullPath = path.join(assetsDir, normalisedPath);

    // Guard against path traversal: resolved path must stay inside assetsDir
    const resolvedAssets = path.resolve(assetsDir);
    const resolvedFull = path.resolve(fullPath);
    if (!resolvedFull.startsWith(resolvedAssets + path.sep) && resolvedFull !== resolvedAssets) {
      errors.push(
        `  ✗ [${file}] mint.assets.get/exists('${assetPath}') — invalid path (traversal detected)`
      );
      continue;
    }

    // Must exist and be a regular file
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isFile()) {
      errors.push(
        `  ✗ [${file}] mint.assets.get/exists('${assetPath}') — file not found: src/assets/${normalisedPath}`
      );
    }
  }

  // --- Warn on unreferenced assets ---
  if (fs.existsSync(assetsDir)) {
    const existing = walk(assetsDir).map(f => path.relative(assetsDir, f).replace(/\\/g, '/'));
    // Normalise referenced asset paths to POSIX-style so comparisons are consistent
    const referenced = new Set(
      refs.map(r => path.posix.normalize(r.assetPath.replace(/\\/g, '/')))
    );
    for (const assetFile of existing) {
      if (!referenced.has(assetFile)) {
        warnings.push(`  ⚠ Asset not referenced in any source file: src/assets/${assetFile}`);
      }
    }
  }

  return { errors, warnings };
}

// --- Standalone runner ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Validating asset references...');
  const { errors, warnings } = validateAssetReferences();

  for (const w of warnings) {
    console.warn(w);
  }

  if (errors.length > 0) {
    console.error('✗ Asset reference validation failed:');
    for (const err of errors) {
      console.error(err);
    }
    process.exit(1);
  }

  console.log('✓ All asset references are valid.');
}
