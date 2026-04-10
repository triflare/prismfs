/**
 * PrismFS — Core extension module
 *
 * PrismFS is an OPFS-powered, volume-based file system for TurboWarp projects.
 * Instead of a single root folder, files are organised into named "prisms"
 * addressed with a URI scheme: `prism-name://path/to/file.ext`.
 *
 * Load order note: this file is numbered 01-* so Mint bundles it last (after
 * the helper modules 02–07 have been processed), making their exports available
 * when this file's top-level import statements execute.
 */

import { PrismRegistry } from './03-prisms.js';
import { PermissionStore, PERMISSION } from './04-permissions.js';
import { SnapshotManager } from './05-snapshots.js';
import { WatcherManager } from './06-watchers.js';
import { MetadataStore } from './07-metadata.js';
import {
  parseUri,
  normalisePath,
  matchesPattern,
  isError,
  Errors,
  PRISM_TYPE,
} from './02-fs-utils.js';

// ─── Singleton managers ──────────────────────────────────────────────────────

const registry = new PrismRegistry();
const snapshotMgr = new SnapshotManager();
const watcherMgr = new WatcherManager();
const metadataMgr = new MetadataStore();

/** @type {Map<string, PermissionStore>} prism name → permission store */
const permStores = new Map();

/** @type {boolean} */
let debugLogging = false;

// ─── Internal helpers ────────────────────────────────────────────────────────

/** @param {...any} args */
function dbg(...args) {
  if (debugLogging) console.log('PrismFS:', ...args);
}

/**
 * Resolve a URI and verify the prism is mounted.
 *
 * @param {string} uri
 * @returns {{ prism: string, filePath: string } | string}
 */
function resolveUri(uri) {
  const parsed = parseUri(uri);
  if (!parsed) return Errors.invalidUri(`"${uri}" is not a valid PrismFS URI.`);
  if (!registry.isMounted(parsed.prism)) {
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
function getPermStore(prismName) {
  if (!permStores.has(prismName)) permStores.set(prismName, new PermissionStore());
  return permStores.get(prismName);
}

/**
 * Notify watchers that a URI was written to.
 *
 * @param {string} uri
 */
function notifyWatchers(uri) {
  const matches = watcherMgr.getMatching(uri);
  for (const w of matches) {
    dbg(`watcher ${w.uuid} triggered by write to ${uri}`);
  }
}

// ─── Extension class ─────────────────────────────────────────────────────────

class PrismFSExtension {
  constructor() {
    this._runtime = null;
  }

  getInfo() {
    return {
      id: 'prismFS',
      name: Scratch.translate('PrismFS'),
      color1: '#FF4444',
      color2: '#CC2222',
      color3: '#AA0000',
      menuIconURI: mint.assets.get('icons/menu.png') ?? '',
      blockIconURI: mint.assets.get('icons/block.png') ?? '',
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
    const result = registry.mount(String(args.NAME), String(args.TYPE));
    if (result) dbg(`mountPrism error: ${result}`);
    return result;
  }

  unmountPrism(args) {
    const result = registry.unmount(String(args.NAME));
    if (result) dbg(`unmountPrism error: ${result}`);
  }

  isPrismMounted(args) {
    return registry.isMounted(String(args.NAME));
  }

  prismType(args) {
    return registry.typeOf(String(args.NAME));
  }

  listPrisms() {
    return JSON.stringify(registry.list());
  }

  // ─── Block implementations: file operations ───────────────────────────────

  readFile(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;

    const { prism, filePath } = resolved;
    if (!getPermStore(prism).has(filePath, PERMISSION.READ)) {
      return Errors.permission(`No read permission on "${args.URI}".`);
    }
    return registry.readFile(prism, filePath);
  }

  readFileAs(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;

    const { prism, filePath } = resolved;
    if (!getPermStore(prism).has(filePath, PERMISSION.READ)) {
      return Errors.permission(`No read permission on "${args.URI}".`);
    }

    const content = registry.readFile(prism, filePath);
    if (isError(content)) return content;

    const format = String(args.FORMAT);
    if (format === 'base64') {
      try {
        return btoa(unescape(encodeURIComponent(content)));
      } catch {
        return Errors.invalid('Failed to encode content as base64.');
      }
    }
    if (format === 'datauri') {
      try {
        return `data:text/plain;base64,${btoa(unescape(encodeURIComponent(content)))}`;
      } catch {
        return Errors.invalid('Failed to encode content as data: URI.');
      }
    }
    return content;
  }

  writeFile(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return;

    const { prism, filePath } = resolved;
    if (!getPermStore(prism).has(filePath, PERMISSION.WRITE)) {
      dbg(`writeFile: no write permission on "${args.URI}"`);
      return;
    }

    const result = registry.writeFile(prism, filePath, String(args.CONTENT));
    if (result) { dbg(`writeFile error: ${result}`); return; }

    metadataMgr.touch(`${prism}://${filePath}`, this._callerSpriteName());
    notifyWatchers(`${prism}://${filePath}`);
  }

  deleteFile(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return;

    const { prism, filePath } = resolved;
    if (!getPermStore(prism).has(filePath, PERMISSION.MANAGE)) {
      dbg(`deleteFile: no manage permission on "${args.URI}"`);
      return;
    }

    const result = registry.deleteFile(prism, filePath);
    if (result) dbg(`deleteFile error: ${result}`);
  }

  fileExists(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return false;

    const { prism, filePath } = resolved;
    if (!getPermStore(prism).has(filePath, PERMISSION.SEE)) return false;
    return registry.fileExists(prism, filePath);
  }

  // ─── Block implementations: directory operations ──────────────────────────

  listDirectory(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;

    const { prism, filePath } = resolved;
    if (!getPermStore(prism).has(filePath || '', PERMISSION.SEE)) {
      return Errors.permission(`No see permission on "${args.URI}".`);
    }

    const result = registry.listFiles(prism, filePath || undefined);
    if (isError(result)) return result;
    return JSON.stringify(result);
  }

  searchFiles(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;

    const { prism, filePath } = resolved;
    if (!getPermStore(prism).has(filePath || '', PERMISSION.SEE)) {
      return Errors.permission(`No see permission on "${args.URI}".`);
    }

    const all = registry.listFiles(prism, filePath || undefined);
    if (isError(all)) return all;

    const pattern = String(args.PATTERN);
    const filtered = all.filter(p => matchesPattern(pattern, p));
    return JSON.stringify(filtered);
  }

  // ─── Block implementations: permissions ──────────────────────────────────

  setPermission(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return;

    const { prism, filePath } = resolved;
    const store = getPermStore(prism);
    if (!store.has(filePath || '', PERMISSION.MANAGE)) {
      dbg(`setPermission: no manage permission on "${args.URI}"`);
      return;
    }

    const perm = String(args.PERM);
    const current = new Set(store.resolve(filePath || ''));
    const enable = args.VALUE === true || args.VALUE === 'true';
    if (enable) { current.add(perm); } else { current.delete(perm); }
    store.set(filePath || '', current);
  }

  hasPermission(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return false;

    const { prism, filePath } = resolved;
    return getPermStore(prism).has(filePath || '', String(args.PERM));
  }

  // ─── Block implementations: snapshots ────────────────────────────────────

  createSnapshot(args) {
    const prismName = String(args.PRISM).toLowerCase();
    if (!registry.isMounted(prismName)) {
      dbg(`createSnapshot: prism "${prismName}" not mounted`);
      return;
    }

    const filesCopy = registry.snapshotFiles(prismName);
    if (isError(filesCopy)) { dbg(`createSnapshot error: ${filesCopy}`); return; }

    const result = snapshotMgr.create(prismName, String(args.NAME), filesCopy);
    if (result) dbg(`createSnapshot error: ${result}`);
  }

  deleteSnapshot(args) {
    const result = snapshotMgr.delete(String(args.PRISM).toLowerCase(), String(args.NAME));
    if (result) dbg(`deleteSnapshot error: ${result}`);
  }

  listSnapshots(args) {
    return JSON.stringify(snapshotMgr.list(String(args.PRISM).toLowerCase()));
  }

  snapshotDiff(args) {
    const prism = String(args.PRISM).toLowerCase();
    const s1 = snapshotMgr.get(prism, String(args.S1));
    const s2 = snapshotMgr.get(prism, String(args.S2));

    if (!s1) return Errors.notFound(`Snapshot "${args.S1}" not found.`);
    if (!s2) return Errors.notFound(`Snapshot "${args.S2}" not found.`);
    return JSON.stringify(SnapshotManager.diff(s1.files, s2.files));
  }

  // ─── Block implementations: backup & restore ─────────────────────────────

  backupPrism(args) {
    const prismName = String(args.NAME).toLowerCase();
    if (!registry.isMounted(prismName)) {
      return Errors.notFound(`Prism "${args.NAME}" is not mounted.`);
    }

    const entry = registry.get(prismName);
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
    let backupObj;
    try { backupObj = JSON.parse(String(args.DATA)); } catch { dbg('restorePrism: invalid JSON'); return; }
    if (!backupObj || typeof backupObj.name !== 'string') { dbg('restorePrism: missing name'); return; }

    const prismName = backupObj.name.toLowerCase();
    if (registry.isMounted(prismName)) registry.unmount(prismName);

    const mountResult = registry.mount(prismName, backupObj.type ?? PRISM_TYPE.PRISM);
    if (mountResult) { dbg(`restorePrism mount error: ${mountResult}`); return; }

    if (backupObj.files && typeof backupObj.files === 'object') {
      for (const [path, f] of Object.entries(backupObj.files)) {
        registry.writeFile(prismName, path, f.content ?? '');
      }
    }
  }

  // ─── Block implementations: file watching ────────────────────────────────

  watchPath(args) {
    return watcherMgr.register(String(args.PATTERN), this._callerSpriteName());
  }

  unwatchPath(args) {
    const result = watcherMgr.unregister(String(args.UUID));
    if (result) dbg(`unwatchPath error: ${result}`);
  }

  onFileChanged(args) {
    return watcherMgr.list().some(w => w.uuid === String(args.UUID));
  }

  // ─── Block implementations: metadata ─────────────────────────────────────

  getMetadata(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;
    return metadataMgr.get(String(args.URI), String(args.TAG));
  }

  setMetadata(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return;
    const result = metadataMgr.set(String(args.URI), String(args.TAG), String(args.VALUE));
    if (result) dbg(`setMetadata error: ${result}`);
  }

  getAllMetadata(args) {
    const resolved = resolveUri(String(args.URI));
    if (isError(resolved)) return resolved;
    return JSON.stringify(metadataMgr.getAll(String(args.URI)));
  }

  // ─── Block implementations: debug ────────────────────────────────────────

  setDebugLogging(args) {
    debugLogging = args.VALUE === true || args.VALUE === 'true';
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  _callerSpriteName() {
    try {
      return this._runtime?.getEditingTarget?.()?.sprite?.name ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }
}

Scratch.extensions.register(new PrismFSExtension());
