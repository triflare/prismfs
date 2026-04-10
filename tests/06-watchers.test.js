/**
 * Unit tests for src/06-watchers.js (WatcherManager)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WatcherManager } from '../src/06-watchers.js';
import { MAX_WATCHERS } from '../src/02-fs-utils.js';

describe('WatcherManager — register()', () => {
  it('returns a non-empty UUID string', () => {
    const mgr = new WatcherManager();
    const uuid = mgr.register('fs://**', 'SpriteA');
    assert.equal(typeof uuid, 'string');
    assert.ok(uuid.length > 0);
    assert.ok(!uuid.startsWith('ERR'));
  });

  it('each registration returns a unique UUID', () => {
    const mgr = new WatcherManager();
    const uuids = new Set();
    for (let i = 0; i < 10; i++) uuids.add(mgr.register('fs://**', 'SpriteA'));
    assert.equal(uuids.size, 10);
  });

  it(`returns an error when the ${MAX_WATCHERS}-watcher limit is reached`, () => {
    const mgr = new WatcherManager();
    for (let i = 0; i < MAX_WATCHERS; i++) mgr.register(`fs://file${i}.txt`, 'Sprite');
    const err = mgr.register('fs://overflow.txt', 'Sprite');
    assert.ok(err.startsWith('ERR'));
  });
});

describe('WatcherManager — unregister()', () => {
  it('removes a watcher by UUID', () => {
    const mgr = new WatcherManager();
    const uuid = mgr.register('fs://**', 'SpriteA');
    const err = mgr.unregister(uuid);
    assert.equal(err, '');
    assert.equal(mgr.size, 0);
  });

  it('returns an error for an unknown UUID', () => {
    const mgr = new WatcherManager();
    assert.ok(mgr.unregister('fake-uuid').startsWith('ERR'));
  });
});

describe('WatcherManager — getMatching()', () => {
  it('returns watchers whose pattern matches the URI', () => {
    const mgr = new WatcherManager();
    mgr.register('fs://**', 'SpriteA');
    mgr.register('docs://**', 'SpriteB');
    const matches = mgr.getMatching('fs://notes.txt');
    assert.equal(matches.length, 1);
    assert.equal(matches[0].sprite, 'SpriteA');
  });

  it('returns an empty array when nothing matches', () => {
    const mgr = new WatcherManager();
    mgr.register('docs://**', 'SpriteB');
    assert.deepEqual(mgr.getMatching('fs://unrelated.txt'), []);
  });

  it('sorts matching watchers by sprite name (case-insensitive)', () => {
    const mgr = new WatcherManager();
    mgr.register('fs://**', 'ZebraSprite');
    mgr.register('fs://**', 'AlphaSprite');
    mgr.register('fs://**', 'MidSprite');
    const matches = mgr.getMatching('fs://file.txt');
    const names = matches.map(w => w.sprite);
    assert.deepEqual(names, ['AlphaSprite', 'MidSprite', 'ZebraSprite']);
  });
});

describe('WatcherManager — list() and size', () => {
  it('list() returns all registered watchers', () => {
    const mgr = new WatcherManager();
    mgr.register('fs://**', 'A');
    mgr.register('tmp://**', 'B');
    assert.equal(mgr.list().length, 2);
  });

  it('size reflects the current count', () => {
    const mgr = new WatcherManager();
    assert.equal(mgr.size, 0);
    const uuid = mgr.register('fs://**', 'A');
    assert.equal(mgr.size, 1);
    mgr.unregister(uuid);
    assert.equal(mgr.size, 0);
  });
});
