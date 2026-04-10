#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { validateOpcodeSignatures } from './validate.js';
import { validateAssetReferences } from './validate-assets.js';
import { MIME_MAP } from './mime-map.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_DIR = path.join(__dirname, '../src');
const BUILD_DIR = path.join(__dirname, '../build');
const CACHE_DIR = path.join(__dirname, '../.mint-cache');
const CACHE_FILE = path.join(CACHE_DIR, 'build-cache.json');
const OUTPUT_FILE = path.join(BUILD_DIR, 'extension.js');
const OUTPUT_MIN_FILE = path.join(BUILD_DIR, 'min.extension.js');
const OUTPUT_MAX_FILE = path.join(BUILD_DIR, 'pretty.extension.js');
const OUTPUT_REPORT_FILE = path.join(BUILD_DIR, 'BUILD_REPORT.md');
const OUTPUT_FILE_MAP = `${OUTPUT_FILE}.map`;
const OUTPUT_MIN_FILE_MAP = `${OUTPUT_MIN_FILE}.map`;
const OUTPUT_MAX_FILE_MAP = `${OUTPUT_MAX_FILE}.map`;

// Bundle size threshold (in bytes) above which the minified output is recommended for production
const RECOMMEND_MIN_THRESHOLD_BYTES = 50 * 1024; // 50 KB

// Width (in characters) of the failure/recovery banner lines
const BANNER_WIDTH = 62;

// Regex to match header metadata comment lines (Name, ID, Description, By, License, Version)
const COMMENTS_REGEX = /^\s*(Name|ID|Description|By|License|Version)\s*:/;
const SECTION_MARKER_COMMENT_REGEX = /^\s*===== .+ =====\s*$/;

// Check for --watch / --notify / --production flags early so helper functions can read them
const watchMode = process.argv.includes('--watch');
const notifyMode = process.argv.includes('--notify');
const noCacheMode = process.argv.includes('--no-cache');
const cleanCacheMode = process.argv.includes('--clean-cache');
const productionMode =
  process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const inlineSourcemapMode = process.argv.includes('--inline-sourcemap');
const sourcemapMode = process.argv.includes('--sourcemap') || inlineSourcemapMode;

// --- Build State Guard ---
let isBuilding = false;
let pendingBuild = false;

// Track whether the last build failed so a recovery message can be shown
let lastBuildFailed = false;

// Create build directory if it doesn't exist
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}
if ((cleanCacheMode || !noCacheMode) && !fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Compute SHA256 hash for a string
 * @param {string|Buffer} content
 * @returns {string}
 */
function hashString(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Compute SHA256 hash for a file.
 * @param {string} filePath
 * @returns {string}
 */
function hashFile(filePath) {
  return hashString(fs.readFileSync(filePath));
}

/**
 * Build a module dependency graph from import statements.
 * @param {string[]} sourceFiles
 * @returns {Map<string, Set<string>>} direct dependency graph
 */
function getModuleDependencies(sourceFiles) {
  const byBasename = new Map(sourceFiles.map(file => [path.basename(file), file]));
  const deps = new Map(sourceFiles.map(file => [file, new Set()]));
  // Static import parser for dependency invalidation (dynamic import() is intentionally ignored).
  const importRegex = /^\s*import(?:\s+type)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"];?\s*$/gm;

  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, 'utf8');
    const contentSansComments = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    let match;
    while ((match = importRegex.exec(contentSansComments)) !== null) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const normalized = specifier.replace(/\\/g, '/');
      const targetBase = path.basename(normalized);
      const resolved =
        byBasename.get(targetBase) ||
        byBasename.get(`${targetBase}.js`) ||
        byBasename.get(`${targetBase}.ts`) ||
        byBasename.get(targetBase.replace(/\.js$/i, '.ts')) ||
        byBasename.get(targetBase.replace(/\.ts$/i, '.js'));
      if (resolved) {
        deps.get(file).add(resolved);
      }
    }
  }

  return deps;
}

/**
 * Expand changed module set to include dependents (reverse dependencies).
 * @param {Map<string, Set<string>>} deps
 * @param {Set<string>} changed
 * @returns {Set<string>}
 */
function expandChangedWithDependents(deps, changed) {
  const reverse = new Map();
  for (const [file, requires] of deps.entries()) {
    for (const dep of requires) {
      if (!reverse.has(dep)) reverse.set(dep, new Set());
      reverse.get(dep).add(file);
    }
  }

  const affected = new Set(changed);
  const queue = [...changed];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    const dependents = reverse.get(current);
    if (!dependents) continue;
    for (const dep of dependents) {
      if (!affected.has(dep)) {
        affected.add(dep);
        queue.push(dep);
      }
    }
  }
  return affected;
}

/**
 * Get a stable hash for the current source and validation inputs.
 * @param {string[]} sourceFiles
 */
function getBuildInputs(sourceFiles) {
  const sourceHashes = {};
  for (const file of sourceFiles) {
    sourceHashes[file] = hashFile(file);
  }

  const validateScript = path.join(__dirname, 'validate.js');
  const validateAssetsScript = path.join(__dirname, 'validate-assets.js');
  const buildScriptHash = hashFile(fileURLToPath(import.meta.url));
  const validatorHash = hashFile(validateScript);
  const assetValidatorHash = hashFile(validateAssetsScript);

  const assetsDir = path.join(SRC_DIR, 'assets');
  const assetFiles = [];
  if (fs.existsSync(assetsDir)) {
    const walk = dir =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .flatMap(d => {
          const res = path.join(dir, d.name);
          return d.isDirectory() ? walk(res) : [res];
        });
    assetFiles.push(...walk(assetsDir));
  }
  const assetHashes = {};
  for (const file of assetFiles) {
    assetHashes[path.relative(SRC_DIR, file).replace(/\\/g, '/')] = hashString(
      fs.readFileSync(file)
    );
  }

  const manifestPath = path.join(SRC_DIR, 'manifest.json');
  const manifestHash = fs.existsSync(manifestPath) ? hashFile(manifestPath) : '';

  return {
    sourceHashes,
    assetHashes,
    buildScriptHash,
    validatorHash,
    assetValidatorHash,
    manifestHash,
  };
}

/**
 * Load persisted cache.
 */
function loadBuildCache() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Save persisted cache.
 * @param {object} data
 */
function saveBuildCache(data) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Clear build cache directory.
 */
function clearBuildCache() {
  if (fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Send an optional desktop notification (cross-platform best-effort).
 * Only fires when the --notify flag is present.
 * @param {string} title
 * @param {string} message
 */
function sendNotification(title, message) {
  if (!notifyMode) return;

  if (process.platform === 'darwin') {
    const script = `display notification "${message}" with title "${title}"`;
    execFile('osascript', ['-e', script], () => {});
  } else if (process.platform === 'win32') {
    const psScript =
      `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null;` +
      `$t = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime]::new();` +
      `$t.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">${title}</text><text id="2">${message}</text></binding></visual></toast>');` +
      `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Mint').Show([Windows.UI.Notifications.ToastNotification]::new($t))`;
    execFile('powershell', ['-command', psScript], () => {});
  } else {
    execFile('notify-send', [title, message], () => {});
  }
}

/**
 * Print a highlighted, prominent failure banner to stderr.
 * @param {string} message - Root cause description.
 */
function printFailureBanner(message) {
  const bar = '═'.repeat(BANNER_WIDTH);

  // Calculate content width (account for visual prefix/suffix: 2 spaces on each side = 4 chars)
  const headerLabel = '✗ BUILD FAILED';
  const visiblePrefixSuffixLength = 4; // 2 spaces before + 2 spaces after
  const contentWidth = BANNER_WIDTH - visiblePrefixSuffixLength;

  // Center the label within the content width
  const totalPadding = contentWidth - headerLabel.length;
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;
  const paddedHeader = ' '.repeat(leftPadding) + headerLabel + ' '.repeat(rightPadding);

  console.error(`\x1b[41m\x1b[97m\x1b[1m  ${paddedHeader}  \x1b[0m`);
  console.error(`\x1b[31m${bar}\x1b[0m`);
  console.error(`\x1b[31m  Root cause: ${message}\x1b[0m`);
  console.error(`\x1b[31m${bar}\x1b[0m`);
}

/**
 * Print a highlighted recovery banner when a build succeeds after a failure.
 */
function printRecoveryBanner() {
  console.log(
    `\x1b[42m\x1b[30m\x1b[1m  ✓ BUILD RECOVERED — errors resolved, build is passing again  \x1b[0m`
  );
}

/**
 * Read manifest file if it exists
 */
function getManifest() {
  const manifestPath = path.join(SRC_DIR, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (_err) {
      console.warn('Warning: Could not parse manifest.json');
      return {};
    }
  }
  return {};
}

/**
 * Generate Scratch extension header
 */
function generateHeader(manifest) {
  const metadata = {
    name: manifest.name || 'My Extension',
    id: manifest.id || 'myExtension',
    description: manifest.description || 'A TurboWarp extension',
    by: manifest.author || 'Anonymous',
    version: manifest.version || '1.0.0',
    license: manifest.license || 'MIT',
    url: manifest.url || 'https://example.com/my-extension',
  };

  let header = '';
  header += `// Name         :  ${metadata.name}\n`;
  header += `// ID           :  ${metadata.id}\n`;
  header += `// Description  :  ${metadata.description}\n`;
  header += `// By           :  ${metadata.by}\n`;
  header += `// License      :  ${metadata.license}\n`;
  header += `\n`;
  header += `// Version      :  ${metadata.version}\n`;
  header += `\n`;
  header += `// This file was generated by Mint, the new bundling toolchain for custom TurboWarp extensions.\n`;
  header += `// It is not recommended to edit this file on your own.\n`;
  header += `// Instead, edit it in this repository: ${metadata.url}\n`;
  header += '\n';

  return header;
}

/**
 * Get all JS and TS files from src directory in order
 */
function getSourceFiles() {
  const files = fs
    .readdirSync(SRC_DIR)
    .filter(file => (file.endsWith('.js') || file.endsWith('.ts')) && !file.startsWith('.'))
    .sort();

  return files.map(file => path.join(SRC_DIR, file));
}

/**
 * Transpile a TypeScript source string to JavaScript using esbuild.
 *
 * @param {string} content  - Raw TypeScript source
 * @param {string} filePath - Absolute path (used for error messages and esbuild sourcefile metadata)
 * @returns {Promise<string>} Transpiled JavaScript
 */
async function transpileTypeScript(content, filePath) {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    throw new Error(
      `TypeScript file detected (${path.basename(filePath)}) but "esbuild" is not installed. Run: npm install --save-dev esbuild`
    );
  }

  const result = await esbuild.transform(content, {
    loader: 'ts',
    target: 'es2017',
    sourcefile: path.basename(filePath),
    sourcemap: false,
  });

  return result.code;
}

/**
 * Generate a Markdown build report summarising output sizes and recommending an artifact.
 *
 * Recommendation logic (deterministic):
 *   - When standard output is >= RECOMMEND_MIN_THRESHOLD_BYTES AND min artifact was generated → recommend minified for production.
 *   - Otherwise → recommend standard for production.
 *   - Always recommend pretty output for debugging (when generated).
 *
 * @param {{ standard: number|null, min: number|null, pretty: number|null }} sizes - byte counts for each artifact (null = not generated)
 * @param {{ enabled: boolean, inline: boolean, standard: boolean, min: boolean, pretty: boolean }} sourcemaps
 */
function generateBuildReport(sizes, sourcemaps) {
  const formatBytes = bytes =>
    bytes !== null ? `${(bytes / 1024).toFixed(2)} KB` : '_not generated_';

  const standardBytes = sizes.standard;
  const minAvailable = sizes.min !== null;
  const prettyAvailable = sizes.pretty !== null;
  const recommendProd =
    standardBytes !== null && standardBytes >= RECOMMEND_MIN_THRESHOLD_BYTES && minAvailable
      ? '`min.extension.js`'
      : '`extension.js`';

  const rows = [
    [
      '`extension.js`',
      formatBytes(sizes.standard),
      'Standard build — balanced output, suitable for most uses',
    ],
    [
      '`min.extension.js`',
      formatBytes(sizes.min),
      'Minified build — smallest size, best for production deployment',
    ],
    [
      '`pretty.extension.js`',
      formatBytes(sizes.pretty),
      'Formatted build — human-readable, best for debugging',
    ],
  ];

  const colWidths = rows.reduce(
    (acc, row) => row.map((cell, i) => Math.max(acc[i], cell.length)),
    ['File'.length, 'Size'.length, 'Description'.length]
  );

  const pad = (str, width) => str + ' '.repeat(width - str.length);
  const separator = colWidths.map(w => '-'.repeat(w)).join(' | ');
  const header = colWidths.map((w, i) => pad(['File', 'Size', 'Description'][i], w)).join(' | ');
  const tableRows = rows.map(row => row.map((cell, i) => pad(cell, colWidths[i])).join(' | '));

  const table = [`| ${header} |`, `| ${separator} |`, ...tableRows.map(r => `| ${r} |`)].join('\n');

  const report = [
    '# Build Report',
    '',
    `Generated: ${new Date().toUTCString()}`,
    '',
    '## Output Artifacts',
    '',
    table,
    '',
    '## Recommendations',
    '',
    `**Production use:** ${recommendProd}`,
    standardBytes !== null && standardBytes >= RECOMMEND_MIN_THRESHOLD_BYTES && minAvailable
      ? `> Bundle size is ${formatBytes(standardBytes)}, which exceeds the ${formatBytes(RECOMMEND_MIN_THRESHOLD_BYTES)} threshold. Use the minified output to reduce load time.`
      : standardBytes !== null && standardBytes >= RECOMMEND_MIN_THRESHOLD_BYTES && !minAvailable
        ? `> Bundle size is ${formatBytes(standardBytes)}, which exceeds the ${formatBytes(RECOMMEND_MIN_THRESHOLD_BYTES)} threshold. Install \`terser\` to enable minified output.`
        : `> Bundle size is ${formatBytes(standardBytes)}, which is below the ${formatBytes(RECOMMEND_MIN_THRESHOLD_BYTES)} threshold. The standard output is suitable for production.`,
    '',
    `**Debugging:** \`pretty.extension.js\``,
    prettyAvailable
      ? '> The formatted output preserves whitespace and structure, making it easy to read and inspect.'
      : '> Install `prettier` to enable the formatted output for debugging.',
    '',
    '## How to Choose',
    '',
    '| Scenario | Recommended file |',
    '| --- | --- |',
    '| Deploying / sharing the extension | ' + recommendProd + ' |',
    '| Debugging or reading the source | `pretty.extension.js`' +
      (!prettyAvailable ? ' _(install `prettier` to generate)_' : '') +
      ' |',
    '| General development iteration | `extension.js` |',
    '',
    '## Source Maps',
    '',
    `**Enabled:** ${sourcemaps.enabled ? 'Yes' : 'No'}`,
    `**Mode:** ${sourcemaps.enabled ? (sourcemaps.inline ? 'Inline (`//# sourceMappingURL=data:...`)' : 'External (`*.map` files)') : 'Disabled'}`,
    '',
    '| Artifact | Source map |',
    '| --- | --- |',
    `| \`extension.js\` | ${sourcemaps.standard ? (sourcemaps.inline ? 'Inline' : '`extension.js.map`') : 'Not generated'} |`,
    `| \`min.extension.js\` | ${sourcemaps.min ? (sourcemaps.inline ? 'Inline' : '`min.extension.js.map`') : 'Not generated'} |`,
    `| \`pretty.extension.js\` | ${sourcemaps.pretty ? (sourcemaps.inline ? 'Inline' : '`pretty.extension.js.map`') : 'Not generated'} |`,
    '',
    '---',
    '',
    '_This report is auto-generated by Mint on every successful build. Do not edit manually._',
  ].join('\n');

  try {
    fs.writeFileSync(OUTPUT_REPORT_FILE, report, 'utf8');
    console.log(`  Build report written to ${OUTPUT_REPORT_FILE}`);
  } catch (err) {
    console.warn(`Warning: Could not write build report to ${OUTPUT_REPORT_FILE}: ${err.message}`);
  }
}

/**
 * Delete a file if it exists.
 * @param {string} filePath
 */
function removeFileIfExists(filePath) {
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

/**
 * Check whether output ends with an inline sourceMappingURL comment.
 * @param {string} code
 * @returns {boolean}
 */
function hasInlineSourceMapComment(code) {
  const trimmedCode = code.trimEnd();
  return (
    /(?:^|\n)\s*\/\/# sourceMappingURL=data:application\/json[^\r\n]*$/.test(trimmedCode) ||
    /(?:^|\n)\s*\/\*# sourceMappingURL=data:application\/json[\s\S]*\*\/$/.test(trimmedCode)
  );
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encode an integer as Base64 VLQ.
 * @param {number} value
 * @returns {string}
 */
function encodeVlq(value) {
  let vlq = value < 0 ? (-value << 1) + 1 : value << 1;
  let encoded = '';
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    encoded += BASE64_CHARS[digit];
  } while (vlq > 0);
  return encoded;
}

/**
 * Create a single-source line map where each generated line points to a source line.
 * @param {number} generatedLineCount
 * @param {number} sourceLineCount
 * @param {string} sourcePath
 * @param {string} sourceContent
 * @returns {object|null}
 */
function createSingleSourceLineMap(generatedLineCount, sourceLineCount, sourcePath, sourceContent) {
  if (generatedLineCount <= 0 || sourceLineCount <= 0) return null;

  const parts = [];
  let previousOriginalLine = 0;
  let hasMappedLine = false;

  for (let i = 0; i < generatedLineCount; i++) {
    if (i >= sourceLineCount) {
      parts.push('');
      continue;
    }
    const sourceLineIndex = i;
    parts.push(
      [
        encodeVlq(0),
        encodeVlq(0),
        encodeVlq(sourceLineIndex - (hasMappedLine ? previousOriginalLine : 0)),
        encodeVlq(0),
      ].join('')
    );
    previousOriginalLine = sourceLineIndex;
    hasMappedLine = true;
  }

  return {
    version: 3,
    sources: [sourcePath],
    sourcesContent: [sourceContent],
    names: [],
    mappings: parts.join(';'),
  };
}

/**
 * Build an indexed source map from bundle file section markers.
 * @param {string} outputCode
 * @param {Map<string, { sourcePath: string, sourceContent: string, sourceLineCount: number }>} sourceMetaByFilename
 * @param {string} outputFileName
 * @returns {object|null}
 */
function buildIndexedSourceMap(outputCode, sourceMetaByFilename, outputFileName) {
  const lines = outputCode.split('\n');
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*\/\/ ===== (.+) =====\s*$/);
    if (match) {
      markers.push({ filename: match[1], markerLine: i });
    }
  }
  if (markers.length === 0) return null;

  const sections = [];
  for (let i = 0; i < markers.length; i++) {
    const current = markers[i];
    const next = markers[i + 1];
    const startLine = current.markerLine + 1;
    const endLineExclusive = next ? next.markerLine : lines.length;
    const generatedLineCount = Math.max(0, endLineExclusive - startLine);
    if (generatedLineCount === 0) continue;

    const sourceMeta = sourceMetaByFilename.get(current.filename);
    if (!sourceMeta) continue;
    const map = createSingleSourceLineMap(
      generatedLineCount,
      sourceMeta.sourceLineCount,
      sourceMeta.sourcePath,
      sourceMeta.sourceContent
    );
    if (!map) continue;

    sections.push({
      offset: { line: startLine, column: 0 },
      map,
    });
  }

  if (sections.length === 0) return null;
  return { version: 3, file: outputFileName, sections };
}

/**
 * Build the extension by concatenating, cleaning, minifying, and maximizing JS files
 */
async function buildExtension() {
  try {
    const manifest = getManifest();
    const header = generateHeader(manifest);
    const sourceFiles = getSourceFiles();
    const dependencies = getModuleDependencies(sourceFiles);
    const buildInputs = getBuildInputs(sourceFiles);
    const useCache = !noCacheMode;
    const previousCache = useCache ? loadBuildCache() : null;
    const cacheCompatible =
      !!previousCache &&
      previousCache.version === 1 &&
      previousCache.buildScriptHash === buildInputs.buildScriptHash;
    const previousSourceHashes = cacheCompatible ? previousCache.sourceHashes || {} : {};
    const previousModuleCache = cacheCompatible ? previousCache.modules || {} : {};
    const sourceSetChanged =
      Object.keys(previousSourceHashes).length !== sourceFiles.length ||
      Object.keys(previousSourceHashes).some(file => !sourceFiles.includes(file));

    const changedModules = new Set(
      sourceFiles.filter(file => previousSourceHashes[file] !== buildInputs.sourceHashes[file])
    );
    if (sourceSetChanged) {
      for (const file of sourceFiles) {
        changedModules.add(file);
      }
    }
    const affectedModules =
      !useCache || !cacheCompatible
        ? new Set(sourceFiles)
        : expandChangedWithDependents(dependencies, changedModules);

    let cacheHits = 0;
    let cacheMisses = 0;
    let rebuiltModules = 0;

    const opcodeValidationKey = hashString(
      JSON.stringify({
        sourceHashes: buildInputs.sourceHashes,
        validatorHash: buildInputs.validatorHash,
      })
    );
    const assetValidationKey = hashString(
      JSON.stringify({
        sourceHashes: buildInputs.sourceHashes,
        assetHashes: buildInputs.assetHashes,
        assetValidatorHash: buildInputs.assetValidatorHash,
      })
    );
    const cachedOpcodeValidation = cacheCompatible ? previousCache.validation?.opcode : null;
    const cachedAssetValidation = cacheCompatible ? previousCache.validation?.assets : null;
    let validationErrors = [];
    let assetValidation;

    // Validate opcode-to-method signatures before emitting any artifacts
    if (useCache && cachedOpcodeValidation && cachedOpcodeValidation.key === opcodeValidationKey) {
      cacheHits += 1;
      validationErrors = cachedOpcodeValidation.errors || [];
    } else {
      cacheMisses += 1;
      validationErrors = validateOpcodeSignatures();
    }
    if (validationErrors.length > 0) {
      console.error('✗ Opcode validation failed:');
      for (const err of validationErrors) {
        console.error(err);
      }
      if (useCache) {
        saveBuildCache({
          version: 1,
          buildScriptHash: buildInputs.buildScriptHash,
          sourceHashes: buildInputs.sourceHashes,
          assetHashes: buildInputs.assetHashes,
          manifestHash: buildInputs.manifestHash,
          validatorHash: buildInputs.validatorHash,
          assetValidatorHash: buildInputs.assetValidatorHash,
          modules: previousModuleCache,
          validation: {
            opcode: { key: opcodeValidationKey, errors: validationErrors },
            assets:
              cachedAssetValidation && cachedAssetValidation.key === assetValidationKey
                ? cachedAssetValidation
                : { key: assetValidationKey, errors: [], warnings: [] },
          },
        });
      }
      return false;
    }
    console.log('✓ Opcode signatures valid');

    // Validate asset references before bundling
    if (useCache && cachedAssetValidation && cachedAssetValidation.key === assetValidationKey) {
      cacheHits += 1;
      assetValidation = {
        errors: cachedAssetValidation.errors || [],
        warnings: cachedAssetValidation.warnings || [],
      };
    } else {
      cacheMisses += 1;
      assetValidation = validateAssetReferences(SRC_DIR);
    }
    const { errors: assetErrors, warnings: assetWarnings } = assetValidation;
    for (const w of assetWarnings) {
      console.warn(w);
    }
    if (assetErrors.length > 0) {
      console.error('✗ Asset reference validation failed:');
      for (const err of assetErrors) {
        console.error(err);
      }
      if (useCache) {
        saveBuildCache({
          version: 1,
          buildScriptHash: buildInputs.buildScriptHash,
          sourceHashes: buildInputs.sourceHashes,
          assetHashes: buildInputs.assetHashes,
          manifestHash: buildInputs.manifestHash,
          validatorHash: buildInputs.validatorHash,
          assetValidatorHash: buildInputs.assetValidatorHash,
          modules: previousModuleCache,
          validation: {
            opcode: { key: opcodeValidationKey, errors: validationErrors },
            assets: { key: assetValidationKey, errors: assetErrors, warnings: assetWarnings },
          },
        });
      }
      return false;
    }
    console.log('✓ Asset references valid');

    // --- Bundle assets from src/assets as base64 data URIs ---
    // mint.assets is always injected so it is safe to call regardless of whether
    // any assets exist; when the src/assets directory is absent or empty, both
    // methods return undefined / false gracefully.
    const MINT_STUB =
      '  const mint = { assets: { get() { return undefined; }, exists() { return false; } } };\n\n';
    let assetsCode = MINT_STUB;
    try {
      const assetsDir = path.join(SRC_DIR, 'assets');
      if (fs.existsSync(assetsDir)) {
        const walk = dir =>
          fs
            .readdirSync(dir, { withFileTypes: true })
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
            .flatMap(d => {
              const res = path.join(dir, d.name);
              return d.isDirectory() ? walk(res) : [res];
            });
        const assetFiles = walk(assetsDir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        if (assetFiles.length) {
          const assets = {};
          assetFiles.forEach(f => {
            const rel = path.relative(assetsDir, f).replace(/\\/g, '/');
            const ext = path.extname(f).toLowerCase();
            const mime = MIME_MAP[ext] || 'application/octet-stream';
            const data = fs.readFileSync(f);
            const b64 = data.toString('base64');
            assets[rel] = `data:${mime};base64,${b64}`;
          });

          // Generate JS code that defines functions for each asset and the mint API
          const makeSafe = name =>
            name.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^[0-9]/, m => '_' + m);
          let gen = '  // --- Embedded assets ---\n';
          Object.keys(assets)
            .sort()
            .forEach((key, idx, _arr) => {
              const fn = '__mint_asset_' + makeSafe(key) + '_' + idx;
              gen += `  function ${fn}() { return ${JSON.stringify(assets[key])}; }\n`;
            });
          gen += '\n  const __mint_assets = {\n';
          Object.keys(assets)
            .sort()
            .forEach((key, idx, arr) => {
              const fn = '__mint_asset_' + makeSafe(key) + '_' + idx;
              gen += `    ${JSON.stringify(key)}: ${fn}${idx < arr.length - 1 ? ',' : ''}\n`;
            });
          gen += '  };\n\n';
          gen +=
            '  const mint = {\n' +
            '    assets: {\n' +
            '      get(name) { return __mint_assets[name] ? __mint_assets[name]() : undefined; },\n' +
            '      exists(name) { return Object.prototype.hasOwnProperty.call(__mint_assets, name); }\n' +
            '    }\n' +
            '  };\n\n';
          assetsCode = gen;
        }
      }
    } catch (err) {
      console.warn('Asset bundling failed:', err && err.message ? err.message : err);
      assetsCode = MINT_STUB;
    }

    let output = header;

    // Add IIFE wrapper that takes Scratch as parameter
    output += '(function (Scratch) {\n';
    output += '  "use strict";\n\n';
    output += assetsCode;
    const sourceMetaByFilename = new Map();

    const nextModuleCache = {};

    // Concatenate all source files
    for (const file of sourceFiles) {
      const filename = path.basename(file);
      const sourceContent = fs.readFileSync(file, 'utf8');
      sourceMetaByFilename.set(filename, {
        sourcePath: `src/${filename}`.replace(/\\/g, '/'),
        sourceContent,
        sourceLineCount: sourceContent.split('\n').length,
      });

      const cachedModule = previousModuleCache[file];
      const canUseCachedModule =
        useCache &&
        cacheCompatible &&
        !affectedModules.has(file) &&
        cachedModule &&
        cachedModule.contentHash === buildInputs.sourceHashes[file];

      if (canUseCachedModule) {
        cacheHits += 1;
        output += cachedModule.transformed;
        nextModuleCache[file] = cachedModule;
        continue;
      }

      cacheMisses += 1;
      rebuiltModules += 1;
      let moduleOutput = `  // ===== ${filename} =====\n`;
      let content = sourceContent;

      // Transpile TypeScript files to JavaScript before further processing.
      // The `export` keyword (e.g. `export function foo`) is handled below by
      // the same regex strip used for .js modules, so no special treatment is
      // needed — esbuild emits standard ES2017 and the IIFE wrapper receives
      // plain functions/classes.
      if (file.endsWith('.ts')) {
        content = await transpileTypeScript(content, file);
      }

      /**
       * TRANSFORM MODULES TO PLAIN JS
       */
      // 1. Remove import lines while preserving line count for sourcemap stability
      content = content.replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?/gm, match => {
        const importLineCount = match.split(/\r?\n/).length;
        return '\n'.repeat(Math.max(0, importLineCount - 1));
      });

      // 2. Remove 'export ' prefix
      content = content.replace(/^export\s+/gm, '');

      // Indent the content for the IIFE
      const indentedContent = content
        .split('\n')
        .map(line => {
          return line.length === 0 ? '' : '  ' + line;
        })
        .join('\n');

      moduleOutput += indentedContent;
      moduleOutput += '\n\n';
      output += moduleOutput;
      nextModuleCache[file] = {
        contentHash: buildInputs.sourceHashes[file],
        transformed: moduleOutput,
      };
    }

    // Close IIFE
    output += '})(Scratch);\n';

    // Optionally strip comments in production mode (preserve the header)
    let finalOutput = output;
    if (productionMode) {
      try {
        const { minify } = await import('terser');
        // Use terser to remove comments while keeping header metadata comments
        const cleaned = await minify(output, {
          compress: false,
          mangle: false,
          format: {
            comments: (_node, comment) =>
              COMMENTS_REGEX.test(comment.value) ||
              (sourcemapMode && SECTION_MARKER_COMMENT_REGEX.test(comment.value)),
            beautify: true,
          },
        });
        if (cleaned && typeof cleaned.code === 'string') {
          finalOutput = cleaned.code;
        }
      } catch (err) {
        if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
          console.warn('        (Skipping comment stripping: "terser" not found)');
        } else {
          console.warn('[PROD] Comment stripping failed:', err);
        }
      }
    }

    const info = [];
    // Track artifact sizes for the build report (null = artifact was not generated)
    const artifactSizes = { standard: null, min: null, pretty: null };
    const sourcemapStates = {
      enabled: sourcemapMode,
      inline: inlineSourcemapMode,
      standard: false,
      min: false,
      pretty: false,
    };

    let standardOutput = finalOutput;
    const standardMapObject = sourcemapMode
      ? buildIndexedSourceMap(output, sourceMetaByFilename, 'extension.js')
      : null;
    const standardMap = standardMapObject ? JSON.stringify(standardMapObject) : null;

    if (sourcemapMode && standardMap) {
      if (inlineSourcemapMode) {
        const encoded = Buffer.from(standardMap, 'utf8').toString('base64');
        standardOutput += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${encoded}\n`;
      } else {
        standardOutput += '\n//# sourceMappingURL=extension.js.map\n';
      }
    }

    fs.writeFileSync(OUTPUT_FILE, standardOutput, 'utf8');
    artifactSizes.standard = standardOutput.length;
    const wroteStandardExternalMap = Boolean(sourcemapMode && !inlineSourcemapMode && standardMap);

    if (wroteStandardExternalMap) {
      fs.writeFileSync(OUTPUT_FILE_MAP, standardMap, 'utf8');
      info.push(`Sourcemap created: ${OUTPUT_FILE_MAP}`);
    } else {
      removeFileIfExists(OUTPUT_FILE_MAP);
    }
    sourcemapStates.standard = inlineSourcemapMode
      ? hasInlineSourceMapComment(standardOutput)
      : wroteStandardExternalMap;

    const size = (standardOutput.length / 1024).toFixed(2);
    info.push(`[NORMAL] Standard build successful: ${OUTPUT_FILE} (${size} KB)`);

    // --- Maximization Step (Prettier) ---
    try {
      const { format, resolveConfig } = await import('prettier');
      const prettierConfig = (await resolveConfig(OUTPUT_MAX_FILE)) || {};
      const formatted = await format(finalOutput, {
        ...prettierConfig,
        parser: 'babel',
      });

      let prettyOutput = formatted;
      const prettyMapObject = sourcemapMode
        ? buildIndexedSourceMap(prettyOutput, sourceMetaByFilename, 'pretty.extension.js')
        : null;
      const prettyMap = prettyMapObject ? JSON.stringify(prettyMapObject) : null;
      if (sourcemapMode && prettyMap) {
        if (inlineSourcemapMode) {
          const encoded = Buffer.from(prettyMap, 'utf8').toString('base64');
          prettyOutput += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${encoded}\n`;
        } else {
          prettyOutput += '\n//# sourceMappingURL=pretty.extension.js.map\n';
        }
      }

      fs.writeFileSync(OUTPUT_MAX_FILE, prettyOutput, 'utf8');
      const wrotePrettyExternalMap = Boolean(sourcemapMode && !inlineSourcemapMode && prettyMap);
      if (wrotePrettyExternalMap) {
        fs.writeFileSync(OUTPUT_MAX_FILE_MAP, prettyMap, 'utf8');
        info.push(`Sourcemap created: ${OUTPUT_MAX_FILE_MAP}`);
      } else {
        removeFileIfExists(OUTPUT_MAX_FILE_MAP);
      }
      sourcemapStates.pretty = inlineSourcemapMode
        ? hasInlineSourceMapComment(prettyOutput)
        : wrotePrettyExternalMap;
      const maxSize = (prettyOutput.length / 1024).toFixed(2);
      info.push(`Maximized output created: ${OUTPUT_MAX_FILE} (${maxSize} KB)`);
      artifactSizes.pretty = prettyOutput.length;
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND') {
        console.warn('        (Skipping maximization: "prettier" not found)');
      } else {
        console.warn('✗ Maximization failed:', err);
      }
    }

    // --- Minification Step (Terser) ---
    try {
      const { minify } = await import('terser');
      const minifySourceMap =
        sourcemapMode && inlineSourcemapMode
          ? // `content` passes the standard indexed source map object so terser can
            // chain minified mappings back to original `src/*` modules.
            { url: 'inline', content: standardMapObject }
          : sourcemapMode
            ? {
                filename: 'min.extension.js',
                url: 'min.extension.js.map',
                content: standardMapObject,
              }
            : false;
      const minified = await minify(finalOutput, {
        compress: true,
        mangle: true,
        format: {
          comments: COMMENTS_REGEX,
        },
        sourceMap: minifySourceMap,
      });

      if (minified && minified.code) {
        const minOutput = minified.code;
        fs.writeFileSync(OUTPUT_MIN_FILE, minOutput, 'utf8');
        if (sourcemapMode && !inlineSourcemapMode && minified.map) {
          fs.writeFileSync(
            OUTPUT_MIN_FILE_MAP,
            typeof minified.map === 'string' ? minified.map : JSON.stringify(minified.map),
            'utf8'
          );
          info.push(`Sourcemap created: ${OUTPUT_MIN_FILE_MAP}`);
          sourcemapStates.min = true;
        } else {
          removeFileIfExists(OUTPUT_MIN_FILE_MAP);
        }
        if (inlineSourcemapMode) {
          sourcemapStates.min = hasInlineSourceMapComment(minOutput);
        }
        const minSize = (minOutput.length / 1024).toFixed(2);
        info.push(`Minified output created: ${OUTPUT_MIN_FILE} (${minSize} KB)`);
        artifactSizes.min = minOutput.length;
      } else {
        console.warn('✗ Minification produced no code');
      }
    } catch (err) {
      if (err && err.code === 'ERR_MODULE_NOT_FOUND') {
        console.warn('        (Skipping minification: "terser" not found)');
      } else {
        console.warn('✗ Minification failed:', err);
      }
    }

    // --- Build Report ---
    generateBuildReport(artifactSizes, sourcemapStates);

    if (useCache) {
      const total = cacheHits + cacheMisses;
      const rate = total > 0 ? Math.round((cacheHits / total) * 100) : 0;
      console.log(`Cache: ${cacheHits} hits, ${cacheMisses} misses (${rate}% hit rate)`);
      console.log(`Rebuilt ${rebuiltModules} module${rebuiltModules === 1 ? '' : 's'}`);
      saveBuildCache({
        version: 1,
        buildScriptHash: buildInputs.buildScriptHash,
        sourceHashes: buildInputs.sourceHashes,
        assetHashes: buildInputs.assetHashes,
        manifestHash: buildInputs.manifestHash,
        validatorHash: buildInputs.validatorHash,
        assetValidatorHash: buildInputs.assetValidatorHash,
        modules: nextModuleCache,
        validation: {
          opcode: { key: opcodeValidationKey, errors: validationErrors },
          assets: { key: assetValidationKey, errors: assetErrors, warnings: assetWarnings },
        },
      });
    } else {
      console.log('Cache: disabled (--no-cache)');
    }

    console.log('✓ Build successful');
    if (lastBuildFailed) {
      printRecoveryBanner();
      sendNotification('Mint Build', 'Build recovered — errors resolved.');
    }
    lastBuildFailed = false;
    return true;
  } catch (err) {
    printFailureBanner(err.message);
    sendNotification('Mint Build Failed', err.message);
    lastBuildFailed = true;
    return false;
  }
}

/**
 * Coalescing guard to prevent concurrent build runs
 */
async function guardedBuild() {
  if (isBuilding) {
    pendingBuild = true;
    return;
  }

  isBuilding = true;
  await buildExtension();
  isBuilding = false;

  if (pendingBuild) {
    pendingBuild = false;
    // Trigger the next build in the next tick
    setImmediate(guardedBuild);
  }
}

/**
 * Watch for file changes
 */
async function watchFiles() {
  let chokidar;
  try {
    chokidar = (await import('chokidar')).default;
  } catch (_err) {
    console.error('Watch mode requires chokidar. Install it with: npm install --save-dev chokidar');
    process.exit(1);
  }

  console.log('Watching for changes in', SRC_DIR);

  const watcher = chokidar.watch(SRC_DIR, {
    // eslint-disable-next-line no-useless-escape
    ignored: /(^|[\/\\])\./,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 100,
    },
  });

  watcher.on('all', (event, file) => {
    console.log(`[WATCH] ${event}: ${path.basename(file)}`);
    guardedBuild();
  });
}

// Execute
(async () => {
  if (cleanCacheMode) {
    clearBuildCache();
    console.log('Cache cleared: .mint-cache/');
  }

  // Always run the initial build
  const success = await buildExtension();

  if (!success && !watchMode) {
    process.exit(1);
  }

  if (watchMode) {
    watchFiles();
  }
})();
