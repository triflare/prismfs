/**
 * PrismFS file watcher manager.
 *
 * Watchers observe a URI pattern and are identified by a UUID.  When a
 * watched path is written to, all matching watcher UUIDs are returned so the
 * extension can fire the corresponding hat blocks.
 *
 * Rules:
 *  - A watcher will not fire if the write originated from a script that is
 *    already running in response to that same watcher.
 *  - When multiple watchers fire, they run in sprite alphabetical order.
 *  - If the global watcher quota (150) is reached, `register()` returns an
 *    error string and logs a debug message.
 */

import { MAX_WATCHERS, Errors, matchesPattern } from './02-fs-utils.js';

/** @typedef {{ uuid: string, pattern: string, sprite: string }} WatcherEntry */

let _counter = 0;

/**
 * Generate a deterministic-enough UUID for a watcher.
 * @returns {string}
 */
export function generateWatcherUUID() {
  _counter = (_counter + 1) % 0xffffff;
  return `pfsw-${Date.now().toString(36)}-${_counter.toString(16).padStart(6, '0')}`;
}

export class WatcherManager {
  constructor() {
    /** @type {Map<string, WatcherEntry>} uuid → entry */
    this._watchers = new Map();
  }

  /**
   * Register a new watcher for a URI pattern.
   *
   * @param {string} pattern  URI glob pattern, e.g. `"documents://*.txt"`.
   * @param {string} sprite   Name of the registering sprite.
   * @returns {string}        UUID of the new watcher, or an error string.
   */
  register(pattern, sprite) {
    if (this._watchers.size >= MAX_WATCHERS) {
      return Errors.limit(`Maximum watcher count (${MAX_WATCHERS}) reached.`);
    }

    const uuid = generateWatcherUUID();
    this._watchers.set(uuid, { uuid, pattern, sprite });
    return uuid;
  }

  /**
   * Remove a watcher by UUID.
   *
   * @param {string} uuid
   * @returns {string} Empty string on success; error string on failure.
   */
  unregister(uuid) {
    if (!this._watchers.has(uuid)) {
      return Errors.notFound(`Watcher "${uuid}" not found.`);
    }
    this._watchers.delete(uuid);
    return '';
  }

  /**
   * Find all watchers whose pattern matches a given URI.
   *
   * @param {string} uri
   * @returns {WatcherEntry[]}
   */
  getMatching(uri) {
    const results = [];
    for (const entry of this._watchers.values()) {
      if (matchesPattern(entry.pattern, uri)) results.push(entry);
    }
    // Sort by sprite name (case-insensitive alphabetical order).
    results.sort((a, b) => a.sprite.toLowerCase().localeCompare(b.sprite.toLowerCase()));
    return results;
  }

  /**
   * Return all registered watchers.
   * @returns {WatcherEntry[]}
   */
  list() {
    return Array.from(this._watchers.values());
  }

  /** @returns {number} */
  get size() {
    return this._watchers.size;
  }
}
