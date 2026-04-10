import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const buildScript = path.join(repoRoot, 'scripts', 'build.js');
const buildDir = path.join(repoRoot, 'build');

function readFileMaybe(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
}

function withBuildSnapshot(fn) {
  const tracked = [
    'extension.js',
    'extension.js.map',
    'min.extension.js',
    'min.extension.js.map',
    'pretty.extension.js',
    'pretty.extension.js.map',
    'BUILD_REPORT.md',
  ];
  const snapshot = new Map(tracked.map(name => [name, readFileMaybe(path.join(buildDir, name))]));
  try {
    fn();
  } finally {
    for (const [name, content] of snapshot.entries()) {
      const filePath = path.join(buildDir, name);
      if (content === null) {
        if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
      } else {
        fs.writeFileSync(filePath, content, 'utf8');
      }
    }
  }
}

function runBuild(args) {
  return spawnSync(process.execPath, [buildScript, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
  });
}

function collectSourcesFromMap(mapObject) {
  const direct = Array.isArray(mapObject.sources) ? mapObject.sources : [];
  const sectionSources = Array.isArray(mapObject.sections)
    ? mapObject.sections.flatMap(section => section?.map?.sources || [])
    : [];
  return [...direct, ...sectionSources];
}

describe('build sourcemap options', () => {
  it('generates external sourcemaps for all variants with --sourcemap', () => {
    withBuildSnapshot(() => {
      const res = runBuild(['--sourcemap']);
      assert.equal(res.status, 0, res.stderr || res.stdout);

      assert.ok(fs.existsSync(path.join(buildDir, 'extension.js.map')));
      assert.ok(fs.existsSync(path.join(buildDir, 'min.extension.js.map')));
      assert.ok(fs.existsSync(path.join(buildDir, 'pretty.extension.js.map')));

      const standardMap = JSON.parse(
        fs.readFileSync(path.join(buildDir, 'extension.js.map'), 'utf8')
      );
      const minMap = JSON.parse(
        fs.readFileSync(path.join(buildDir, 'min.extension.js.map'), 'utf8')
      );
      const prettyMap = JSON.parse(
        fs.readFileSync(path.join(buildDir, 'pretty.extension.js.map'), 'utf8')
      );

      assert.ok(
        collectSourcesFromMap(standardMap).some(source => source.startsWith('src/')),
        'extension.js.map should reference original src files'
      );
      assert.ok(
        collectSourcesFromMap(minMap).some(source => source.startsWith('src/')),
        'min.extension.js.map should reference original src files'
      );
      assert.ok(
        collectSourcesFromMap(prettyMap).some(source => source.startsWith('src/')),
        'pretty.extension.js.map should reference original src files'
      );

      const report = fs.readFileSync(path.join(buildDir, 'BUILD_REPORT.md'), 'utf8');
      assert.ok(report.includes('## Source Maps'));
      assert.ok(report.includes('**Enabled:** Yes'));
      assert.ok(report.includes('`extension.js.map`'));
      assert.ok(report.includes('`min.extension.js.map`'));
      assert.ok(report.includes('`pretty.extension.js.map`'));
    });
  });

  it('embeds inline sourcemaps with --inline-sourcemap', () => {
    withBuildSnapshot(() => {
      const res = runBuild(['--inline-sourcemap']);
      assert.equal(res.status, 0, res.stderr || res.stdout);

      assert.equal(fs.existsSync(path.join(buildDir, 'extension.js.map')), false);
      assert.equal(fs.existsSync(path.join(buildDir, 'min.extension.js.map')), false);
      assert.equal(fs.existsSync(path.join(buildDir, 'pretty.extension.js.map')), false);

      const standard = fs.readFileSync(path.join(buildDir, 'extension.js'), 'utf8');
      const minified = fs.readFileSync(path.join(buildDir, 'min.extension.js'), 'utf8');
      const pretty = fs.readFileSync(path.join(buildDir, 'pretty.extension.js'), 'utf8');
      assert.ok(standard.includes('sourceMappingURL=data:application/json'));
      assert.ok(minified.includes('sourceMappingURL=data:application/json'));
      assert.ok(pretty.includes('sourceMappingURL=data:application/json'));
      const report = fs.readFileSync(path.join(buildDir, 'BUILD_REPORT.md'), 'utf8');
      assert.ok(report.includes('**Enabled:** Yes'));
      assert.ok(report.includes('Inline'));
    });
  });
});
