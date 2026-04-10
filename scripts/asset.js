#!/usr/bin/env node

/**
 * Asset manager CLI for Mint extensions.
 *
 * Subcommands:
 *   list            — list all assets in src/assets with type, size, and usage references
 *   add [file]      — copy a file into src/assets; interactive file picker when no path given
 *   remove [name]   — remove an asset; interactive picker + confirmation when no name given
 *
 * Usage (via npm scripts):
 *   npm run asset:list
 *   npm run asset:add -- path/to/image.png
 *   npm run asset:add                       (interactive)
 *   npm run asset:remove -- image.png
 *   npm run asset:remove                    (interactive)
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '../src');
const ASSETS_DIR = path.join(SRC_DIR, 'assets');

import { MIME_MAP } from './mime-map.js';

// --- ANSI color helpers ---
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

const col = (codes, text) => `${codes}${text}${RESET}`;

// ANSI cursor/line control sequences used for interactive menu redraws.
const CURSOR_UP = n => `\x1b[${n}A`; // move cursor up n lines

// Box-drawing characters for the usage reference tree in cmdList.
const TREE_BRANCH = '\u2514\u2500'; // └─

// --- Extension categories ---
// Single source of truth: maps a logical category to its file extensions.
const EXTENSION_CATEGORIES = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp', '.ico'],
  audio: ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a'],
  video: ['.mp4', '.webm', '.mov', '.avi'],
  font: ['.ttf', '.otf', '.woff', '.woff2'],
  other: ['.json', '.txt', '.pdf'],
};

// Set of all extensions accepted by findCandidateFiles.
const ASSET_EXTENSIONS = new Set(Object.values(EXTENSION_CATEGORIES).flat());

// Map of category → preview emoji.
const CATEGORY_EMOJI = {
  image: '🖼️ ',
  audio: '🔊 ',
  video: '🎬 ',
  font: '🔤 ',
  other: '📄 ',
};

// Reverse lookup: extension → category, for O(1) getPreviewEmoji calls.
const EXT_TO_CATEGORY = new Map(
  Object.entries(EXTENSION_CATEGORIES).flatMap(([cat, exts]) => exts.map(e => [e, cat]))
);

const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'build', 'dist', '.cache', 'coverage']);

/**
 * Recursively walk a directory and return all file paths.
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
 * Format a byte count as a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Return a preview emoji for an asset file based on its extension.
 * @param {string} ext - Lowercase file extension including the dot (e.g. '.png').
 * @returns {string}
 */
function getPreviewEmoji(ext) {
  const cat = EXT_TO_CATEGORY.get(ext);
  return (cat && CATEGORY_EMOJI[cat]) || '📄 ';
}

/**
 * Walk a directory tree looking for candidate asset files.
 * Skips hidden entries, common noise directories, and the assets directory itself.
 * @param {string} baseDir
 * @param {number} [maxDepth=4]
 * @param {number} [depth=0]
 * @returns {string[]}
 */
function findCandidateFiles(baseDir, maxDepth = 4, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(baseDir)) return [];
  const results = [];
  for (const entry of fs
    .readdirSync(baseDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(baseDir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      // ASSETS_DIR needs a full path comparison because "assets" alone is too generic a name.
      if (path.resolve(fullPath) === path.resolve(ASSETS_DIR)) continue;
      results.push(...findCandidateFiles(fullPath, maxDepth, depth + 1));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ASSET_EXTENSIONS.has(ext)) results.push(fullPath);
    }
  }
  return results;
}

/**
 * Display an interactive arrow-key selection menu on the terminal.
 * Returns the selected item's value, or null when cancelled or stdin is not a TTY.
 * @param {Array<{label: string, value: *}>} items
 * @param {string} menuPrompt
 * @returns {Promise<*>}
 */
async function interactiveSelect(items, menuPrompt) {
  if (items.length === 0) return null;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return null;

  // Enable keypress events only for this interactive flow.
  readline.emitKeypressEvents(process.stdin);

  let idx = 0;
  let lineCount = 0;

  const drawMenu = isFirstDraw => {
    if (!isFirstDraw && lineCount > 0) {
      // Move cursor up and clear each previously drawn line before rewriting.
      process.stdout.write(CURSOR_UP(lineCount));
      for (let i = 0; i < lineCount; i++) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        if (i < lineCount - 1) process.stdout.write('\n');
      }
      if (lineCount > 1) process.stdout.write(CURSOR_UP(lineCount - 1));
    }
    const lines = [
      col(BOLD + CYAN, `? ${menuPrompt}`),
      col(DIM, '  Use \u2191\u2193 arrows to move, Enter to select, Ctrl+C to cancel'),
    ];
    for (let i = 0; i < items.length; i++) {
      const active = i === idx;
      const marker = active ? col(CYAN, '\u276f') : ' ';
      const label = active ? col(BOLD, items[i].label) : items[i].label;
      lines.push(`  ${marker} ${label}`);
    }
    lineCount = lines.length;
    process.stdout.write(lines.join('\n') + '\n');
  };

  drawMenu(true);

  return new Promise(resolve => {
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let cleaned = false;

    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      process.stdin.removeListener('keypress', onKeypress);
      process.removeListener('SIGINT', sigintHandler);
      process.removeListener('uncaughtException', exceptionHandler);
      process.removeListener('unhandledRejection', rejectionHandler);
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Ignore errors when stdin is already closed.
      }
      process.stdin.pause();
    }

    function sigintHandler() {
      cleanup();
      process.stdout.write('\n');
      console.log('Cancelled.');
      resolve(null);
    }

    function exceptionHandler(err) {
      cleanup();
      console.error(err);
      process.exit(1);
    }

    function rejectionHandler(reason) {
      cleanup();
      console.error(reason);
      process.exit(1);
    }

    function onKeypress(str, key) {
      try {
        if (!key) return;
        if (key.name === 'up') {
          idx = (idx - 1 + items.length) % items.length;
          drawMenu(false);
        } else if (key.name === 'down') {
          idx = (idx + 1) % items.length;
          drawMenu(false);
        } else if (key.name === 'return') {
          cleanup();
          process.stdout.write('\n');
          resolve(items[idx].value);
        } else if (key.ctrl && key.name === 'c') {
          sigintHandler();
        }
      } catch (err) {
        cleanup();
        resolve(null);
        throw err;
      }
    }

    process.once('SIGINT', sigintHandler);
    process.once('uncaughtException', exceptionHandler);
    process.once('unhandledRejection', rejectionHandler);
    process.stdin.on('keypress', onKeypress);
  });
}

/**
 * Prompt the user with a question and return their trimmed answer.
 * @param {string} question
 * @param {string} [defaultVal='']
 * @returns {Promise<string>}
 */
function promptText(question, defaultVal = '') {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const q = defaultVal ? `${question} (${defaultVal}): ` : `${question}: `;
    rl.question(col(BOLD + CYAN, `? ${q}`), answer => {
      rl.close();
      resolve((answer || defaultVal).trim());
    });
  });
}

/**
 * Prompt for yes/no confirmation.
 * In non-TTY environments the question is skipped and true is returned automatically.
 * @param {string} question
 * @returns {Promise<boolean>}
 */
async function promptConfirm(question) {
  if (!process.stdin.isTTY) return true;
  const answer = await promptText(`${question} (yes/no)`, 'no');
  return answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y';
}

/**
 * Scan all JS source files for mint.assets.get/exists('name') references.
 * @param {string} assetName - Relative asset path to search for.
 * @returns {string[]} List of source files that reference the asset.
 */
function findReferences(assetName) {
  if (!fs.existsSync(SRC_DIR)) return [];

  const jsFiles = fs
    .readdirSync(SRC_DIR)
    .filter(f => f.endsWith('.js') && !f.startsWith('.'))
    .map(f => path.join(SRC_DIR, f));

  const escaped = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    'mint\\.assets\\.(?:get|exists)\\(\\s*([\'"])' + escaped + '\\1\\s*\\)'
  );

  return jsFiles.filter(f => pattern.test(fs.readFileSync(f, 'utf8')));
}

/**
 * Build a map from asset relative path → list of source files that reference it.
 * Scans each top-level src/*.js file exactly once regardless of the number of assets.
 * Recognises both mint.assets.get('path') and mint.assets.exists('path') call forms.
 * @param {string[]} assetRels - Relative paths of assets (relative to ASSETS_DIR).
 * @returns {Map<string, string[]>}
 */
function buildReferencesMap(assetRels) {
  const map = new Map(assetRels.map(rel => [rel, []]));
  if (!fs.existsSync(SRC_DIR)) return map;

  const jsFiles = fs
    .readdirSync(SRC_DIR)
    .filter(f => f.endsWith('.js') && !f.startsWith('.'))
    .map(f => path.join(SRC_DIR, f));

  for (const filePath of jsFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const rel of assetRels) {
      const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(
        'mint\\.assets\\.(?:get|exists)\\(\\s*([\'"])' + escaped + '\\1\\s*\\)'
      );
      if (pattern.test(content)) {
        map.get(rel).push(filePath);
      }
    }
  }
  return map;
}

/**
 * List all assets in src/assets with their MIME type, size, and usage reference count.
 * Also prints a usage-reference detail section and warns about unreferenced assets.
 */
function cmdList() {
  if (!fs.existsSync(ASSETS_DIR)) {
    console.log('No assets found (src/assets does not exist).');
    return;
  }

  const files = walk(ASSETS_DIR);
  if (files.length === 0) {
    console.log('No assets found in src/assets.');
    return;
  }

  const assetRels = files.map(f => path.relative(ASSETS_DIR, f).replace(/\\/g, '/'));
  // Scan source files once for all assets to avoid O(assets × sourceFiles) reads.
  const refsMap = buildReferencesMap(assetRels);

  const rows = files.map((f, i) => {
    const rel = assetRels[i];
    const ext = path.extname(f).toLowerCase();
    const mime = MIME_MAP[ext] || 'application/octet-stream';
    const size = fs.statSync(f).size;
    const refs = refsMap.get(rel) ?? [];
    return { rel, mime, size, refs };
  });

  const colName = Math.max('Name'.length, ...rows.map(r => r.rel.length));
  const colType = Math.max('Type'.length, ...rows.map(r => r.mime.length));
  const colSize = Math.max('Size'.length, ...rows.map(r => formatBytes(r.size).length));
  const colRefs = Math.max('Refs'.length, ...rows.map(r => String(r.refs.length).length));

  const pad = (s, w) => s + ' '.repeat(w - s.length);
  const padL = (s, w) => ' '.repeat(w - s.length) + s;
  const sep =
    `+-${'-'.repeat(colName)}-+-${'-'.repeat(colType)}-+` +
    `-${'-'.repeat(colSize)}-+-${'-'.repeat(colRefs)}-+`;

  console.log(sep);
  console.log(
    `| ${pad('Name', colName)} | ${pad('Type', colType)} | ${pad('Size', colSize)} | ${pad('Refs', colRefs)} |`
  );
  console.log(sep);
  for (const r of rows) {
    const nameCell = pad(r.rel, colName);
    const refsCell = padL(String(r.refs.length), colRefs);
    const coloredName = r.refs.length === 0 ? col(YELLOW, nameCell) : nameCell;
    const coloredRefs = r.refs.length > 0 ? col(GREEN, refsCell) : col(YELLOW, refsCell);
    console.log(
      `| ${coloredName} | ${pad(r.mime, colType)} | ${pad(formatBytes(r.size), colSize)} | ${coloredRefs} |`
    );
  }
  console.log(sep);
  console.log(`${rows.length} asset(s) total.`);

  // Usage reference details
  const referenced = rows.filter(r => r.refs.length > 0);
  const unreferenced = rows.filter(r => r.refs.length === 0);

  if (referenced.length > 0) {
    console.log('');
    console.log(col(BOLD, 'Usage references:'));
    for (const r of referenced) {
      console.log(`  ${col(CYAN, r.rel)}`);
      for (const ref of r.refs) {
        console.log(`    ${TREE_BRANCH} ${path.relative(process.cwd(), ref)}`);
      }
    }
  }

  if (unreferenced.length > 0) {
    console.log('');
    console.log(
      col(YELLOW, `\u26a0 ${unreferenced.length} asset(s) not referenced in any source file:`)
    );
    for (const r of unreferenced) {
      console.log(`  ${col(DIM, r.rel)}`);
    }
  }
}

/**
 * Copy a file into src/assets and print the usage snippet.
 * When no filePath is given and stdin is a TTY, an interactive file picker is shown.
 * @param {string|undefined} filePath - Path to the file to add.
 */
async function cmdAdd(filePath) {
  let absPath;
  let destSubdir = '';

  if (!filePath) {
    // Interactive mode: scan the current working directory for candidate asset files.
    if (!process.stdin.isTTY) {
      console.error('Usage: npm run asset:add -- <file>');
      process.exit(1);
    }

    console.log(col(BOLD, 'Interactive asset add'));
    process.stdout.write(col(DIM, 'Scanning for files\u2026') + '\n');

    const candidates = findCandidateFiles(process.cwd());

    // Remove the "Scanning…" line before drawing the menu.
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(CURSOR_UP(1));
    readline.clearLine(process.stdout, 0);

    if (candidates.length === 0) {
      console.error('No asset files found in the current directory.');
      console.error('Usage: npm run asset:add -- <file>');
      process.exit(1);
    }

    const MAX_ITEMS = 20;
    const shown = candidates.slice(0, MAX_ITEMS);
    if (candidates.length > MAX_ITEMS) {
      console.log(col(DIM, `(showing first ${MAX_ITEMS} of ${candidates.length} files)`));
    }

    const items = shown.map(f => {
      const rel = path.relative(process.cwd(), f).replace(/\\/g, '/');
      const ext = path.extname(f).toLowerCase();
      const size = fs.statSync(f).size;
      const emoji = getPreviewEmoji(ext);
      const mime = MIME_MAP[ext] || 'application/octet-stream';
      return {
        label: `${rel}  ${col(DIM, `(${emoji}${mime}, ${formatBytes(size)})`)}`,
        value: f,
      };
    });

    const selected = await interactiveSelect(items, 'Select file to add:');
    if (!selected) process.exit(0);
    absPath = selected;

    // Ask which subdirectory inside assets/ to store the file in.
    destSubdir = await promptText('Store in assets/ subdirectory? (leave blank for root)', '');
  } else {
    absPath = path.resolve(filePath);
  }

  if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(absPath);
  if (!stat.isFile()) {
    console.error(`Not a file: ${absPath}`);
    process.exit(1);
  }

  // Validate that the target directory stays within src/assets/ to prevent path traversal.
  const targetDir = destSubdir ? path.join(ASSETS_DIR, destSubdir) : ASSETS_DIR;
  const resolvedAssetsDir = path.resolve(ASSETS_DIR);
  const resolvedTargetDir = path.resolve(targetDir);
  if (
    resolvedTargetDir !== resolvedAssetsDir &&
    !resolvedTargetDir.startsWith(resolvedAssetsDir + path.sep)
  ) {
    console.error(col(RED, 'Invalid subdirectory: must be within src/assets/'));
    process.exit(1);
  }

  // Ensure src/assets (and optional subdirectory) exists.
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    if (!destSubdir) console.log('Created src/assets/');
  }

  const baseName = path.basename(absPath);
  const relDestName = destSubdir ? path.join(destSubdir, baseName).replace(/\\/g, '/') : baseName;
  const dest = path.join(targetDir, baseName);

  if (fs.existsSync(dest)) {
    console.error(col(RED, `Asset already exists: src/assets/${relDestName}`));
    console.error('Remove it first with:  npm run asset:remove -- ' + relDestName);
    process.exit(1);
  }

  fs.copyFileSync(absPath, dest);

  const ext = path.extname(baseName).toLowerCase();
  const mime = MIME_MAP[ext] || 'application/octet-stream';
  const size = fs.statSync(dest).size;
  const emoji = getPreviewEmoji(ext);

  console.log(
    col(GREEN, `\u2713 Added src/assets/${relDestName}`) +
      `  (${emoji}${mime}, ${formatBytes(size)})`
  );
  console.log('');
  console.log(col(BOLD, 'Usage snippets:'));
  console.log(col(DIM, '  Retrieve the asset data URI:'));
  console.log(col(CYAN, `    mint.assets.get('${relDestName}')`));
  console.log(col(DIM, '  Check whether an asset is available before using it:'));
  console.log(col(CYAN, `    mint.assets.exists('${relDestName}')`));
}

/**
 * Remove an asset from src/assets after checking for references in src/.
 * When no assetName is given and stdin is a TTY, an interactive picker is shown.
 * A confirmation prompt is always shown before deletion when stdin is a TTY.
 * @param {string|undefined} assetName - File name (or relative path) of the asset to remove.
 */
async function cmdRemove(assetName) {
  if (!assetName) {
    // Interactive mode: list existing assets.
    if (!process.stdin.isTTY) {
      console.error('Usage: npm run asset:remove -- <name>');
      process.exit(1);
    }

    if (!fs.existsSync(ASSETS_DIR)) {
      console.error('No assets found (src/assets does not exist).');
      process.exit(1);
    }

    const files = walk(ASSETS_DIR);
    if (files.length === 0) {
      console.error('No assets found in src/assets.');
      process.exit(1);
    }

    const assetRels = files.map(f => path.relative(ASSETS_DIR, f).replace(/\\/g, '/'));
    // Scan source files once for all assets to build the reference counts.
    const refsMap = buildReferencesMap(assetRels);

    const items = files.map((f, i) => {
      const rel = assetRels[i];
      const ext = path.extname(f).toLowerCase();
      const size = fs.statSync(f).size;
      const emoji = getPreviewEmoji(ext);
      const refCount = refsMap.get(rel)?.length ?? 0;
      const refInfo =
        refCount > 0
          ? col(GREEN, ` (referenced in ${refCount} file${refCount > 1 ? 's' : ''})`)
          : col(DIM, ' (unreferenced)');
      return {
        label: `${rel}  ${col(DIM, `${emoji}${formatBytes(size)}`)}${refInfo}`,
        value: rel,
      };
    });

    const selected = await interactiveSelect(items, 'Select asset to remove:');
    if (!selected) process.exit(0);
    assetName = selected;
  }

  const assetPath = path.join(ASSETS_DIR, assetName);

  // Guard against path traversal: resolved path must stay inside ASSETS_DIR.
  const resolvedAssetsDir = path.resolve(ASSETS_DIR);
  const resolvedAssetPath = path.resolve(assetPath);
  if (
    resolvedAssetPath !== resolvedAssetsDir &&
    !resolvedAssetPath.startsWith(resolvedAssetsDir + path.sep)
  ) {
    console.error(col(RED, `Invalid asset path: src/assets/${assetName}`));
    process.exit(1);
  }

  if (!fs.existsSync(assetPath)) {
    console.error(col(RED, `Asset not found: src/assets/${assetName}`));
    process.exit(1);
  }

  // Safety check — look for mint.assets.get/exists('assetName') in source files
  const refs = findReferences(assetName);
  if (refs.length > 0) {
    console.error(
      col(RED, `\u2717 Cannot remove '${assetName}' \u2014 it is still referenced in:`)
    );
    for (const r of refs) {
      console.error(`  ${path.relative(process.cwd(), r)}`);
    }
    console.error('Remove or update those references first, then run this command again.');
    process.exit(1);
  }

  // Confirmation prompt before deletion.
  const confirmed = await promptConfirm(`Remove src/assets/${assetName}?`);
  if (!confirmed) {
    console.log('Aborted. No changes made.');
    process.exit(0);
  }

  fs.rmSync(assetPath, { force: true });
  console.log(col(GREEN, `\u2713 Removed src/assets/${assetName}`));
}

// --- CLI entry point ---
const [, , subcommand, ...rest] = process.argv;

async function main() {
  switch (subcommand) {
    case 'list':
      cmdList();
      break;
    case 'add':
      await cmdAdd(rest[0]);
      break;
    case 'remove':
      await cmdRemove(rest[0]);
      break;
    default:
      console.error('Unknown subcommand:', subcommand ?? '(none)');
      console.error('');
      console.error('Available subcommands:');
      console.error('  list              List assets in src/assets with type, size, and usage');
      console.error(
        '  add [file]        Copy a file into src/assets (interactive if no file given)'
      );
      console.error('  remove [name]     Remove an asset (interactive if no name given)');
      process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
