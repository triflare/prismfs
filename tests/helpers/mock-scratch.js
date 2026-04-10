/**
 * Minimal Scratch environment mock for unit testing TurboWarp extensions.
 *
 * Install the mock as a global before importing any source module that
 * references the `Scratch` global, then call `restore()` when done.
 *
 * @example
 * import { installScratchMock } from './helpers/mock-scratch.js';
 * const { mock, restore } = installScratchMock();
 * // ... import extension modules ...
 * // ... run assertions ...
 * restore();
 */

/**
 * Create a fresh Scratch mock object.
 * @returns {object} Mock Scratch object.
 */
export function createScratchMock() {
  return {
    extensions: {
      register: () => {},
      unsandboxed: false,
    },
    translate: text => text,
    BlockType: {
      BOOLEAN: 'Boolean',
      COMMAND: 'command',
      HAT: 'hat',
      LOOP: 'loop',
      REPORTER: 'reporter',
    },
    ArgumentType: {
      ANGLE: 'angle',
      BOOLEAN: 'Boolean',
      COLOR: 'color',
      IMAGE: 'image',
      NUMBER: 'number',
      STRING: 'string',
    },
  };
}

/**
 * Install a Scratch mock as `globalThis.Scratch` and a mint mock as
 * `globalThis.mint` so that extension source modules which reference these
 * globals work in Node.js tests.
 *
 * @returns {{ mock: object, restore: () => void }}
 *   `mock`    — the installed Scratch mock (mutate to override behaviour).
 *   `restore` — call to remove or restore the original global values.
 */
export function installScratchMock() {
  const originalScratch = globalThis.Scratch;
  const originalMint = globalThis.mint;
  const mock = createScratchMock();
  globalThis.Scratch = mock;
  globalThis.mint = {
    assets: {
      get() {
        return undefined;
      },
      exists() {
        return false;
      },
    },
  };

  return {
    mock,
    restore: () => {
      if (originalScratch === undefined) {
        delete globalThis.Scratch;
      } else {
        globalThis.Scratch = originalScratch;
      }
      if (originalMint === undefined) {
        delete globalThis.mint;
      } else {
        globalThis.mint = originalMint;
      }
    },
  };
}
