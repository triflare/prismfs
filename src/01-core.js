/**
 * PrismFS — Core extension module
 *
 * PrismFS is an OPFS-powered, volume-based file system for TurboWarp projects.
 * Instead of a single root folder, files are organised into named "prisms"
 * addressed with a URI scheme: `prism-name://path/to/file.ext`.
 *
 * IMPORTANT — Mint bundle ordering:
 * `01-core.js` is concatenated FIRST inside the bundle IIFE (alphabetically
 * before 02–08).  All module-level code that references helper classes must
 * therefore be deferred until after the IIFE has finished initialising.
 * Use `_ensureInit()` at the start of every public method — never instantiate
 * helper classes at module scope or inside the constructor.
 */

import { PrismRegistry } from './03-prisms.js';
import { PermissionStore, PERMISSION } from './04-permissions.js';
import { SnapshotManager } from './05-snapshots.js';
import { WatcherManager } from './06-watchers.js';
import { MetadataStore } from './07-metadata.js';
import { OpfsBackend } from './08-opfs.js';
import {
  parseUri,
  normalisePath,
  matchesPattern,
  isError,
  Errors,
  PRISM_TYPE,
} from './02-fs-utils.js';

// ─── Extension class ─────────────────────────────────────────────────────────

class PrismFSExtension {
  /**
   * @param {object | null} runtime  Scratch VM runtime (Scratch.vm?.runtime).
   */
  constructor(runtime) {
    this._runtime = runtime ?? null;

    // All manager instances are created lazily in _ensureInit() because
    // 01-core.js appears before 02–08 in the bundle and the class bodies of
    // PrismRegistry, SnapshotManager, etc. are not yet defined at the moment
    // the constructor is called (Scratch.extensions.register).
    this._initialized = false;

    // Set below by _ensureInit():
    /** @type {PrismRegistry | null} */
    this._registry = null;
    /** @type {SnapshotManager | null} */
    this._snapshots = null;
    /** @type {WatcherManager | null} */
    this._watchers = null;
    /** @type {MetadataStore | null} */
    this._metadata = null;
    /** @type {OpfsBackend | null} */
    this._opfs = null;
    /** @type {Map<string, PermissionStore>} */
    this._permStores = null;
    /** @type {boolean} */
    this._debugLogging = false;

    // UUIDs whose hat blocks should fire on the next poll (edge-triggered).
    /** @type {Set<string>} */
    this._pendingWatchers = new Set();
    // UUIDs whose scripts are currently executing — suppress re-entrancy.
    /** @type {Set<string>} */
    this._suppressedWatchers = new Set();

    // Pending OPFS writes that arrived before init() resolved.
    // Each entry is { prismName, filePath, content }.
    /** @type {Array<{prismName: string, filePath: string, content: string}>} */
    this._opfsPendingWrites = [];
  }

  // ─── Lazy initialisation ──────────────────────────────────────────────────

  /**
   * Create all manager instances and attach runtime hooks.
   * Safe to call multiple times — acts only on the first call.
   */
  _ensureInit() {
    if (this._initialized) return;
    this._initialized = true;

    this._registry = new PrismRegistry();
    this._snapshots = new SnapshotManager();
    this._watchers = new WatcherManager();
    this._metadata = new MetadataStore();
    this._opfs = new OpfsBackend();
    this._permStores = new Map();

    // Kick off OPFS initialisation in the background, then hydrate the
    // default prisms (fs, tmp) and flush any writes that arrived before init.
    // NOTE: There is an inherent race condition between this async load and the
    // first block method calls. For most TurboWarp projects this is not a
    // problem because the project interacts with the extension after the
    // green-flag script starts (by which time OPFS load has usually completed),
    // but early block calls may not see files that were written in a previous
    // session. This is an accepted trade-off of the fire-and-forget approach
    // that keeps all block methods synchronous.
    this._opfs.init().then(available => {
      if (available) {
        for (const name of this._registry.list()) {
          this._loadPrismFromOpfs(name);
        }
        // Flush writes that arrived while init() was in-flight.
        for (const { prismName, filePath, content } of this._opfsPendingWrites) {
          this._opfs.writeFile(prismName, filePath, content);
        }
      }
      this._opfsPendingWrites = [];
    });

    // Attach TurboWarp/Scratch runtime hooks for green-flag / project-stop.
    if (this._runtime) {
      const cleanup = () => this._cleanupNonPersistentPrisms();
      this._runtime.on('PROJECT_RUN_START', cleanup);
      this._runtime.on('PROJECT_STOP_ALL', cleanup);
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  /** @param {...any} parts */
  _dbg(...parts) {
    if (this._debugLogging) console.log('PrismFS:', ...parts);
  }

  /**
   * Asynchronously hydrate a persistent prism's in-memory registry from OPFS.
   * No-op for temporary/immutable prisms or when OPFS is unavailable.
   *
   * @param {string} prismName  Lower-cased prism name.
   */
  _loadPrismFromOpfs(prismName) {
    if (this._registry.typeOf(prismName) !== PRISM_TYPE.PRISM) return;
    if (!this._opfs.isAvailable()) return;
    this._opfs.loadPrism(prismName).then(files => {
      if (files) {
        for (const [path, content] of files) {
          this._registry.writeFile(prismName, path, content);
        }
      }
    });
  }

  /**
   * Persist a write to OPFS.  If OPFS is still initialising, the write is
   * queued and flushed once `init()` resolves, so early block-method writes
   * are not silently lost.
   *
   * @param {string} prismName
   * @param {string} filePath
   * @param {string} content
   */
  _opfsWrite(prismName, filePath, content) {
    if (this._opfs.isAvailable()) {
      this._opfs.writeFile(prismName, filePath, content);
    } else {
      // Queue the write; it will be flushed after init() resolves.
      this._opfsPendingWrites.push({ prismName, filePath, content });
    }
  }

  /**
   * Remove all in-memory state associated with a specific prism
   * (permission stores, metadata entries).
   *
   * @param {string} prismName  Lower-cased prism name.
   */
  _clearPrismState(prismName) {
    this._permStores.delete(prismName);
    this._metadata.clearPrism(prismName);
  }

  /**
   * Unmount all non-persistent prisms (temporary and immutable) and clear
   * their associated per-prism state.  Called on PROJECT_RUN_START and
   * PROJECT_STOP_ALL.
   */
  _cleanupNonPersistentPrisms() {
    // Snapshot the list before cleanup so deletions don't affect iteration.
    const names = this._registry.list();
    this._registry.cleanupTemporary();
    for (const name of names) {
      const type = this._registry.typeOf(name);
      // typeOf returns undefined/error for prisms that were just cleaned up.
      if (!type || type !== PRISM_TYPE.PRISM) {
        this._clearPrismState(name);
      }
    }
  }

  /**
   * Resolve a URI string to `{ prism, filePath }`, or an error string.
   *
   * @param {string} uri
   * @returns {{ prism: string, filePath: string } | string}
   */
  _resolveUri(uri) {
    const parsed = parseUri(uri);
    if (!parsed) return Errors.invalidUri(`"${uri}" is not a valid PrismFS URI.`);
    if (!this._registry.isMounted(parsed.prism)) {
      return Errors.notFound(`Prism "${parsed.prism}" is not mounted.`);
    }
    return { prism: parsed.prism, filePath: normalisePath(parsed.filePath) };
  }

  /**
   * Get (or lazily create) the PermissionStore for a prism.
   *
   * @param {string} prismName
   * @returns {PermissionStore}
   */
  _getPermStore(prismName) {
    if (!this._permStores.has(prismName)) {
      this._permStores.set(prismName, new PermissionStore());
    }
    return this._permStores.get(prismName);
  }

  /**
   * Notify watchers that `uri` was written.  Skips UUIDs that are in the
   * suppression window (i.e. their own script triggered this write — prevents
   * infinite loops).
   *
   * @param {string} uri
   */
  _notifyWatchers(uri) {
    const matches = this._watchers.getMatching(uri);
    for (const w of matches) {
      this._dbg(`watcher ${w.uuid} triggered by write to ${uri}`);
      if (!this._suppressedWatchers.has(w.uuid)) {
        this._pendingWatchers.add(w.uuid);
      }
    }
  }

  /**
   * Return the calling sprite name from the Scratch block util, with a
   * fallback chain to the runtime editing target.
   *
   * The Scratch/TurboWarp block execution model passes a `util` object as the
   * second argument to every block method.  `util.target` reliably identifies
   * which target (sprite) is executing the block — even in player mode where
   * `runtime.getEditingTarget()` would return the editor-selected sprite
   * instead.
   *
   * @param {object | undefined} util  The Scratch block util object.
   * @returns {string}
   */
  _callerSpriteName(util) {
    try {
      return (
        util?.target?.sprite?.name ?? this._runtime?.getEditingTarget?.()?.sprite?.name ?? 'unknown'
      );
    } catch {
      return 'unknown';
    }
  }

  /**
   * Encode a string to base64 in a UTF-8-safe way.
   * Uses a chunked loop to avoid quadratic string-concat overhead for large
   * inputs (avoids repeated string reallocation).
   *
   * @param {string} str
   * @returns {string}
   */
  _toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    const CHUNK = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  // ─── getInfo() ────────────────────────────────────────────────────────────

  getInfo() {
    return {
      id: 'prismFS',
      name: Scratch.translate('PrismFS'),
      color1: '#44a2ff',
      color2: '#2177cd',
      color3: '#1c5fa2',
      menuIconURI: mint.assets.get('icons/menu.svg') ?? '',
      // blockIconURI: No block icon URI, because block icon URIs are your mom's ligma.
      menus: {
        prismType: {
          acceptReporters: true,
          items: [
            { text: Scratch.translate('prism'), value: PRISM_TYPE.PRISM },
            { text: Scratch.translate('temporary'), value: PRISM_TYPE.TEMPORARY },
            { text: Scratch.translate('immutable'), value: PRISM_TYPE.IMMUTABLE },
          ],
        },
        readFormat: {
          acceptReporters: true,
          items: [
            { text: Scratch.translate('text'), value: 'text' },
            { text: Scratch.translate('base64'), value: 'base64' },
            { text: Scratch.translate('data: URI'), value: 'datauri' },
          ],
        },
        permission: {
          acceptReporters: true,
          items: [
            { text: Scratch.translate('see'), value: PERMISSION.SEE },
            { text: Scratch.translate('read'), value: PERMISSION.READ },
            { text: Scratch.translate('write'), value: PERMISSION.WRITE },
            { text: Scratch.translate('manage'), value: PERMISSION.MANAGE },
          ],
        },
      },
      blocks: [
        // ── Prism management ─────────────────────────────────────────────────
        {
          opcode: 'mountPrism',
          blockType: 'command',
          text: Scratch.translate('mount prism [NAME] as [TYPE]'),
          arguments: {
            NAME: { type: 'string', defaultValue: 'myprism' },
            TYPE: { type: 'string', menu: 'prismType', defaultValue: PRISM_TYPE.PRISM },
          },
        },
        {
          opcode: 'unmountPrism',
          blockType: 'command',
          text: Scratch.translate('unmount prism [NAME]'),
          arguments: { NAME: { type: 'string', defaultValue: 'myprism' } },
        },
        {
          opcode: 'isPrismMounted',
          blockType: 'Boolean',
          text: Scratch.translate('is prism [NAME] mounted?'),
          arguments: { NAME: { type: 'string', defaultValue: 'fs' } },
        },
        {
          opcode: 'prismType',
          blockType: 'reporter',
          text: Scratch.translate('type of prism [NAME]'),
          arguments: { NAME: { type: 'string', defaultValue: 'fs' } },
        },
        {
          opcode: 'listPrisms',
          blockType: 'reporter',
          text: Scratch.translate('list of mounted prisms'),
        },
        '---',
        // ── File operations ──────────────────────────────────────────────────
        {
          opcode: 'readFile',
          blockType: 'reporter',
          text: Scratch.translate('read [URI]'),
          arguments: { URI: { type: 'string', defaultValue: 'fs://hello.txt' } },
        },
        {
          opcode: 'readFileAs',
          blockType: 'reporter',
          text: Scratch.translate('read [URI] as [FORMAT]'),
          arguments: {
            URI: { type: 'string', defaultValue: 'fs://hello.txt' },
            FORMAT: { type: 'string', menu: 'readFormat', defaultValue: 'text' },
          },
        },
        {
          opcode: 'writeFile',
          blockType: 'command',
          text: Scratch.translate('write [CONTENT] to [URI]'),
          arguments: {
            CONTENT: { type: 'string', defaultValue: 'Hello, PrismFS!' },
            URI: { type: 'string', defaultValue: 'fs://hello.txt' },
          },
        },
        {
          opcode: 'writeFileAs',
          blockType: 'command',
          text: Scratch.translate('write [CONTENT] as [FORMAT] to [URI]'),
          arguments: {
            CONTENT: { type: 'string', defaultValue: '' },
            FORMAT: { type: 'string', menu: 'readFormat', defaultValue: 'base64' },
            URI: { type: 'string', defaultValue: 'fs://hello.txt' },
          },
        },
        {
          opcode: 'deleteFile',
          blockType: 'command',
          text: Scratch.translate('delete file [URI]'),
          arguments: { URI: { type: 'string', defaultValue: 'fs://hello.txt' } },
        },
        {
          opcode: 'fileExists',
          blockType: 'Boolean',
          text: Scratch.translate('file [URI] exists?'),
          arguments: { URI: { type: 'string', defaultValue: 'fs://hello.txt' } },
        },
        {
          opcode: 'downloadFile',
          blockType: 'command',
          text: Scratch.translate('download [URI] as [FILENAME]'),
          arguments: {
            URI: { type: 'string', defaultValue: 'fs://hello.txt' },
            FILENAME: { type: 'string', defaultValue: 'hello.txt' },
          },
        },
        '---',
        // ── Directory operations ─────────────────────────────────────────────
        {
          opcode: 'listDirectory',
          blockType: 'reporter',
          text: Scratch.translate('list files in [URI]'),
          arguments: { URI: { type: 'string', defaultValue: 'fs://docs' } },
        },
        {
          opcode: 'searchFiles',
          blockType: 'reporter',
          text: Scratch.translate('search [URI] for [PATTERN]'),
          arguments: {
            URI: { type: 'string', defaultValue: 'fs://' },
            PATTERN: { type: 'string', defaultValue: '*.txt' },
          },
        },
        '---',
        // ── Permissions ──────────────────────────────────────────────────────
        {
          opcode: 'setPermission',
          blockType: 'command',
          text: Scratch.translate('set [PERM] on [URI] to [VALUE]'),
          arguments: {
            PERM: { type: 'string', menu: 'permission', defaultValue: PERMISSION.WRITE },
            URI: { type: 'string', defaultValue: 'fs://docs' },
            VALUE: { type: 'Boolean', defaultValue: true },
          },
        },
        {
          opcode: 'hasPermission',
          blockType: 'Boolean',
          text: Scratch.translate('[URI] has [PERM] permission?'),
          arguments: {
            URI: { type: 'string', defaultValue: 'fs://docs' },
            PERM: { type: 'string', menu: 'permission', defaultValue: PERMISSION.READ },
          },
        },
        '---',
        // ── Snapshots ────────────────────────────────────────────────────────
        {
          opcode: 'createSnapshot',
          blockType: 'command',
          text: Scratch.translate('snapshot prism [PRISM] as [NAME]'),
          arguments: {
            PRISM: { type: 'string', defaultValue: 'fs' },
            NAME: { type: 'string', defaultValue: 'before-update' },
          },
        },
        {
          opcode: 'deleteSnapshot',
          blockType: 'command',
          text: Scratch.translate('delete snapshot [NAME] from prism [PRISM]'),
          arguments: {
            NAME: { type: 'string', defaultValue: 'before-update' },
            PRISM: { type: 'string', defaultValue: 'fs' },
          },
        },
        {
          opcode: 'listSnapshots',
          blockType: 'reporter',
          text: Scratch.translate('snapshots of prism [PRISM]'),
          arguments: { PRISM: { type: 'string', defaultValue: 'fs' } },
        },
        {
          opcode: 'snapshotDiff',
          blockType: 'reporter',
          text: Scratch.translate('diff prism [PRISM] snapshot [S1] → [S2]'),
          arguments: {
            PRISM: { type: 'string', defaultValue: 'fs' },
            S1: { type: 'string', defaultValue: 'before-update' },
            S2: { type: 'string', defaultValue: 'after-update' },
          },
        },
        '---',
        // ── Backup & restore ─────────────────────────────────────────────────
        {
          opcode: 'backupPrism',
          blockType: 'reporter',
          text: Scratch.translate('backup prism [NAME]'),
          arguments: { NAME: { type: 'string', defaultValue: 'fs' } },
        },
        {
          opcode: 'restorePrism',
          blockType: 'command',
          text: Scratch.translate('restore prism from backup [DATA]'),
          arguments: { DATA: { type: 'string', defaultValue: '{}' } },
        },
        '---',
        // ── File watching ────────────────────────────────────────────────────
        {
          opcode: 'watchPath',
          blockType: 'reporter',
          text: Scratch.translate('watch [PATTERN]'),
          arguments: { PATTERN: { type: 'string', defaultValue: 'fs://**' } },
        },
        {
          opcode: 'unwatchPath',
          blockType: 'command',
          text: Scratch.translate('unwatch [UUID]'),
          arguments: { UUID: { type: 'string', defaultValue: '' } },
        },
        {
          opcode: 'onFileChanged',
          blockType: 'hat',
          text: Scratch.translate('when [UUID] fires'),
          arguments: { UUID: { type: 'string', defaultValue: '' } },
        },
        '---',
        // ── Metadata ─────────────────────────────────────────────────────────
        {
          opcode: 'getMetadata',
          blockType: 'reporter',
          text: Scratch.translate('metadata [TAG] of [URI]'),
          arguments: {
            TAG: { type: 'string', defaultValue: 'createdAt' },
            URI: { type: 'string', defaultValue: 'fs://hello.txt' },
          },
        },
        {
          opcode: 'setMetadata',
          blockType: 'command',
          text: Scratch.translate('set metadata [TAG] of [URI] to [VALUE]'),
          arguments: {
            TAG: { type: 'string', defaultValue: 'author' },
            URI: { type: 'string', defaultValue: 'fs://hello.txt' },
            VALUE: { type: 'string', defaultValue: 'Alice' },
          },
        },
        {
          opcode: 'getAllMetadata',
          blockType: 'reporter',
          text: Scratch.translate('all metadata of [URI]'),
          arguments: { URI: { type: 'string', defaultValue: 'fs://hello.txt' } },
        },
        '---',
        // ── Debug ────────────────────────────────────────────────────────────
        {
          opcode: 'setDebugLogging',
          blockType: 'command',
          text: Scratch.translate('set debug logging [VALUE]'),
          arguments: {
            VALUE: { type: 'Boolean', defaultValue: false },
          },
        },
      ],
    };
  }

  // ─── Block implementations: prism management ─────────────────────────────

  mountPrism(args) {
    this._ensureInit();
    const result = this._registry.mount(String(args.NAME), String(args.TYPE));
    if (result) this._dbg(`mountPrism error: ${result}`);
    // Load OPFS data for the newly mounted persistent prism (if available).
    if (!result) this._loadPrismFromOpfs(String(args.NAME).toLowerCase());
    return result;
  }

  unmountPrism(args) {
    this._ensureInit();
    const name = String(args.NAME).toLowerCase();
    const type = this._registry.typeOf(name);
    const result = this._registry.unmount(name);
    if (result) {
      this._dbg(`unmountPrism error: ${result}`);
      return;
    }
    // Remove per-prism state so a remounted prism starts clean.
    this._clearPrismState(name);
    // Delete OPFS data for persistent prisms so the data doesn't accumulate.
    if (type === PRISM_TYPE.PRISM && this._opfs.isAvailable()) {
      this._opfs.deletePrism(name);
    }
  }

  isPrismMounted(args) {
    this._ensureInit();
    return this._registry.isMounted(String(args.NAME));
  }

  prismType(args) {
    this._ensureInit();
    return this._registry.typeOf(String(args.NAME));
  }

  listPrisms() {
    this._ensureInit();
    return JSON.stringify(this._registry.list());
  }

  // ─── Block implementations: file operations ───────────────────────────────

  readFile(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;

    const { prism, filePath } = resolved;
    if (!this._getPermStore(prism).has(filePath, PERMISSION.READ)) {
      return Errors.permission(`No read permission on "${args.URI}".`);
    }
    return this._registry.readFile(prism, filePath);
  }

  readFileAs(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;

    const { prism, filePath } = resolved;
    if (!this._getPermStore(prism).has(filePath, PERMISSION.READ)) {
      return Errors.permission(`No read permission on "${args.URI}".`);
    }

    const content = this._registry.readFile(prism, filePath);
    if (isError(content)) return content;

    const format = String(args.FORMAT);
    if (format === 'base64') {
      try {
        return this._toBase64(content);
      } catch {
        return Errors.invalid('Failed to encode content as base64.');
      }
    }
    if (format === 'datauri') {
      try {
        return `data:text/plain;base64,${this._toBase64(content)}`;
      } catch {
        return Errors.invalid('Failed to encode content as data: URI.');
      }
    }
    return content;
  }

  writeFile(args, util) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return;

    const { prism, filePath } = resolved;
    if (!this._getPermStore(prism).has(filePath, PERMISSION.WRITE)) {
      this._dbg(`writeFile: no write permission on "${args.URI}"`);
      return;
    }

    const isNew = !this._registry.fileExists(prism, filePath);
    const result = this._registry.writeFile(prism, filePath, String(args.CONTENT));
    if (result) {
      this._dbg(`writeFile error: ${result}`);
      return;
    }

    const uri = `${prism}://${filePath}`;
    const sprite = this._callerSpriteName(util);
    if (isNew) {
      this._metadata.initBuiltin(uri, sprite);
    } else {
      this._metadata.touch(uri, sprite);
    }

    // Persist to OPFS asynchronously (fire-and-forget for persistent prisms).
    if (this._registry.typeOf(prism) === PRISM_TYPE.PRISM) {
      this._opfsWrite(prism, filePath, String(args.CONTENT));
    }

    this._notifyWatchers(uri);
  }

  /**
   * Write content that is already encoded (base64 or data: URI) and decode it
   * before storing.
   */
  writeFileAs(args, util) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return;

    const { prism, filePath } = resolved;
    if (!this._getPermStore(prism).has(filePath, PERMISSION.WRITE)) {
      this._dbg(`writeFileAs: no write permission on "${args.URI}"`);
      return;
    }

    const format = String(args.FORMAT);
    let rawContent = String(args.CONTENT);

    if (format === 'base64') {
      try {
        const bytes = Uint8Array.from(atob(rawContent), c => c.charCodeAt(0));
        rawContent = new TextDecoder().decode(bytes);
      } catch {
        this._dbg(`writeFileAs: invalid base64 data`);
        return;
      }
    } else if (format === 'datauri') {
      try {
        const b64 = rawContent.replace(/^data:[^;]+;base64,/, '');
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        rawContent = new TextDecoder().decode(bytes);
      } catch {
        this._dbg(`writeFileAs: invalid data: URI`);
        return;
      }
    }

    this.writeFile({ URI: args.URI, CONTENT: rawContent }, util);
  }

  deleteFile(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return;

    const { prism, filePath } = resolved;
    if (!this._getPermStore(prism).has(filePath, PERMISSION.MANAGE)) {
      this._dbg(`deleteFile: no manage permission on "${args.URI}"`);
      return;
    }

    const result = this._registry.deleteFile(prism, filePath);
    if (result) {
      this._dbg(`deleteFile error: ${result}`);
      return;
    }

    // Remove from OPFS asynchronously.
    if (this._registry.typeOf(prism) === PRISM_TYPE.PRISM && this._opfs.isAvailable()) {
      this._opfs.deleteFile(prism, filePath);
    }
  }

  fileExists(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return false;

    const { prism, filePath } = resolved;
    if (!this._getPermStore(prism).has(filePath, PERMISSION.SEE)) return false;
    return this._registry.fileExists(prism, filePath);
  }

  /**
   * Trigger a browser download of a file's text content.
   * No-op when running outside a browser context (e.g., in tests).
   */
  downloadFile(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return;

    const { prism, filePath } = resolved;
    if (!this._getPermStore(prism).has(filePath, PERMISSION.READ)) {
      this._dbg(`downloadFile: no read permission on "${args.URI}"`);
      return;
    }

    const content = this._registry.readFile(prism, filePath);
    if (isError(content)) {
      this._dbg(`downloadFile error: ${content}`);
      return;
    }

    // Browser-only: trigger file download.
    if (typeof document !== 'undefined') {
      try {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = String(args.FILENAME) || filePath.split('/').pop() || 'file.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (e) {
        this._dbg(`downloadFile: browser download failed: ${e.message}`);
      }
    }
  }

  // ─── Block implementations: directory operations ──────────────────────────

  listDirectory(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;

    const { prism, filePath } = resolved;
    if (!this._getPermStore(prism).has(filePath || '', PERMISSION.SEE)) {
      return Errors.permission(`No see permission on "${args.URI}".`);
    }

    const result = this._registry.listFiles(prism, filePath || undefined);
    if (isError(result)) return result;
    return JSON.stringify(result);
  }

  searchFiles(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;

    const { prism, filePath } = resolved;
    if (!this._getPermStore(prism).has(filePath || '', PERMISSION.SEE)) {
      return Errors.permission(`No see permission on "${args.URI}".`);
    }

    const all = this._registry.listFiles(prism, filePath || undefined);
    if (isError(all)) return all;

    const rawPattern = String(args.PATTERN);
    // If the pattern contains "://" it is a full URI pattern; pass through
    // as-is.  Otherwise it is a path glob — construct the full URI pattern so
    // matchesPattern can compare scheme + path correctly.
    const pattern = rawPattern.includes('://')
      ? rawPattern
      : `${prism}://${rawPattern.startsWith('**/') ? rawPattern : `**/${rawPattern}`}`;

    const filtered = all.filter(p => matchesPattern(pattern, `${prism}://${p}`));
    return JSON.stringify(filtered);
  }

  // ─── Block implementations: permissions ──────────────────────────────────

  setPermission(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return;

    const { prism, filePath } = resolved;
    const store = this._getPermStore(prism);
    if (!store.has(filePath || '', PERMISSION.MANAGE)) {
      this._dbg(`setPermission: no manage permission on "${args.URI}"`);
      return;
    }

    const perm = String(args.PERM);
    const current = new Set(store.resolve(filePath || ''));
    const enable = args.VALUE === true || args.VALUE === 'true';
    if (enable) {
      current.add(perm);
    } else {
      current.delete(perm);
    }

    const err = store.set(filePath || '', current);
    if (err) this._dbg(`setPermission error: ${err}`);
  }

  hasPermission(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return false;

    const { prism, filePath } = resolved;
    return this._getPermStore(prism).has(filePath || '', String(args.PERM));
  }

  // ─── Block implementations: snapshots ────────────────────────────────────

  createSnapshot(args) {
    this._ensureInit();
    const prismName = String(args.PRISM).toLowerCase();
    if (!this._registry.isMounted(prismName)) {
      this._dbg(`createSnapshot: prism "${prismName}" not mounted`);
      return;
    }

    const filesCopy = this._registry.snapshotFiles(prismName);
    if (isError(filesCopy)) {
      this._dbg(`createSnapshot error: ${filesCopy}`);
      return;
    }

    const result = this._snapshots.create(prismName, String(args.NAME), filesCopy);
    if (result) this._dbg(`createSnapshot error: ${result}`);
  }

  deleteSnapshot(args) {
    this._ensureInit();
    const result = this._snapshots.delete(String(args.PRISM).toLowerCase(), String(args.NAME));
    if (result) this._dbg(`deleteSnapshot error: ${result}`);
  }

  listSnapshots(args) {
    this._ensureInit();
    return JSON.stringify(this._snapshots.list(String(args.PRISM).toLowerCase()));
  }

  snapshotDiff(args) {
    this._ensureInit();
    const prism = String(args.PRISM).toLowerCase();
    const s1 = this._snapshots.get(prism, String(args.S1));
    const s2 = this._snapshots.get(prism, String(args.S2));

    if (!s1) return Errors.notFound(`Snapshot "${args.S1}" not found.`);
    if (!s2) return Errors.notFound(`Snapshot "${args.S2}" not found.`);
    return JSON.stringify(SnapshotManager.diff(s1.files, s2.files));
  }

  // ─── Block implementations: backup & restore ─────────────────────────────

  backupPrism(args) {
    this._ensureInit();
    const prismName = String(args.NAME).toLowerCase();
    if (!this._registry.isMounted(prismName)) {
      return Errors.notFound(`Prism "${args.NAME}" is not mounted.`);
    }

    const entry = this._registry.get(prismName);
    return JSON.stringify({
      name: prismName,
      type: entry.type,
      files: Object.fromEntries(
        Array.from(entry.files.entries()).map(([path, f]) => [
          path,
          { content: f.content, createdAt: f.createdAt, modifiedAt: f.modifiedAt },
        ])
      ),
      createdAt: new Date().toISOString(),
    });
  }

  restorePrism(args) {
    this._ensureInit();
    let backupObj;
    try {
      backupObj = JSON.parse(String(args.DATA));
    } catch {
      this._dbg('restorePrism: invalid JSON');
      return;
    }
    if (!backupObj || typeof backupObj.name !== 'string') {
      this._dbg('restorePrism: missing name');
      return;
    }

    const prismName = backupObj.name.toLowerCase();
    if (this._registry.isMounted(prismName)) {
      this._registry.unmount(prismName);
      this._clearPrismState(prismName);
    }

    const mountResult = this._registry.mount(prismName, backupObj.type ?? PRISM_TYPE.PRISM);
    if (mountResult) {
      this._dbg(`restorePrism mount error: ${mountResult}`);
      return;
    }

    if (backupObj.files && typeof backupObj.files === 'object') {
      const isPersistent = String(backupObj.type ?? PRISM_TYPE.PRISM) === PRISM_TYPE.PRISM;
      for (const [path, f] of Object.entries(backupObj.files)) {
        this._registry.writeFile(prismName, path, f.content ?? '');
      }
      // Persist the whole prism to OPFS in one pass after hydrating in-memory
      // (avoids per-file write-amplification in the restore loop).
      if (isPersistent) {
        const allFiles = this._registry.snapshotFiles(prismName);
        if (allFiles) {
          for (const [path, entry] of allFiles) {
            this._opfsWrite(prismName, path, entry.content ?? '');
          }
        }
      }
    }
  }

  // ─── Block implementations: file watching ────────────────────────────────

  watchPath(args, util) {
    this._ensureInit();
    const result = this._watchers.register(String(args.PATTERN), this._callerSpriteName(util));
    // If quota was reached, the error string is returned to the caller AND
    // logged so the developer can diagnose it via debug logging.
    if (isError(result)) this._dbg(`watchPath: quota or error: ${result}`);
    return result;
  }

  unwatchPath(args) {
    this._ensureInit();
    const result = this._watchers.unregister(String(args.UUID));
    if (result) this._dbg(`unwatchPath error: ${result}`);
  }

  /**
   * Hat block: fires once per write event for the registered watcher UUID.
   *
   * Uses an edge-triggered pending-fires set so the hat fires exactly once per
   * write event rather than every tick.  While the hat is "active" the UUID is
   * added to `_suppressedWatchers` to prevent the watcher's own script from
   * recursively re-triggering itself.
   *
   * Suppression is lifted via `queueMicrotask`, which runs after the current
   * synchronous execution context completes.  This covers the common case of a
   * script that writes synchronously within the same Scratch tick, but a script
   * that uses `await` or yield-based blocks (e.g. `wait`) may allow the
   * suppression window to expire before the write happens.  This is a
   * best-effort implementation; full re-entrancy prevention would require
   * deeper integration with the TurboWarp scheduler.
   */
  onFileChanged(args) {
    this._ensureInit();
    const uuid = String(args.UUID);
    if (this._pendingWatchers.has(uuid)) {
      this._pendingWatchers.delete(uuid);
      // Suppress re-entrancy: if the script triggered by this hat writes to a
      // watched file, that watcher should not fire again immediately.
      this._suppressedWatchers.add(uuid);
      queueMicrotask(() => this._suppressedWatchers.delete(uuid));
      return true;
    }
    return false;
  }

  // ─── Block implementations: metadata ─────────────────────────────────────

  getMetadata(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;
    return this._metadata.get(String(args.URI), String(args.TAG));
  }

  setMetadata(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return;
    const result = this._metadata.set(String(args.URI), String(args.TAG), String(args.VALUE));
    if (result) this._dbg(`setMetadata error: ${result}`);
  }

  getAllMetadata(args) {
    this._ensureInit();
    const resolved = this._resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;
    return JSON.stringify(this._metadata.getAll(String(args.URI)));
  }

  // ─── Block implementations: debug ────────────────────────────────────────

  setDebugLogging(args) {
    this._debugLogging = args.VALUE === true || args.VALUE === 'true';
  }
}

Scratch.extensions.register(new PrismFSExtension(Scratch.vm?.runtime));
