/**
 * PrismFS utilities: URI parsing, error formatting, constants, and wildcard matching.
 *
 * All functions here are pure (no side-effects) so they can be tested in Node.js
 * without any Scratch or browser globals.
 */

// ─── Limits ──────────────────────────────────────────────────────────────────

export const MAX_FILES_PER_PRISM = 10_000;
export const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB
export const MAX_PRISMS = 50;
export const MAX_WATCHERS = 150;
export const MAX_METADATA_TAGS = 50;
export const MAX_METADATA_TAG_BYTES = 32 * 1024; // 32 KB
export const MAX_SNAPSHOTS_PER_PRISM = 20;

// ─── Prism types ─────────────────────────────────────────────────────────────

export const PRISM_TYPE = Object.freeze({
  PRISM: 'prism',
  TEMPORARY: 'temporary',
  IMMUTABLE: 'immutable',
});

// ─── Permissions ─────────────────────────────────────────────────────────────

export const PERMISSION = Object.freeze({
  SEE: 'see',
  READ: 'read',
  WRITE: 'write',
  MANAGE: 'manage',
});

export const ALL_PERMISSIONS = Object.freeze(Object.values(PERMISSION));

// ─── Reserved prism names ────────────────────────────────────────────────────

export const RESERVED_PRISMS = Object.freeze(new Set(['prismsnap', 'prismfs']));

// ─── Error helpers ───────────────────────────────────────────────────────────

/**
 * Format a PrismFS error string.
 *
 * @param {string} type    Error type identifier, e.g. "NOTFOUND".
 * @param {string} message Human-readable description of the error.
 * @returns {string}       Formatted error string `ERR<type>: <message>`.
 */
export function formatError(type, message) {
  return `ERR${type}: ${message}`;
}

/**
 * Return whether a string is a PrismFS error value.
 * Reporters return the error string instead of throwing so callers can
 * detect failure without a try/catch.
 *
 * Uses a tight prefix check (`ERR` followed by at least one uppercase letter)
 * to avoid false positives where file content coincidentally starts with "ERR".
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isError(value) {
  return typeof value === 'string' && /^ERR[A-Z]/.test(value);
}

export const Errors = Object.freeze({
  notFound: msg => formatError('NOTFOUND', msg),
  permission: msg => formatError('PERMISSION', msg),
  invalidUri: msg => formatError('INVALIDURI', msg),
  reserved: msg => formatError('RESERVED', msg),
  limit: msg => formatError('LIMIT', msg),
  invalid: msg => formatError('INVALID', msg),
  readOnly: msg => formatError('READONLY', msg),
  exists: msg => formatError('EXISTS', msg),
});

// ─── URI parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a PrismFS URI into its prism name and file path.
 *
 * Valid format: `prism-name://path/to/file.ext`
 * Prism names are lowercased on return.
 *
 * @param {string} uri
 * @returns {{ prism: string, filePath: string } | null}
 *   `null` when the URI does not match the expected format.
 */
export function parseUri(uri) {
  if (typeof uri !== 'string') return null;
  const match = uri.match(/^([A-Za-z][A-Za-z0-9_-]*):\/{2}(.*)/s);
  if (!match) return null;
  return { prism: match[1].toLowerCase(), filePath: match[2] };
}

/**
 * Normalise a file path: collapse repeated slashes, strip trailing slash.
 *
 * @param {string} filePath
 * @returns {string}
 */
export function normalisePath(filePath) {
  return filePath
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

// ─── Wildcard matching ───────────────────────────────────────────────────────

/**
 * Test whether a path matches a wildcard glob pattern.
 * Only `*` is supported as a wildcard (matches any sequence of non-`/`
 * characters).  `**` matches any sequence including `/`.
 *
 * @param {string} pattern  Glob pattern, e.g. `"documents://*.txt"` or `"tmp://**"`.
 * @param {string} path     The full URI string to test against the pattern.
 * @returns {boolean}
 */
export function matchesPattern(pattern, path) {
  // Escape all regex special chars except `*`, then expand wildcards.
  // Process `**` before `*` to avoid double-expansion.
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<GLOBSTAR>')
    .replace(/\*/g, '[^/]*')
    .replace(/<GLOBSTAR>/g, '.*');
  return new RegExp(`^${regexStr}$`).test(path);
}
