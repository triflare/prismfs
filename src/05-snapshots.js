/**
 * PrismFS snapshot manager.
 *
 * Snapshots capture a storage-efficient, immutable copy of a prism's file
 * tree.  They are kept in the reserved `prismsnap://` prism and are used for
 * emergency in-session recovery.  A maximum of 20 snapshots are kept per
 * prism.  Snapshots cannot be exported or imported (use the backup/restore
 * feature for that).
 */

import { MAX_SNAPSHOTS_PER_PRISM, Errors } from './02-fs-utils.js';

/**
 * @typedef {{ name: string, timestamp: number, files: Map<string,any> }} Snapshot
 */

export class SnapshotManager {
  constructor() {
    /** @type {Map<string, Snapshot[]>} prism name → ordered list of snapshots */
    this._store = new Map();
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /** @param {string} prism */
  _bucket(prism) {
    if (!this._store.has(prism)) this._store.set(prism, []);
    return this._store.get(prism);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Create a named snapshot for a prism.
   *
   * @param {string}             prismName    Name of the source prism.
   * @param {string}             snapshotName Human-readable name for the snapshot.
   * @param {Map<string, any>}   files        Shallow copy of the prism's file map.
   * @returns {string}                        Empty string on success; error string on failure.
   */
  create(prismName, snapshotName, files) {
    const bucket = this._bucket(prismName);

    if (bucket.length >= MAX_SNAPSHOTS_PER_PRISM) {
      return Errors.limit(
        `Maximum snapshot count (${MAX_SNAPSHOTS_PER_PRISM}) reached for prism "${prismName}".`
      );
    }
    if (bucket.some(s => s.name === snapshotName)) {
      return Errors.exists(
        `Snapshot "${snapshotName}" already exists for prism "${prismName}".`
      );
    }

    bucket.push({ name: snapshotName, timestamp: Date.now(), files: new Map(files) });
    return '';
  }

  /**
   * List all snapshot descriptors for a prism (name + timestamp only).
   *
   * @param {string} prismName
   * @returns {Array<{ name: string, timestamp: number }>}
   */
  list(prismName) {
    return (this._store.get(prismName) ?? []).map(({ name, timestamp }) => ({
      name,
      timestamp,
    }));
  }

  /**
   * Retrieve a snapshot by name.
   *
   * @param {string} prismName
   * @param {string} snapshotName
   * @returns {Snapshot | null}
   */
  get(prismName, snapshotName) {
    return (this._store.get(prismName) ?? []).find(s => s.name === snapshotName) ?? null;
  }

  /**
   * Delete a named snapshot.
   *
   * @param {string} prismName
   * @param {string} snapshotName
   * @returns {string} Empty string on success; error string on failure.
   */
  delete(prismName, snapshotName) {
    const bucket = this._store.get(prismName);
    if (!bucket) {
      return Errors.notFound(`No snapshots found for prism "${prismName}".`);
    }
    const idx = bucket.findIndex(s => s.name === snapshotName);
    if (idx === -1) {
      return Errors.notFound(
        `Snapshot "${snapshotName}" not found for prism "${prismName}".`
      );
    }

    bucket.splice(idx, 1);
    return '';
  }

  /**
   * Compute a diff between two snapshots (or one snapshot and the live files).
   * Returns an object with `added`, `removed`, and `modified` path arrays.
   *
   * @param {Map<string, any>} filesA  Base snapshot/live files.
   * @param {Map<string, any>} filesB  Target snapshot/live files.
   * @returns {{ added: string[], removed: string[], modified: string[] }}
   */
  static diff(filesA, filesB) {
    const added = [];
    const removed = [];
    const modified = [];

    for (const [path, entryB] of filesB.entries()) {
      if (!filesA.has(path)) {
        added.push(path);
      } else if (filesA.get(path).content !== entryB.content) {
        modified.push(path);
      }
    }
    for (const path of filesA.keys()) {
      if (!filesB.has(path)) removed.push(path);
    }

    return { added, removed, modified };
  }
}
