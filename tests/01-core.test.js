/**
 * Unit tests for src/01-core.js (PrismFSExtension class)
 *
 * The Scratch global mock must be installed before the core module is imported,
 * because 01-core.js calls Scratch.extensions.register() at module load time.
 * The mock captures the registered instance so the class methods can be tested.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installScratchMock } from './helpers/mock-scratch.js';

const { mock } = installScratchMock();
let extension;
mock.extensions.register = instance => {
  extension = instance;
};

await import('../src/01-core.js');

// ─── Registration ─────────────────────────────────────────────────────────────

describe('PrismFSExtension — registration', () => {
  it('registers an extension instance with Scratch', () => {
    assert.ok(extension, 'Scratch.extensions.register should have been called');
  });
});

// ─── getInfo() ────────────────────────────────────────────────────────────────

describe('PrismFSExtension — getInfo()', () => {
  it('returns id "prismFS"', () => {
    assert.equal(extension.getInfo().id, 'prismFS');
  });

  it('returns name "PrismFS"', () => {
    assert.equal(extension.getInfo().name, 'PrismFS');
  });

  it('uses light-red accent colors', () => {
    const info = extension.getInfo();
    assert.equal(info.color1, '#FF4444');
    assert.equal(info.color2, '#CC2222');
    assert.equal(info.color3, '#AA0000');
  });

  it('exposes a non-empty blocks array', () => {
    const { blocks } = extension.getInfo();
    assert.ok(Array.isArray(blocks) && blocks.length > 0);
  });

  it('declares all core block opcodes', () => {
    const opcodes = extension
      .getInfo()
      .blocks.filter(b => typeof b === 'object')
      .map(b => b.opcode);

    const expected = [
      'mountPrism',
      'unmountPrism',
      'isPrismMounted',
      'prismType',
      'listPrisms',
      'readFile',
      'readFileAs',
      'writeFile',
      'writeFileAs',
      'deleteFile',
      'fileExists',
      'downloadFile',
      'listDirectory',
      'searchFiles',
      'setPermission',
      'hasPermission',
      'createSnapshot',
      'deleteSnapshot',
      'listSnapshots',
      'snapshotDiff',
      'backupPrism',
      'restorePrism',
      'watchPath',
      'unwatchPath',
      'onFileChanged',
      'getMetadata',
      'setMetadata',
      'getAllMetadata',
      'setDebugLogging',
    ];

    for (const opcode of expected) {
      assert.ok(opcodes.includes(opcode), `missing opcode: ${opcode}`);
    }
  });

  it('has prismType, readFormat, and permission menus', () => {
    const { menus } = extension.getInfo();
    assert.ok(menus.prismType, 'missing menu: prismType');
    assert.ok(menus.readFormat, 'missing menu: readFormat');
    assert.ok(menus.permission, 'missing menu: permission');
  });
});

// ─── Prism management blocks ──────────────────────────────────────────────────

describe('PrismFSExtension — prism management', () => {
  it('default prisms fs and tmp are mounted at startup', () => {
    assert.ok(extension.isPrismMounted({ NAME: 'fs' }));
    assert.ok(extension.isPrismMounted({ NAME: 'tmp' }));
  });

  it('mountPrism mounts a new prism', () => {
    extension.mountPrism({ NAME: 'docs', TYPE: 'prism' });
    assert.ok(extension.isPrismMounted({ NAME: 'docs' }));
  });

  it('unmountPrism removes a prism', () => {
    extension.mountPrism({ NAME: 'tounmount', TYPE: 'prism' });
    extension.unmountPrism({ NAME: 'tounmount' });
    assert.equal(extension.isPrismMounted({ NAME: 'tounmount' }), false);
  });

  it('prismType returns the type of a mounted prism', () => {
    assert.equal(extension.prismType({ NAME: 'fs' }), 'prism');
    assert.equal(extension.prismType({ NAME: 'tmp' }), 'temporary');
  });

  it('prismType returns an error for an unknown prism', () => {
    const result = extension.prismType({ NAME: 'nonexistent' });
    assert.ok(result.startsWith('ERR'));
  });

  it('listPrisms returns a JSON array containing default prisms', () => {
    const prisms = JSON.parse(extension.listPrisms());
    assert.ok(Array.isArray(prisms));
    assert.ok(prisms.includes('fs'));
    assert.ok(prisms.includes('tmp'));
  });

  it('mountPrism returns an error when trying to use a reserved name', () => {
    const result = extension.mountPrism({ NAME: 'prismsnap', TYPE: 'prism' });
    assert.ok(result.startsWith('ERR'));
  });
});

// ─── File operation blocks ────────────────────────────────────────────────────

describe('PrismFSExtension — file operations', () => {
  it('writeFile and readFile round-trip', () => {
    extension.writeFile({ URI: 'fs://hello.txt', CONTENT: 'Hello, PrismFS!' });
    assert.equal(extension.readFile({ URI: 'fs://hello.txt' }), 'Hello, PrismFS!');
  });

  it('fileExists returns true for a written file', () => {
    extension.writeFile({ URI: 'fs://exists.txt', CONTENT: 'data' });
    assert.ok(extension.fileExists({ URI: 'fs://exists.txt' }));
  });

  it('fileExists returns false for a non-existent file', () => {
    assert.equal(extension.fileExists({ URI: 'fs://no-such-file.txt' }), false);
  });

  it('readFile returns an error for a non-existent file', () => {
    const result = extension.readFile({ URI: 'fs://missing.txt' });
    assert.ok(result.startsWith('ERR'));
  });

  it('readFile returns an error for an invalid URI', () => {
    const result = extension.readFile({ URI: 'not-a-uri' });
    assert.ok(result.startsWith('ERR'));
  });

  it('readFile returns an error for an unmounted prism', () => {
    const result = extension.readFile({ URI: 'nowhere://file.txt' });
    assert.ok(result.startsWith('ERR'));
  });

  it('deleteFile removes a file', () => {
    extension.writeFile({ URI: 'fs://todelete.txt', CONTENT: 'bye' });
    extension.deleteFile({ URI: 'fs://todelete.txt' });
    assert.equal(extension.fileExists({ URI: 'fs://todelete.txt' }), false);
  });

  it('readFileAs text returns plain content', () => {
    extension.writeFile({ URI: 'fs://fmt.txt', CONTENT: 'abc' });
    assert.equal(extension.readFileAs({ URI: 'fs://fmt.txt', FORMAT: 'text' }), 'abc');
  });
});

// ─── Directory operation blocks ───────────────────────────────────────────────

describe('PrismFSExtension — directory operations', () => {
  it('listDirectory returns JSON array of files in a prism', () => {
    extension.writeFile({ URI: 'fs://dir/a.txt', CONTENT: 'a' });
    extension.writeFile({ URI: 'fs://dir/b.txt', CONTENT: 'b' });
    const files = JSON.parse(extension.listDirectory({ URI: 'fs://' }));
    assert.ok(Array.isArray(files));
    assert.ok(files.some(f => f.includes('a.txt')));
  });

  it('searchFiles filters by wildcard pattern', () => {
    extension.writeFile({ URI: 'fs://search/notes.txt', CONTENT: 'n' });
    extension.writeFile({ URI: 'fs://search/image.png', CONTENT: 'i' });
    const results = JSON.parse(extension.searchFiles({ URI: 'fs://', PATTERN: '*.txt' }));
    assert.ok(results.every(r => r.endsWith('.txt')));
  });
});

// ─── Permission blocks ────────────────────────────────────────────────────────

describe('PrismFSExtension — permissions', () => {
  it('hasPermission returns true for default permissions', () => {
    extension.mountPrism({ NAME: 'permtest', TYPE: 'prism' });
    assert.ok(extension.hasPermission({ URI: 'permtest://file.txt', PERM: 'read' }));
    assert.ok(extension.hasPermission({ URI: 'permtest://file.txt', PERM: 'write' }));
  });
});

// ─── Snapshot blocks ──────────────────────────────────────────────────────────

describe('PrismFSExtension — snapshots', () => {
  it('createSnapshot and listSnapshots round-trip', () => {
    extension.mountPrism({ NAME: 'snaptest', TYPE: 'prism' });
    extension.writeFile({ URI: 'snaptest://data.txt', CONTENT: 'v1' });
    extension.createSnapshot({ PRISM: 'snaptest', NAME: 'v1-snap' });

    const list = JSON.parse(extension.listSnapshots({ PRISM: 'snaptest' }));
    assert.ok(Array.isArray(list));
    assert.ok(list.some(s => s.name === 'v1-snap'));
  });

  it('deleteSnapshot removes a snapshot', () => {
    extension.mountPrism({ NAME: 'snapdel', TYPE: 'prism' });
    extension.createSnapshot({ PRISM: 'snapdel', NAME: 'snap1' });
    extension.deleteSnapshot({ PRISM: 'snapdel', NAME: 'snap1' });
    const list = JSON.parse(extension.listSnapshots({ PRISM: 'snapdel' }));
    assert.equal(list.length, 0);
  });

  it('snapshotDiff reports added, removed, modified', () => {
    extension.mountPrism({ NAME: 'difftest', TYPE: 'prism' });
    extension.writeFile({ URI: 'difftest://a.txt', CONTENT: 'old' });
    extension.createSnapshot({ PRISM: 'difftest', NAME: 'snap-a' });
    extension.writeFile({ URI: 'difftest://a.txt', CONTENT: 'new' });
    extension.writeFile({ URI: 'difftest://b.txt', CONTENT: 'added' });
    extension.createSnapshot({ PRISM: 'difftest', NAME: 'snap-b' });

    const diff = JSON.parse(
      extension.snapshotDiff({ PRISM: 'difftest', S1: 'snap-a', S2: 'snap-b' })
    );
    assert.ok(Array.isArray(diff.added));
    assert.ok(Array.isArray(diff.removed));
    assert.ok(Array.isArray(diff.modified));
    assert.ok(diff.added.includes('b.txt'));
    assert.ok(diff.modified.includes('a.txt'));
  });
});

// ─── Backup & restore blocks ──────────────────────────────────────────────────

describe('PrismFSExtension — backup & restore', () => {
  it('backupPrism returns valid JSON', () => {
    extension.mountPrism({ NAME: 'backuptest', TYPE: 'prism' });
    extension.writeFile({ URI: 'backuptest://note.txt', CONTENT: 'important' });
    const json = extension.backupPrism({ NAME: 'backuptest' });
    const obj = JSON.parse(json);
    assert.equal(obj.name, 'backuptest');
    assert.ok(obj.files['note.txt']);
  });

  it('restorePrism recreates the prism with its files', () => {
    extension.mountPrism({ NAME: 'restorefrom', TYPE: 'prism' });
    extension.writeFile({ URI: 'restorefrom://doc.txt', CONTENT: 'restored content' });
    const backup = extension.backupPrism({ NAME: 'restorefrom' });

    extension.unmountPrism({ NAME: 'restorefrom' });
    assert.equal(extension.isPrismMounted({ NAME: 'restorefrom' }), false);

    extension.restorePrism({ DATA: backup });
    assert.ok(extension.isPrismMounted({ NAME: 'restorefrom' }));
    assert.equal(extension.readFile({ URI: 'restorefrom://doc.txt' }), 'restored content');
  });
});

// ─── File watching blocks ─────────────────────────────────────────────────────

describe('PrismFSExtension — file watching', () => {
  it('watchPath returns a UUID string', () => {
    const uuid = extension.watchPath({ PATTERN: 'fs://**' });
    assert.equal(typeof uuid, 'string');
    assert.ok(uuid.length > 0);
    assert.ok(!uuid.startsWith('ERR'));
  });

  it('unwatchPath removes the watcher without error', () => {
    const uuid = extension.watchPath({ PATTERN: 'fs://watched.txt' });
    extension.unwatchPath({ UUID: uuid });
    // Confirm the watcher is gone: onFileChanged should return false.
    assert.equal(extension.onFileChanged({ UUID: uuid }), false);
  });
});

// ─── Metadata blocks ──────────────────────────────────────────────────────────

describe('PrismFSExtension — metadata', () => {
  it('setMetadata and getMetadata round-trip', () => {
    extension.writeFile({ URI: 'fs://meta.txt', CONTENT: 'content' });
    extension.setMetadata({ URI: 'fs://meta.txt', TAG: 'author', VALUE: 'Alice' });
    assert.equal(extension.getMetadata({ URI: 'fs://meta.txt', TAG: 'author' }), 'Alice');
  });

  it('getAllMetadata returns a JSON object', () => {
    extension.writeFile({ URI: 'fs://allmetadata.txt', CONTENT: 'x' });
    extension.setMetadata({ URI: 'fs://allmetadata.txt', TAG: 'genre', VALUE: 'fiction' });
    const obj = JSON.parse(extension.getAllMetadata({ URI: 'fs://allmetadata.txt' }));
    assert.equal(obj.genre, 'fiction');
  });

  it('createdAt is set automatically on first write', () => {
    extension.writeFile({ URI: 'fs://newfile-meta.txt', CONTENT: 'v1' });
    const created = extension.getMetadata({ URI: 'fs://newfile-meta.txt', TAG: 'createdAt' });
    assert.ok(created.length > 0, 'createdAt should be populated');
  });

  it('createdAt is preserved on subsequent writes', () => {
    extension.writeFile({ URI: 'fs://preserve-meta.txt', CONTENT: 'v1' });
    const created1 = extension.getMetadata({ URI: 'fs://preserve-meta.txt', TAG: 'createdAt' });
    extension.writeFile({ URI: 'fs://preserve-meta.txt', CONTENT: 'v2' });
    const created2 = extension.getMetadata({ URI: 'fs://preserve-meta.txt', TAG: 'createdAt' });
    assert.equal(created1, created2, 'createdAt should not change on update');
  });
});

// ─── writeFileAs ──────────────────────────────────────────────────────────────

describe('PrismFSExtension — writeFileAs', () => {
  it('decodes base64 content before writing', () => {
    // "hello" in base64
    extension.writeFileAs({ URI: 'fs://b64.txt', CONTENT: 'aGVsbG8=', FORMAT: 'base64' });
    assert.equal(extension.readFile({ URI: 'fs://b64.txt' }), 'hello');
  });

  it('decodes data: URI content before writing', () => {
    // "hi" in data URI
    extension.writeFileAs({
      URI: 'fs://datauri.txt',
      CONTENT: 'data:text/plain;base64,aGk=',
      FORMAT: 'datauri',
    });
    assert.equal(extension.readFile({ URI: 'fs://datauri.txt' }), 'hi');
  });

  it('writes text content unchanged when format is text', () => {
    extension.writeFileAs({ URI: 'fs://rawtext.txt', CONTENT: 'plain', FORMAT: 'text' });
    assert.equal(extension.readFile({ URI: 'fs://rawtext.txt' }), 'plain');
  });
});

// ─── onFileChanged hat block (edge-triggered) ─────────────────────────────────

describe('PrismFSExtension — onFileChanged hat', () => {
  it('returns false when nothing has been written', () => {
    const uuid = extension.watchPath({ PATTERN: 'fs://hat-test.txt' });
    assert.equal(extension.onFileChanged({ UUID: uuid }), false);
  });

  it('returns true once after a write, then false on the next poll', () => {
    const uuid = extension.watchPath({ PATTERN: 'fs://hat-fire.txt' });
    extension.writeFile({ URI: 'fs://hat-fire.txt', CONTENT: 'data' });
    assert.equal(extension.onFileChanged({ UUID: uuid }), true, 'should fire after write');
    assert.equal(extension.onFileChanged({ UUID: uuid }), false, 'should not fire again');
  });

  it('fires once per write event', async () => {
    const uuid = extension.watchPath({ PATTERN: 'fs://hat-multi.txt' });
    extension.writeFile({ URI: 'fs://hat-multi.txt', CONTENT: '1' });
    assert.equal(extension.onFileChanged({ UUID: uuid }), true);
    assert.equal(extension.onFileChanged({ UUID: uuid }), false);
    // Allow the queueMicrotask suppression-window cleanup to run before
    // making the second write so the watcher isn't suppressed.
    await new Promise(resolve => setImmediate(resolve));
    extension.writeFile({ URI: 'fs://hat-multi.txt', CONTENT: '2' });
    assert.equal(
      extension.onFileChanged({ UUID: uuid }),
      true,
      'should fire again after second write'
    );
    assert.equal(extension.onFileChanged({ UUID: uuid }), false);
  });
});
