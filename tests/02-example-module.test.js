/**
 * Unit tests for src/02-example-module.js
 *
 * These tests exercise the exported helper functions directly, without any
 * dependency on the Scratch runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sayHelloImpl, colorBlock, calculateDistance } from '../src/02-example-module.js';

describe('sayHelloImpl()', () => {
  it('returns a personalised greeting', () => {
    assert.equal(sayHelloImpl({ NAME: 'Alice' }), 'Hello, Alice!');
  });

  it('works when NAME is "world"', () => {
    assert.equal(sayHelloImpl({ NAME: 'world' }), 'Hello, world!');
  });
});

describe('colorBlock()', () => {
  it('returns the selected color string', () => {
    assert.equal(colorBlock({ COLOR: '#00FF00' }), 'Selected color: #00FF00');
  });

  it('falls back to the default color when COLOR is not provided', () => {
    assert.equal(colorBlock({}), 'Selected color: #FF0000');
  });
});

describe('calculateDistance()', () => {
  it('computes a 3-4-5 right triangle distance', () => {
    assert.equal(calculateDistance({ X1: 0, Y1: 0, X2: 3, Y2: 4 }), 5);
  });

  it('returns 0 for identical points', () => {
    assert.equal(calculateDistance({ X1: 1, Y1: 1, X2: 1, Y2: 1 }), 0);
  });

  it('defaults missing coordinates to 0', () => {
    assert.equal(calculateDistance({}), 0);
  });
});
