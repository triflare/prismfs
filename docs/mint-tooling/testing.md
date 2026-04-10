# Testing

Mint ships a unit-test scaffold powered by Node's built-in `node:test` runner. No extra testing frameworks or configuration files are required.

## Running tests

```bash
# Run all tests once
npm run test

# Re-run tests automatically on file changes
npm run test:watch
```

The runner discovers every `*.test.js` file under the `tests/` directory recursively, sorts them, and passes them all to `node --test`.

## Writing tests

### Testing exported helper functions

Functions you export from feature modules can be imported and tested directly. No Scratch mock is needed:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateDistance } from '../src/02-example-module.js';

describe('calculateDistance()', () => {
  it('computes a 3-4-5 right triangle distance', () => {
    assert.equal(calculateDistance({ X1: 0, Y1: 0, X2: 3, Y2: 4 }), 5);
  });

  it('returns 0 when both points are the same', () => {
    assert.equal(calculateDistance({ X1: 5, Y1: 5, X2: 5, Y2: 5 }), 0);
  });
});
```

### Testing block methods on the extension class

The extension class references the `Scratch` global, which does not exist in Node.js. Install the provided Scratch mock before importing your extension module:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installScratchMock } from './helpers/mock-scratch.js';

// Install the mock BEFORE importing any source that references Scratch.
const { mock } = installScratchMock();
let extension;
mock.extensions.register = instance => {
  extension = instance;
};

await import('../src/01-core.js');

describe('add()', () => {
  it('adds two numbers', () => {
    assert.equal(extension.add({ A: 3, B: 4 }), 7);
  });

  it('coerces string inputs to numbers', () => {
    assert.equal(extension.add({ A: '2', B: '3' }), 5);
  });
});
```

The `installScratchMock` helper sets `globalThis.Scratch` to a minimal stub that includes `extensions.register`, `translate`, and the common block type constants. By overriding `mock.extensions.register` you capture the extension instance that `01-core.js` passes to `Scratch.extensions.register()`.

### Common patterns

| What to test              | How                                                                |
| ------------------------- | ------------------------------------------------------------------ |
| Exported helper function  | Import directly and call with a mock `args` object                 |
| Block method return value | Install Scratch mock, import the core, call `extension.<method>()` |
| `getInfo()` metadata      | Assert `typeof info.id`, `Array.isArray(info.blocks)`, etc.        |
| Edge cases / defaults     | Pass `{}` or partial `args` objects                                |

## Test file layout

Place test files in `tests/` with the `.test.js` suffix. You can mirror the `src/` structure:

```
tests/
  helpers/
    mock-scratch.js        # Provided — do not delete
  01-core.test.js
  02-example-module.test.js
```

Subdirectories are fine and the runner will find test files anywhere in the tree as long as they end in `.test.js`.

## A note on module loading order

Because `01-core.js` uses a top-level `Scratch.extensions.register()` call, the mock must be installed before Node loads that file. The `await import(...)` at the top level of the test file handles this: it defers the module load until after your setup code has run. This is why a dynamic `import()` is used instead of a static `import` statement.
