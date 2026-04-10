/**
 * PrismFS metadata manager.
 *
 * Every file, directory, or prism automatically receives three built-in
 * metadata tags:
 *   - `createdAt`   ISO 8601 creation timestamp
 *   - `modifiedAt`  ISO 8601 last-modification timestamp
 *   - `callerSprite` name of the sprite that last touched the entry
 *
 * Developers can add up to 50 custom tags per entry.  Each tag value is
 * limited to 32 KB (UTF-16 code units).
 */

import { MAX_METADATA_TAGS, MAX_METADATA_TAG_BYTES, Errors } from './02-fs-utils.js';

export const BUILTIN_TAGS = Object.freeze(['createdAt', 'modifiedAt', 'callerSprite']);

export class MetadataStore {
  constructor() {
    /** @type {Map<string, Map<string, string>>} path → (tag → value) */
    this._store = new Map();
  }

  // ─── Internal helpers ───────────────────────────────────────────────────────

  /** @param {string} path */
  _bucket(path) {
    if (!this._store.has(path)) this._store.set(path, new Map());
    return this._store.get(path);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initialise the built-in tags for a newly created entry.
   *
   * @param {string} path
   * @param {string} sprite  Calling sprite name.
   */
  initBuiltin(path, sprite) {
    const now = new Date().toISOString();
    const bucket = this._bucket(path);
    if (!bucket.has('createdAt')) bucket.set('createdAt', now);
    bucket.set('modifiedAt', now);
    bucket.set('callerSprite', sprite);
  }

  /**
   * Update the `modifiedAt` and `callerSprite` built-in tags on write.
   *
   * @param {string} path
   * @param {string} sprite
   */
  touch(path, sprite) {
    const bucket = this._bucket(path);
    bucket.set('modifiedAt', new Date().toISOString());
    bucket.set('callerSprite', sprite);
  }

  /**
   * Set a custom metadata tag.
   *
   * @param {string} path
   * @param {string} tag
   * @param {string} value
   * @returns {string} Empty string on success; error string on failure.
   */
  set(path, tag, value) {
    if (BUILTIN_TAGS.includes(tag)) {
      return Errors.invalid(`"${tag}" is a built-in metadata tag and cannot be set manually.`);
    }
    if (value.length > MAX_METADATA_TAG_BYTES / 2) {
      // string.length counts UTF-16 code units (each code unit is 2 bytes).
      // Characters outside the BMP are represented as surrogate pairs (two code units = 4 bytes),
      // so using value.length with MAX_METADATA_TAG_BYTES/2 is correct.
      return Errors.limit(`Metadata tag "${tag}" value exceeds the 32 KB size limit.`);
    }

    const bucket = this._bucket(path);
    const customTags = Array.from(bucket.keys()).filter(k => !BUILTIN_TAGS.includes(k));

    if (!bucket.has(tag) && customTags.length >= MAX_METADATA_TAGS) {
      return Errors.limit(
        `Maximum metadata tag count (${MAX_METADATA_TAGS}) reached for "${path}".`
      );
    }

    bucket.set(tag, value);
    return '';
  }

  /**
   * Retrieve a single metadata tag value.
   *
   * @param {string} path
   * @param {string} tag
   * @returns {string} Tag value, empty string if the tag does not exist.
   */
  get(path, tag) {
    return this._store.get(path)?.get(tag) ?? '';
  }

  /**
   * Retrieve all metadata tags for a path as a plain object.
   *
   * @param {string} path
   * @returns {Record<string, string>}
   */
  getAll(path) {
    const bucket = this._store.get(path);
    if (!bucket) return {};
    return Object.fromEntries(bucket.entries());
  }

  /**
   * Remove all metadata entries whose key begins with a given prism URI prefix.
   * Called when a prism is unmounted or cleaned up.
   *
   * @param {string} prismName  Lower-cased prism name.
   */
  clearPrism(prismName) {
    const prefix = `${prismName}://`;
    for (const key of this._store.keys()) {
      if (key === prismName || key.startsWith(prefix)) {
        this._store.delete(key);
      }
    }
  }
}
