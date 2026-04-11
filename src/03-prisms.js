/**
 * PrismFS prism registry.
 *
 * A "prism" is a named volume in PrismFS.  This module manages which prisms
 * are currently mounted and maintains a simple in-memory file system for each
 * prism.  Persistent prisms backed by OPFS are handled by the browser runtime;
 * the same in-memory API is used for temporary/immutable prisms and for the
 * Node.js test environment.
 */

import {
  PRISM_TYPE,
  RESERVED_PRISMS,
  MAX_PRISMS,
  MAX_FILES_PER_PRISM,
  MAX_FILE_SIZE_BYTES,
  Errors,
} from './02-fs-utils.js';

/**
 * @typedef {{ content: string, createdAt: number, modifiedAt: number }} FileEntry
 * @typedef {{ type: string, files: Map<string, FileEntry> }} PrismEntry
 */

export class PrismRegistry {
  constructor() {
    /** @type {Map<string, PrismEntry>} prism name → entry */
    this._prisms = new Map();

    // Mount the two default prisms that PrismFS always starts with.
    this._createEntry('fs', PRISM_TYPE.PRISM);
    this._createEntry('tmp', PRISM_TYPE.TEMPORARY);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  /**
   * @param {string} name
   * @param {string} type
   * @returns {PrismEntry}
   */
  _createEntry(name, type) {
    const entry = { type, files: new Map() };
    this._prisms.set(name, entry);
    return entry;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Mount a new prism.
   *
   * @param {string} name  Prism name.  Will be lower-cased.
   * @param {string} type  One of `PRISM_TYPE` values.
   * @returns {string}     Empty string on success; error string on failure.
   */
  mount(name, type) {
    const n = name.toLowerCase();

    if (RESERVED_PRISMS.has(n)) {
      return Errors.reserved(`"${name}" is a reserved prism name.`);
    }
    if (!Object.values(PRISM_TYPE).includes(type)) {
      return Errors.invalid(`Unknown prism type: "${type}".`);
    }
    if (this._prisms.has(n)) {
      return Errors.exists(`Prism "${name}" is already mounted.`);
    }
    if (this._prisms.size >= MAX_PRISMS) {
      return Errors.limit(`Maximum prism count (${MAX_PRISMS}) reached.`);
    }

    this._createEntry(n, type);
    return '';
  }

  /**
   * Unmount a prism.
   *
   * @param {string} name
   * @returns {string} Empty string on success; error string on failure.
   */
  unmount(name) {
    const n = name.toLowerCase();

    if (RESERVED_PRISMS.has(n)) {
      return Errors.reserved(`"${name}" is a reserved prism name.`);
    }
    if (!this._prisms.has(n)) {
      return Errors.notFound(`Prism "${name}" is not mounted.`);
    }

    this._prisms.delete(n);
    return '';
  }

  /**
   * Check whether a prism is currently mounted.
   *
   * @param {string} name
   * @returns {boolean}
   */
  isMounted(name) {
    return this._prisms.has(name.toLowerCase());
  }

  /**
   * Return the type of a mounted prism.
   *
   * @param {string} name
   * @returns {string} Prism type or error string.
   */
  typeOf(name) {
    const entry = this._prisms.get(name.toLowerCase());
    if (!entry) return Errors.notFound(`Prism "${name}" is not mounted.`);
    return entry.type;
  }

  /**
   * Return the names of all currently mounted prisms.
   *
   * @returns {string[]}
   */
  list() {
    return Array.from(this._prisms.keys());
  }

  /**
   * Retrieve the internal entry for a prism (for file operations).
   *
   * @param {string} name
   * @returns {PrismEntry | null}
   */
  get(name) {
    return this._prisms.get(name.toLowerCase()) ?? null;
  }

  /**
   * Unmount and discard all non-persistent prisms (temporary and immutable).
   * Called when the green flag is clicked or the project is stopped.
   * Persistent `prism`-type prisms are preserved so their OPFS-backed data
   * survives the reset.
   */
  cleanupTemporary() {
    for (const [name, entry] of this._prisms.entries()) {
      if (entry.type === PRISM_TYPE.TEMPORARY || entry.type === PRISM_TYPE.IMMUTABLE) {
        this._prisms.delete(name);
      }
    }
  }

  // ─── In-memory file operations ─────────────────────────────────────────────

  /**
   * Write a file into the prism's in-memory store.
   *
   * @param {string} prismName
   * @param {string} filePath
   * @param {string} content
   * @returns {string} Empty string on success; error string on failure.
   */
  writeFile(prismName, filePath, content) {
    const entry = this._prisms.get(prismName.toLowerCase());
    if (!entry) return Errors.notFound(`Prism "${prismName}" is not mounted.`);
    if (entry.type === PRISM_TYPE.IMMUTABLE) {
      return Errors.readOnly(`Prism "${prismName}" is immutable.`);
    }

    // Enforce per-prism file count limit (new files only).
    const isNew = !entry.files.has(filePath);
    if (isNew && entry.files.size >= MAX_FILES_PER_PRISM) {
      return Errors.limit(
        `Prism "${prismName}" has reached the maximum file count (${MAX_FILES_PER_PRISM}).`
      );
    }

    // Enforce maximum file size.
    // TextEncoder.encode gives the UTF-8 byte length, but avoid allocating the
    // full buffer for large strings by using a rough byte-length estimate first.
    const roughBytes = content.length * 3; // worst case: 3 bytes per UTF-16 code unit
    if (roughBytes > MAX_FILE_SIZE_BYTES) {
      // Only do the precise (slower) check if the rough estimate exceeds the limit.
      const exactBytes = new TextEncoder().encode(content).byteLength;
      if (exactBytes > MAX_FILE_SIZE_BYTES) {
        return Errors.limit(
          `File exceeds the maximum allowed size (${MAX_FILE_SIZE_BYTES} bytes).`
        );
      }
    }

    const now = Date.now();
    const existing = entry.files.get(filePath);
    entry.files.set(filePath, {
      content,
      createdAt: existing ? existing.createdAt : now,
      modifiedAt: now,
    });
    return '';
  }

  /**
   * Read a file from the prism's in-memory store.
   *
   * @param {string} prismName
   * @param {string} filePath
   * @returns {string} File content or error string.
   */
  readFile(prismName, filePath) {
    const entry = this._prisms.get(prismName.toLowerCase());
    if (!entry) return Errors.notFound(`Prism "${prismName}" is not mounted.`);

    const file = entry.files.get(filePath);
    if (!file) return Errors.notFound(`File "${filePath}" not found in prism "${prismName}".`);
    return file.content;
  }

  /**
   * Delete a file from the prism's in-memory store.
   *
   * @param {string} prismName
   * @param {string} filePath
   * @returns {string} Empty string on success; error string on failure.
   */
  deleteFile(prismName, filePath) {
    const entry = this._prisms.get(prismName.toLowerCase());
    if (!entry) return Errors.notFound(`Prism "${prismName}" is not mounted.`);
    if (entry.type === PRISM_TYPE.IMMUTABLE) {
      return Errors.readOnly(`Prism "${prismName}" is immutable.`);
    }
    if (!entry.files.has(filePath)) {
      return Errors.notFound(`File "${filePath}" not found in prism "${prismName}".`);
    }

    entry.files.delete(filePath);
    return '';
  }

  /**
   * Check whether a file exists in the prism's in-memory store.
   *
   * @param {string} prismName
   * @param {string} filePath
   * @returns {boolean}
   */
  fileExists(prismName, filePath) {
    const entry = this._prisms.get(prismName.toLowerCase());
    if (!entry) return false;
    return entry.files.has(filePath);
  }

  /**
   * List all file paths inside the prism (optionally filtered by directory prefix).
   *
   * @param {string} prismName
   * @param {string} [dirPath]  If provided, only files under this directory are returned.
   * @returns {string[] | string} File path list or error string.
   */
  listFiles(prismName, dirPath) {
    const entry = this._prisms.get(prismName.toLowerCase());
    if (!entry) return Errors.notFound(`Prism "${prismName}" is not mounted.`);

    let paths = Array.from(entry.files.keys());
    if (dirPath) {
      const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
      paths = paths.filter(p => p.startsWith(prefix));
    }
    return paths;
  }

  /**
   * Return a snapshot copy of a prism's files (used when creating snapshots).
   *
   * @param {string} prismName
   * @returns {Map<string, FileEntry> | string}
   */
  snapshotFiles(prismName) {
    const entry = this._prisms.get(prismName.toLowerCase());
    if (!entry) return Errors.notFound(`Prism "${prismName}" is not mounted.`);
    return new Map(entry.files);
  }
}
