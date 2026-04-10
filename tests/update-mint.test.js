import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  detectAutoPathAliases,
  getMintToolingVersion,
  hasToolingPackageUpdates,
  isMintVersionUpToDate,
  mergePackageJson,
  parseMintIgnore,
  parseUpdateArgs,
  resolveCheckoutPaths,
  shouldIgnorePath,
} from '../scripts/update-mint.js';

const TEMP_DIR_PREFIX = 'mint-update-test-';

describe('parseUpdateArgs()', () => {
  it('returns defaults when no args are provided', () => {
    assert.deepEqual(parseUpdateArgs([]), {
      remote: 'https://github.com/triflare/mint-tooling.git',
      ref: 'main',
      dryRun: false,
    });
  });

  it('parses explicit flags', () => {
    assert.deepEqual(parseUpdateArgs(['--dry-run', '--remote', 'origin', '--ref', 'v2.0.5']), {
      remote: 'origin',
      ref: 'v2.0.5',
      dryRun: true,
    });
  });

  it('throws on unknown args', () => {
    assert.throws(() => parseUpdateArgs(['--unknown']), /Unknown argument/);
  });

  it('throws when --remote/--ref values are missing or are another flag', () => {
    assert.throws(() => parseUpdateArgs(['--remote']), /--remote requires a value/);
    assert.throws(
      () => parseUpdateArgs(['--remote', '--ref', 'main']),
      /--remote requires a value/
    );
    assert.throws(() => parseUpdateArgs(['--remote', '-u']), /--remote requires a value/);
    assert.throws(() => parseUpdateArgs(['--ref']), /--ref requires a value/);
    assert.throws(() => parseUpdateArgs(['--ref', '--dry-run']), /--ref requires a value/);
    assert.throws(() => parseUpdateArgs(['--ref', '-n']), /--ref requires a value/);
  });
});

describe('mergePackageJson()', () => {
  it('updates tooling fields while preserving project-specific metadata', () => {
    const currentPackageJson = {
      name: 'my-extension',
      version: '0.1.0',
      description: 'My extension',
      scripts: {
        custom: 'echo custom',
        build: 'old build',
      },
      devDependencies: {
        eslint: '^8.0.0',
        customTool: '^1.0.0',
      },
      dependencies: {
        leftpad: '^1.0.0',
      },
    };
    const upstreamPackageJson = {
      type: 'module',
      main: 'build/extension.js',
      scripts: {
        build: 'node scripts/build.js',
        test: 'node scripts/test.js',
      },
      devDependencies: {
        eslint: '^10.2.0',
        prettier: '^3.0.0',
      },
    };

    assert.deepEqual(mergePackageJson(currentPackageJson, upstreamPackageJson), {
      name: 'my-extension',
      version: '0.1.0',
      description: 'My extension',
      type: 'module',
      main: 'build/extension.js',
      scripts: {
        custom: 'echo custom',
        build: 'node scripts/build.js',
        test: 'node scripts/test.js',
      },
      devDependencies: {
        eslint: '^10.2.0',
        customTool: '^1.0.0',
        prettier: '^3.0.0',
      },
      dependencies: {
        leftpad: '^1.0.0',
      },
    });
  });

  it('does not remove existing type/main when upstream omits them', () => {
    const currentPackageJson = {
      type: 'module',
      main: 'build/extension.js',
    };
    const upstreamPackageJson = {
      scripts: {
        test: 'node scripts/test.js',
      },
    };

    assert.deepEqual(mergePackageJson(currentPackageJson, upstreamPackageJson), {
      type: 'module',
      main: 'build/extension.js',
      scripts: {
        test: 'node scripts/test.js',
      },
      devDependencies: {},
    });
  });
});

describe('mint tooling version detection', () => {
  it('reads Mint version from package name/version when this repo is Mint', () => {
    assert.equal(
      getMintToolingVersion({ name: '@triflare/mint-tooling', version: '2.0.5' }),
      '2.0.5'
    );
  });

  it('reads Mint version from dependency fields in consumer repos', () => {
    assert.equal(
      getMintToolingVersion({ devDependencies: { '@triflare/mint-tooling': '^2.0.5' } }),
      '^2.0.5'
    );
  });

  it('detects up-to-date Mint version when semver prefixes differ', () => {
    const local = { devDependencies: { '@triflare/mint-tooling': '^2.0.5' } };
    const upstream = { name: '@triflare/mint-tooling', version: '2.0.5' };
    assert.equal(isMintVersionUpToDate(local, upstream), true);
  });

  it('returns false when Mint version cannot be matched', () => {
    const local = { name: 'my-extension', version: '1.0.0' };
    const upstream = { name: '@triflare/mint-tooling', version: '2.0.5' };
    assert.equal(isMintVersionUpToDate(local, upstream), false);
  });
});

describe('hasToolingPackageUpdates()', () => {
  it('detects no updates when tooling fields are unchanged', () => {
    const current = {
      type: 'module',
      main: 'build/extension.js',
      scripts: { build: 'node scripts/build.js' },
      devDependencies: { eslint: '^10.2.0' },
    };
    assert.equal(hasToolingPackageUpdates(current, structuredClone(current)), false);
  });

  it('detects changes in tooling fields only', () => {
    const current = {
      type: 'module',
      main: 'build/extension.js',
      scripts: { build: 'old' },
      devDependencies: { eslint: '^8.0.0' },
      name: 'extension',
    };
    const merged = {
      ...current,
      scripts: { build: 'node scripts/build.js' },
      devDependencies: { eslint: '^10.2.0' },
    };
    assert.equal(hasToolingPackageUpdates(current, merged), true);
  });
});

describe('mint ignore and path resolution', () => {
  it('parses .mintignore content and ignores comments/blank lines', () => {
    assert.deepEqual(parseMintIgnore('\n# comment\nscripts\n\ndocs/mint-tooling\n'), [
      'scripts',
      'docs/mint-tooling',
    ]);
  });

  it('matches exact and nested path ignore rules', () => {
    const ignorePatterns = ['scripts', 'docs/mint-tooling'];
    assert.equal(shouldIgnorePath('scripts', ignorePatterns), true);
    assert.equal(shouldIgnorePath('scripts/build.js', ignorePatterns), true);
    assert.equal(shouldIgnorePath('docs/mint-tooling/updating.md', ignorePatterns), true);
    assert.equal(shouldIgnorePath('templates', ignorePatterns), false);
  });

  it('resolves unique checkout paths and applies ignore rules', () => {
    assert.deepEqual(resolveCheckoutPaths(['scripts', 'scripts', 'templates'], ['scripts']), [
      'templates',
    ]);
  });

  it('rejects traversal paths after normalization', () => {
    assert.throws(
      () => resolveCheckoutPaths(['foo/./../../bar'], []),
      /must stay inside the repository/
    );
  });
});

describe('detectAutoPathAliases()', () => {
  it('maps docs to documentation when docs is missing but documentation exists', async () => {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX));
    const documentationPath = path.join(root, 'documentation', 'mint-tooling');
    await fsPromises.mkdir(documentationPath, { recursive: true });
    try {
      const aliases = await detectAutoPathAliases(root, ['docs/mint-tooling', 'scripts']);
      assert.deepEqual(aliases, {
        'docs/mint-tooling': 'documentation/mint-tooling',
      });
    } finally {
      try {
        await fsPromises.rm(root, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Failed to cleanup temp directory ${root}:`, error);
      }
    }
  });

  it('returns no aliases when documentation fallback does not exist', async () => {
    const root = await fsPromises.mkdtemp(path.join(os.tmpdir(), TEMP_DIR_PREFIX));
    try {
      const aliases = await detectAutoPathAliases(root, ['docs/mint-tooling', 'scripts']);
      assert.deepEqual(aliases, {});
    } finally {
      try {
        await fsPromises.rm(root, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Failed to cleanup temp directory ${root}:`, error);
      }
    }
  });
});
