/**
 * Unit tests for src/04-permissions.js (PermissionStore)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionStore, PERMISSION } from '../src/04-permissions.js';

describe('PermissionStore — defaults', () => {
  it('grants all four permissions by default', () => {
    const store = new PermissionStore();
    for (const perm of Object.values(PERMISSION)) {
      assert.ok(store.has('some/path', perm), `should have "${perm}" by default`);
    }
  });
});

describe('PermissionStore — set() and has()', () => {
  it('restricts permissions when explicitly set', () => {
    const store = new PermissionStore();
    store.set('docs', [PERMISSION.SEE, PERMISSION.READ]);
    assert.ok(store.has('docs', PERMISSION.SEE));
    assert.ok(store.has('docs', PERMISSION.READ));
    assert.equal(store.has('docs', PERMISSION.WRITE), false);
    assert.equal(store.has('docs', PERMISSION.MANAGE), false);
  });

  it('returns an error for an unknown permission', () => {
    const store = new PermissionStore();
    const err = store.set('path', ['invalid-perm']);
    assert.ok(err.startsWith('ERR'));
  });

  it('replacing permissions with an empty set denies all', () => {
    const store = new PermissionStore();
    store.set('locked', []);
    for (const perm of Object.values(PERMISSION)) {
      assert.equal(store.has('locked', perm), false);
    }
  });
});

describe('PermissionStore — cascading', () => {
  it('child path inherits parent permissions', () => {
    const store = new PermissionStore();
    store.set('docs', [PERMISSION.SEE, PERMISSION.READ]);

    assert.ok(store.has('docs/subdir', PERMISSION.SEE));
    assert.ok(store.has('docs/subdir', PERMISSION.READ));
    assert.equal(store.has('docs/subdir', PERMISSION.WRITE), false);
  });

  it('child-specific entry overrides parent', () => {
    const store = new PermissionStore();
    store.set('docs', [PERMISSION.SEE]); // parent: only see
    store.set('docs/public', [PERMISSION.SEE, PERMISSION.READ]); // child: see + read

    assert.ok(store.has('docs/public', PERMISSION.READ));
    assert.equal(store.has('docs/other', PERMISSION.READ), false);
  });

  it('prism-root entry (empty string key) applies to all paths', () => {
    const store = new PermissionStore();
    store.set('', [PERMISSION.SEE]);

    assert.ok(store.has('any/path', PERMISSION.SEE));
    assert.equal(store.has('any/path', PERMISSION.WRITE), false);
  });
});

describe('PermissionStore — reset()', () => {
  it('removes the explicit entry and falls back to default', () => {
    const store = new PermissionStore();
    store.set('restricted', [PERMISSION.SEE]);
    assert.equal(store.has('restricted', PERMISSION.WRITE), false);

    store.reset('restricted');
    // Now falls back to default (all permissions granted).
    assert.ok(store.has('restricted', PERMISSION.WRITE));
  });
});
