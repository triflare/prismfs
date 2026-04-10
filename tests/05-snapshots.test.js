/**
 * Unit tests for src/05-snapshots.js (SnapshotManager)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotManager } from '../src/05-snapshots.js';
import { MAX_SNAPSHOTS_PER_PRISM } from '../src/02-fs-utils.js';

function makeFiles(entries = {}) {
  const m = new Map();
  for (const [k, v] of Object.entries(entries)) {
    m.set(k, { content: v, createdAt: 0, modifiedAt: 0 });
  }
  return m;
}

describe('SnapshotManager — create()', () => {
  it('creates a snapshot successfully', () => {
    const mgr = new SnapshotManager();
    const err = mgr.create('fs', 'snap1', makeFiles({ 'a.txt': 'hello' }));
    assert.equal(err, '');
  });

  it('returns an error for a duplicate snapshot name', () => {
    const mgr = new SnapshotManager();
    mgr.create('fs', 'snap1', makeFiles());
    const err = mgr.create('fs', 'snap1', makeFiles());
    assert.ok(err.startsWith('ERR'));
  });

  it(`returns an error when the ${MAX_SNAPSHOTS_PER_PRISM}-snapshot limit is reached`, () => {
    const mgr = new SnapshotManager();
    for (let i = 0; i < MAX_SNAPSHOTS_PER_PRISM; i++) {
      mgr.create('fs', `snap${i}`, makeFiles());
    }
    const err = mgr.create('fs', 'overflow', makeFiles());
    assert.ok(err.startsWith('ERR'));
  });
});

describe('SnapshotManager — list()', () => {
  it('returns an empty array when no snapshots exist', () => {
    const mgr = new SnapshotManager();
    assert.deepEqual(mgr.list('fs'), []);
  });

  it('returns snapshot descriptors in insertion order', () => {
    const mgr = new SnapshotManager();
    mgr.create('fs', 'alpha', makeFiles());
    mgr.create('fs', 'beta', makeFiles());
    const list = mgr.list('fs');
    assert.equal(list.length, 2);
    assert.equal(list[0].name, 'alpha');
    assert.equal(list[1].name, 'beta');
    assert.ok(typeof list[0].timestamp === 'number');
  });
});

describe('SnapshotManager — delete()', () => {
  it('deletes a snapshot successfully', () => {
    const mgr = new SnapshotManager();
    mgr.create('fs', 'snap1', makeFiles());
    const err = mgr.delete('fs', 'snap1');
    assert.equal(err, '');
    assert.equal(mgr.list('fs').length, 0);
  });

  it('returns an error when the prism has no snapshots', () => {
    const mgr = new SnapshotManager();
    assert.ok(mgr.delete('fs', 'nonexistent').startsWith('ERR'));
  });

  it('returns an error when the snapshot name does not exist', () => {
    const mgr = new SnapshotManager();
    mgr.create('fs', 'real', makeFiles());
    assert.ok(mgr.delete('fs', 'fake').startsWith('ERR'));
  });
});

describe('SnapshotManager.diff()', () => {
  it('detects added files', () => {
    const a = makeFiles({ 'old.txt': 'x' });
    const b = makeFiles({ 'old.txt': 'x', 'new.txt': 'y' });
    const { added } = SnapshotManager.diff(a, b);
    assert.deepEqual(added, ['new.txt']);
  });

  it('detects removed files', () => {
    const a = makeFiles({ 'old.txt': 'x', 'gone.txt': 'y' });
    const b = makeFiles({ 'old.txt': 'x' });
    const { removed } = SnapshotManager.diff(a, b);
    assert.deepEqual(removed, ['gone.txt']);
  });

  it('detects modified files', () => {
    const a = makeFiles({ 'file.txt': 'v1' });
    const b = makeFiles({ 'file.txt': 'v2' });
    const { modified } = SnapshotManager.diff(a, b);
    assert.deepEqual(modified, ['file.txt']);
  });

  it('returns empty arrays for identical maps', () => {
    const files = makeFiles({ 'same.txt': 'content' });
    const { added, removed, modified } = SnapshotManager.diff(files, new Map(files));
    assert.deepEqual(added, []);
    assert.deepEqual(removed, []);
    assert.deepEqual(modified, []);
  });
});
