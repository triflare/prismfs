/**
 * Unit tests for src/03-prisms.js (PrismRegistry)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismRegistry } from '../src/03-prisms.js';
import { PRISM_TYPE } from '../src/02-fs-utils.js';

// ─── Default prisms ───────────────────────────────────────────────────────────

describe('PrismRegistry — defaults', () => {
  it('mounts fs (prism) and tmp (temporary) by default', () => {
    const reg = new PrismRegistry();
    assert.ok(reg.isMounted('fs'));
    assert.ok(reg.isMounted('tmp'));
    assert.equal(reg.typeOf('fs'), PRISM_TYPE.PRISM);
    assert.equal(reg.typeOf('tmp'), PRISM_TYPE.TEMPORARY);
  });

  it('list() contains both default prisms', () => {
    const reg = new PrismRegistry();
    const list = reg.list();
    assert.ok(list.includes('fs'));
    assert.ok(list.includes('tmp'));
  });
});

// ─── mount() ─────────────────────────────────────────────────────────────────

describe('PrismRegistry — mount()', () => {
  it('mounts a new prism successfully', () => {
    const reg = new PrismRegistry();
    const err = reg.mount('docs', PRISM_TYPE.PRISM);
    assert.equal(err, '');
    assert.ok(reg.isMounted('docs'));
  });

  it('is case-insensitive for prism names', () => {
    const reg = new PrismRegistry();
    reg.mount('MyPrism', PRISM_TYPE.PRISM);
    assert.ok(reg.isMounted('myprism'));
  });

  it('returns an error when mounting a duplicate prism', () => {
    const reg = new PrismRegistry();
    reg.mount('dup', PRISM_TYPE.PRISM);
    const err = reg.mount('dup', PRISM_TYPE.PRISM);
    assert.ok(err.startsWith('ERR'));
  });

  it('returns an error for reserved prism names', () => {
    const reg = new PrismRegistry();
    assert.ok(reg.mount('prismsnap', PRISM_TYPE.PRISM).startsWith('ERR'));
    assert.ok(reg.mount('prismfs', PRISM_TYPE.PRISM).startsWith('ERR'));
  });

  it('returns an error for an unknown prism type', () => {
    const reg = new PrismRegistry();
    assert.ok(reg.mount('test', 'invalid-type').startsWith('ERR'));
  });
});

// ─── unmount() ───────────────────────────────────────────────────────────────

describe('PrismRegistry — unmount()', () => {
  it('unmounts a mounted prism', () => {
    const reg = new PrismRegistry();
    reg.mount('tounmount', PRISM_TYPE.PRISM);
    const err = reg.unmount('tounmount');
    assert.equal(err, '');
    assert.equal(reg.isMounted('tounmount'), false);
  });

  it('returns an error when unmounting a non-existent prism', () => {
    const reg = new PrismRegistry();
    assert.ok(reg.unmount('ghost').startsWith('ERR'));
  });

  it('returns an error when unmounting reserved prisms', () => {
    const reg = new PrismRegistry();
    assert.ok(reg.unmount('prismsnap').startsWith('ERR'));
  });
});

// ─── cleanupTemporary() ──────────────────────────────────────────────────────

describe('PrismRegistry — cleanupTemporary()', () => {
  it('removes temporary prisms and keeps normal ones', () => {
    const reg = new PrismRegistry();
    reg.mount('persist', PRISM_TYPE.PRISM);
    reg.mount('cache', PRISM_TYPE.TEMPORARY);
    reg.cleanupTemporary();

    assert.ok(reg.isMounted('persist'));
    assert.equal(reg.isMounted('cache'), false);
    assert.equal(reg.isMounted('tmp'), false); // default tmp removed too
  });
});

// ─── In-memory file operations ────────────────────────────────────────────────

describe('PrismRegistry — file operations', () => {
  it('writeFile and readFile round-trip', () => {
    const reg = new PrismRegistry();
    reg.writeFile('fs', 'hello.txt', 'world');
    assert.equal(reg.readFile('fs', 'hello.txt'), 'world');
  });

  it('readFile returns an error for a missing file', () => {
    const reg = new PrismRegistry();
    assert.ok(reg.readFile('fs', 'nope.txt').startsWith('ERR'));
  });

  it('fileExists returns true after a write', () => {
    const reg = new PrismRegistry();
    reg.writeFile('fs', 'test.txt', 'content');
    assert.ok(reg.fileExists('fs', 'test.txt'));
  });

  it('fileExists returns false for an unmounted prism', () => {
    const reg = new PrismRegistry();
    assert.equal(reg.fileExists('nowhere', 'file.txt'), false);
  });

  it('deleteFile removes the file', () => {
    const reg = new PrismRegistry();
    reg.writeFile('fs', 'del.txt', 'bye');
    const err = reg.deleteFile('fs', 'del.txt');
    assert.equal(err, '');
    assert.equal(reg.fileExists('fs', 'del.txt'), false);
  });

  it('deleteFile returns an error for a missing file', () => {
    const reg = new PrismRegistry();
    assert.ok(reg.deleteFile('fs', 'ghost.txt').startsWith('ERR'));
  });

  it('writeFile to an immutable prism returns an error', () => {
    const reg = new PrismRegistry();
    reg.mount('frozen', PRISM_TYPE.IMMUTABLE);
    assert.ok(reg.writeFile('frozen', 'file.txt', 'data').startsWith('ERR'));
  });

  it('deleteFile on an immutable prism returns an error', () => {
    const reg = new PrismRegistry();
    reg.mount('frozen2', PRISM_TYPE.IMMUTABLE);
    // Pre-seed: write directly via internal Map trick is impossible on immutable;
    // instead just verify the error on delete.
    assert.ok(reg.deleteFile('frozen2', 'file.txt').startsWith('ERR'));
  });

  it('listFiles returns all files in a prism', () => {
    const reg = new PrismRegistry();
    reg.writeFile('fs', 'a.txt', 'a');
    reg.writeFile('fs', 'b.txt', 'b');
    const list = reg.listFiles('fs');
    assert.ok(Array.isArray(list));
    assert.ok(list.includes('a.txt'));
    assert.ok(list.includes('b.txt'));
  });

  it('listFiles with dirPath prefix filters results', () => {
    const reg = new PrismRegistry();
    reg.writeFile('fs', 'docs/readme.txt', 'r');
    reg.writeFile('fs', 'src/main.js', 'm');
    const list = reg.listFiles('fs', 'docs');
    assert.ok(list.includes('docs/readme.txt'));
    assert.equal(list.includes('src/main.js'), false);
  });

  it('snapshotFiles returns a copy of the file map', () => {
    const reg = new PrismRegistry();
    reg.writeFile('fs', 'snap.txt', 'snap');
    const copy = reg.snapshotFiles('fs');
    assert.ok(copy instanceof Map);
    assert.ok(copy.has('snap.txt'));
    // Mutating the copy should not affect the original.
    copy.delete('snap.txt');
    assert.ok(reg.fileExists('fs', 'snap.txt'));
  });
});

// ─── writeFile limits ─────────────────────────────────────────────────────────

describe('PrismRegistry — writeFile limits', () => {
  it('enforces MAX_FILES_PER_PRISM', async () => {
    const { MAX_FILES_PER_PRISM } = await import('../src/02-fs-utils.js');
    const reg = new PrismRegistry();
    reg.mount('limitedprism', PRISM_TYPE.PRISM);

    for (let i = 0; i < MAX_FILES_PER_PRISM; i++) {
      reg.writeFile('limitedprism', `file-${i}.txt`, 'data');
    }

    const err = reg.writeFile('limitedprism', 'overflow.txt', 'data');
    assert.ok(err.startsWith('ERR'), 'should return error when file count is exceeded');
    assert.ok(
      err.includes('LIMIT') || err.includes('limit') || err.includes('maximum'),
      `expected limit error, got: ${err}`
    );
  });

  it('updating an existing file does not count as a new file', () => {
    const reg = new PrismRegistry();
    reg.writeFile('fs', 'update.txt', 'v1');
    const err = reg.writeFile('fs', 'update.txt', 'v2');
    assert.equal(err, '', 'updating an existing file should always succeed');
  });
});
