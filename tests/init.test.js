import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  CORE_ID_PLACEHOLDER,
  resolveTemplateChoice,
  rewriteCoreMetadata,
  scaffoldTemplate,
} from '../scripts/init.js';

describe('resolveTemplateChoice()', () => {
  it('defaults to blank when selection is empty', () => {
    assert.equal(resolveTemplateChoice(''), 'blank');
  });

  it('accepts numeric choices', () => {
    assert.equal(resolveTemplateChoice('1'), 'blank');
    assert.equal(resolveTemplateChoice('3'), 'operators');
  });

  it('accepts template keys', () => {
    assert.equal(resolveTemplateChoice('looks'), 'looks');
    assert.equal(resolveTemplateChoice('data-storage'), 'data-storage');
  });

  it('throws on unknown templates', () => {
    assert.throws(() => resolveTemplateChoice('99'), /Unknown template/);
    assert.throws(() => resolveTemplateChoice('3abc'), /Unknown template/);
    assert.throws(() => resolveTemplateChoice('not-a-template'), /Unknown template/);
  });
});

describe('scaffoldTemplate()', () => {
  it('copies selected template src files into project src', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-init-test-'));
    const templatesSrc = path.join(root, 'templates', 'operators', 'src');
    const srcDir = path.join(root, 'src');

    fs.mkdirSync(templatesSrc, { recursive: true });
    fs.writeFileSync(path.join(templatesSrc, '01-core.js'), 'export const fromTemplate = true;\n');
    fs.writeFileSync(path.join(templatesSrc, '02-operators.js'), 'export const helper = true;\n');

    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'old.js'), 'old');

    try {
      await scaffoldTemplate('operators', root);
      assert.equal(fs.existsSync(path.join(srcDir, 'old.js')), false);
      assert.equal(fs.existsSync(path.join(srcDir, '01-core.js')), true);
      assert.equal(fs.existsSync(path.join(srcDir, '02-operators.js')), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('throws when template path does not exist', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-init-test-'));

    try {
      await assert.rejects(() => scaffoldTemplate('operators', root), /was not found/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('rewriteCoreMetadata()', () => {
  it('replaces core placeholder id and Scratch.translate display name', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mint-init-test-'));
    const srcDir = path.join(root, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, '01-core.js'),
      `export default { getInfo() { return { id: '${CORE_ID_PLACEHOLDER}', name: Scratch.translate('My Extension') }; } };\n`
    );

    try {
      await rewriteCoreMetadata({ id: 'customId', displayName: 'Custom Name' }, { cwd: root });
      const content = fs.readFileSync(path.join(srcDir, '01-core.js'), 'utf8');
      assert.match(content, /id:\s*"customId"/);
      assert.match(content, /name:\s*Scratch\.translate\("Custom Name"\)/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
