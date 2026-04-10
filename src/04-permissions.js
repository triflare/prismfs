/**
 * PrismFS permission system.
 *
 * Every file and directory can carry four permissions: "see", "read", "write",
 * and "manage".  Permissions are defined per prism and cascade from the prism
 * root → directory → file; a more-specific entry overrides a less-specific one.
 *
 * If no permission entry exists for a path (or any of its ancestors), all four
 * permissions are granted by default.
 */

import { PERMISSION, ALL_PERMISSIONS, Errors } from './02-fs-utils.js';

export { PERMISSION };

export class PermissionStore {
  constructor() {
    /**
     * Map from normalised path (or empty string for the prism root) to an
     * immutable frozen Set of granted permissions.
     *
     * @type {Map<string, ReadonlySet<string>>}
     */
    this._map = new Map();
  }

  /**
   * Set the permissions for a path, replacing any existing entry.
   *
   * @param {string}                  path        Normalised file path (empty = prism root).
   * @param {Iterable<string>}        permissions Collection of `PERMISSION` values to grant.
   * @returns {string}                            Empty string on success; error string on failure.
   */
  set(path, permissions) {
    const perms = new Set(permissions);
    for (const p of perms) {
      if (!ALL_PERMISSIONS.includes(p)) {
        return Errors.invalid(`Unknown permission: "${p}".`);
      }
    }
    this._map.set(path, Object.freeze(perms));
    return '';
  }

  /**
   * Return the effective permissions for a path by walking up the tree.
   * Always returns a new Set so callers cannot mutate internal state.
   *
   * @param {string} path
   * @returns {Set<string>}
   */
  resolve(path) {
    // Exact match first.
    if (this._map.has(path)) return new Set(this._map.get(path));

    // Walk toward the prism root.
    const segments = path.split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const ancestor = segments.slice(0, i).join('/');
      if (this._map.has(ancestor)) return new Set(this._map.get(ancestor));
    }

    // Prism-root entry (empty string key).
    if (this._map.has('')) return new Set(this._map.get(''));

    // Default: all permissions granted.
    return new Set(ALL_PERMISSIONS);
  }

  /**
   * Check whether a specific permission is granted for a path.
   *
   * @param {string} path
   * @param {string} permission  One of the `PERMISSION` values.
   * @returns {boolean}
   */
  has(path, permission) {
    return this.resolve(path).has(permission);
  }

  /**
   * Remove the explicit permission entry for a path, restoring inherited behaviour.
   *
   * @param {string} path
   */
  reset(path) {
    this._map.delete(path);
  }
}
