/**
 * PrismFS OPFS backend
 *
 * Wraps the Origin Private File System API to provide persistent storage for
 * prisms whose type is "prism" (not temporary or immutable).
 *
 * When OPFS is not available (e.g., in Node.js unit-test environments or older
 * browsers), `isAvailable()` returns `false` and every operation is a no-op.
 * The in-memory registry acts as the sole storage in that case.
 *
 * Storage layout inside OPFS:
 *   <prismfs-root>/
 *     <prism-name>/
 *       <url-encoded-file-path>   (each file stored as a single OPFS file)
 */

export class OpfsBackend {
  constructor() {
    /** @type {FileSystemDirectoryHandle | null} */
    this._root = null;
    /** @type {boolean | null} null = not yet checked */
    this._available = null;
  }

  // ─── Initialisation ─────────────────────────────────────────────────────────

  /**
   * Attempt to acquire the OPFS root directory.
   * Safe to call multiple times; only acts on the first call.
   *
   * @returns {Promise<boolean>} Whether OPFS is available.
   */
  async init() {
    if (this._available !== null) return this._available;
    try {
      const storage = await navigator.storage.getDirectory();
      this._root = await storage.getDirectoryHandle('prismfs-data', { create: true });
      this._available = true;
    } catch {
      this._available = false;
    }
    return this._available;
  }

  /** @returns {boolean} */
  isAvailable() {
    return this._available === true;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Get (or create) the OPFS directory for a prism.
   *
   * @param {string} prism
   * @param {{ create?: boolean }} [opts]
   * @returns {Promise<FileSystemDirectoryHandle | null>}
   */
  async _prismDir(prism, { create = false } = {}) {
    if (!this._available) return null;
    try {
      return await this._root.getDirectoryHandle(prism, { create });
    } catch {
      return null;
    }
  }

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * Load all files for a prism from OPFS.
   * Returns a Map of filePath → content strings, or null if OPFS unavailable.
   *
   * @param {string} prism
   * @returns {Promise<Map<string, string> | null>}
   */
  async loadPrism(prism) {
    const dir = await this._prismDir(prism);
    if (!dir) return null;

    const files = new Map();
    try {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind !== 'file') continue;
        const file = await handle.getFile();
        const content = await file.text();
        files.set(decodeURIComponent(name), content);
      }
    } catch {
      return null;
    }
    return files;
  }

  /**
   * Persist a file to OPFS.
   *
   * @param {string} prism
   * @param {string} filePath
   * @param {string} content
   * @returns {Promise<void>}
   */
  async writeFile(prism, filePath, content) {
    const dir = await this._prismDir(prism, { create: true });
    if (!dir) return;
    let writable;
    try {
      const handle = await dir.getFileHandle(encodeURIComponent(filePath), { create: true });
      writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
    } catch {
      if (writable) {
        try {
          await writable.abort();
        } catch {
          // Silently fail if abort also fails
        }
      }
      // Silently fail — in-memory registry is the fallback
    }
  }

  /**
   * Delete a file from OPFS.
   *
   * @param {string} prism
   * @param {string} filePath
   * @returns {Promise<void>}
   */
  async deleteFile(prism, filePath) {
    const dir = await this._prismDir(prism);
    if (!dir) return;
    try {
      await dir.removeEntry(encodeURIComponent(filePath));
    } catch {
      // Silently fail
    }
  }

  /**
   * Remove all OPFS data for a prism (called on unmount of persistent prisms).
   *
   * @param {string} prism
   * @returns {Promise<void>}
   */
  async deletePrism(prism) {
    if (!this._available) return;
    try {
      await this._root.removeEntry(prism, { recursive: true });
    } catch {
      // Silently fail
    }
  }
}