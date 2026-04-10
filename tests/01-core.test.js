/**
 * Unit tests for src/01-core.js (TurboWarpExtension class)
 *
 * The Scratch global mock must be installed before the core module is imported,
 * because 01-core.js calls Scratch.extensions.register() at module load time.
 * The mock captures the registered instance so the class methods can be tested.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installScratchMock } from './helpers/mock-scratch.js';

// Install the mock and capture the registered extension instance.
const { mock } = installScratchMock();
let extension;
mock.extensions.register = instance => {
  extension = instance;
};

// Top-level await: load the core module so registration fires.
await import('../src/01-core.js');

describe('TurboWarpExtension — registration', () => {
  it('registers an extension instance with Scratch', () => {
    assert.ok(extension, 'Scratch.extensions.register should have been called');
  });
});

describe('TurboWarpExtension — helloWorld()', () => {
  it('returns "hello world!"', () => {
    assert.equal(extension.helloWorld(), 'hello world!');
  });
});

describe('TurboWarpExtension — add()', () => {
  it('adds two numbers', () => {
    assert.equal(extension.add({ A: 3, B: 4 }), 7);
  });

  it('coerces string arguments to numbers', () => {
    assert.equal(extension.add({ A: '5', B: '2' }), 7);
  });

  it('adds 0 + 1 = 1', () => {
    assert.equal(extension.add({ A: 0, B: 1 }), 1);
  });
});

describe('TurboWarpExtension — sayHello()', () => {
  it('delegates to sayHelloImpl and returns a greeting', () => {
    assert.equal(extension.sayHello({ NAME: 'World' }), 'Hello, World!');
  });
});

describe('TurboWarpExtension — colorBlock()', () => {
  it('returns the selected color string', () => {
    assert.equal(extension.colorBlock({ COLOR: '#FF0000' }), 'Selected color: #FF0000');
  });
});

describe('TurboWarpExtension — getInfo()', () => {
  it('returns an object with an id and name', () => {
    const info = extension.getInfo();
    assert.equal(typeof info.id, 'string');
    assert.equal(typeof info.name, 'string');
  });

  it('exposes a non-empty blocks array', () => {
    const { blocks } = extension.getInfo();
    assert.ok(Array.isArray(blocks) && blocks.length > 0, 'blocks should be a non-empty array');
  });

  it('declares all expected block opcodes', () => {
    const opcodes = extension.getInfo().blocks.map(b => b.opcode);
    assert.ok(opcodes.includes('helloWorld'), 'missing opcode: helloWorld');
    assert.ok(opcodes.includes('add'), 'missing opcode: add');
    assert.ok(opcodes.includes('colorBlock'), 'missing opcode: colorBlock');
    assert.ok(opcodes.includes('sayHello'), 'missing opcode: sayHello');
  });
});
