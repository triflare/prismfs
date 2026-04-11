/**
 * Unit tests for src/02-fs-utils.js
 *
 * All utilities are pure functions — no Scratch mock needed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUri,
  normalisePath,
  matchesPattern,
  formatError,
  isError,
  Errors,
  PRISM_TYPE,
  PERMISSION,
  RESERVED_PRISMS,
  MAX_FILES_PER_PRISM,
  MAX_PRISMS,
  MAX_SNAPSHOTS_PER_PRISM,
  MAX_WATCHERS,
} from '../src/02-fs-utils.js';

// ─── parseUri() ───────────────────────────────────────────────────────────────

describe('parseUri()', () => {
  it('parses a simple URI', () => {
    const result = parseUri('documents://path/to/file.txt');
    assert.deepEqual(result, { prism: 'documents', filePath: 'path/to/file.txt' });
  });

  it('lower-cases the prism name', () => {
    const result = parseUri('MyPrism://data.json');
    assert.equal(result.prism, 'myprism');
  });

  it('handles an empty path', () => {
    const result = parseUri('fs://');
    assert.deepEqual(result, { prism: 'fs', filePath: '' });
  });

  it('accepts hyphens and underscores in prism names', () => {
    const result = parseUri('my-prism_1://file.txt');
    assert.ok(result);
    assert.equal(result.prism, 'my-prism_1');
  });

  it('returns null for a non-URI string', () => {
    assert.equal(parseUri('not a uri'), null);
  });

  it('returns null for a URI missing the double slash', () => {
    assert.equal(parseUri('fs:/file.txt'), null);
  });

  it('returns null for a non-string argument', () => {
    assert.equal(parseUri(null), null);
    assert.equal(parseUri(42), null);
  });

  it('returns null when prism name starts with a digit', () => {
    assert.equal(parseUri('1prism://file.txt'), null);
  });
});

// ─── normalisePath() ─────────────────────────────────────────────────────────

describe('normalisePath()', () => {
  it('collapses repeated slashes', () => {
    assert.equal(normalisePath('a//b///c'), 'a/b/c');
  });

  it('strips trailing slash', () => {
    assert.equal(normalisePath('docs/'), 'docs');
  });

  it('preserves a simple path', () => {
    assert.equal(normalisePath('path/to/file.txt'), 'path/to/file.txt');
  });

  it('handles the empty string', () => {
    assert.equal(normalisePath(''), '');
  });
});

// ─── matchesPattern() ────────────────────────────────────────────────────────

describe('matchesPattern()', () => {
  it('matches an exact URI', () => {
    assert.ok(matchesPattern('fs://hello.txt', 'fs://hello.txt'));
  });

  it('does not match a different URI', () => {
    assert.equal(matchesPattern('fs://hello.txt', 'fs://world.txt'), false);
  });

  it('* matches within a single path segment', () => {
    assert.ok(matchesPattern('fs://*.txt', 'fs://notes.txt'));
    assert.equal(matchesPattern('fs://*.txt', 'fs://dir/notes.txt'), false);
  });

  it('** matches across path segments', () => {
    assert.ok(matchesPattern('fs://**', 'fs://dir/sub/file.txt'));
  });

  it('** matches a prism root', () => {
    assert.ok(matchesPattern('fs://**', 'fs://'));
  });

  it('handles mixed patterns', () => {
    assert.ok(matchesPattern('docs://**/*.md', 'docs://folder/README.md'));
    assert.equal(matchesPattern('docs://**/*.md', 'docs://folder/README.txt'), false);
  });
});

// ─── formatError() / isError() ───────────────────────────────────────────────

describe('formatError() and isError()', () => {
  it('formatError produces the correct structure', () => {
    assert.equal(formatError('NOTFOUND', 'file missing'), 'ERRNOTFOUND: file missing');
  });

  it('isError returns true for an ERR-prefixed string', () => {
    assert.ok(isError('ERRNOTFOUND: something'));
  });

  it('isError returns false for a normal string', () => {
    assert.equal(isError('hello'), false);
    assert.equal(isError(''), false);
  });

  it('isError returns false for non-strings', () => {
    assert.equal(isError(null), false);
    assert.equal(isError(42), false);
  });

  it('isError requires an uppercase letter after ERR (tight prefix)', () => {
    // Strings that START with "ERR" but not followed by an uppercase letter
    // should NOT be treated as errors (avoids false positives with file content).
    assert.equal(isError('ERR'), false, '"ERR" alone is not an error');
    assert.equal(isError('ERRored file content'), false, 'lowercase after ERR is not an error');
    assert.equal(isError('ERR1INVALID'), false, 'digit after ERR is not an error');
    // Properly formed errors SHOULD be detected.
    assert.ok(isError('ERRNOTFOUND: x'));
    assert.ok(isError('ERRPERMISSION: denied'));
  });
});

// ─── Errors namespace ────────────────────────────────────────────────────────

describe('Errors namespace', () => {
  it('each helper produces an ERR-prefixed string', () => {
    for (const [key, fn] of Object.entries(Errors)) {
      const result = fn('test message');
      assert.ok(result.startsWith('ERR'), `Errors.${key} should start with ERR`);
    }
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('PRISM_TYPE has the three expected values', () => {
    assert.equal(PRISM_TYPE.PRISM, 'prism');
    assert.equal(PRISM_TYPE.TEMPORARY, 'temporary');
    assert.equal(PRISM_TYPE.IMMUTABLE, 'immutable');
  });

  it('PERMISSION has the four expected values', () => {
    assert.equal(PERMISSION.SEE, 'see');
    assert.equal(PERMISSION.READ, 'read');
    assert.equal(PERMISSION.WRITE, 'write');
    assert.equal(PERMISSION.MANAGE, 'manage');
  });

  it('RESERVED_PRISMS contains prismsnap and prismfs', () => {
    assert.ok(RESERVED_PRISMS.has('prismsnap'));
    assert.ok(RESERVED_PRISMS.has('prismfs'));
  });

  it('limits are positive integers', () => {
    assert.ok(MAX_FILES_PER_PRISM > 0);
    assert.ok(MAX_PRISMS > 0);
    assert.ok(MAX_SNAPSHOTS_PER_PRISM > 0);
    assert.ok(MAX_WATCHERS > 0);
    assert.equal(MAX_FILES_PER_PRISM, 10_000);
    assert.equal(MAX_PRISMS, 50);
    assert.equal(MAX_SNAPSHOTS_PER_PRISM, 20);
    assert.equal(MAX_WATCHERS, 150);
  });
});
