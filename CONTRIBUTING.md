# Contributing to PrismFS

Thank you for your interest in contributing!  PrismFS is a TurboWarp extension
built on top of [Mint](./docs/mint-tooling/) — Triflare's modular extension
development platform.

## What You'll Need

1. Any recent version of Git
2. A GitHub account
3. Node.js and `npm` (or `pnpm`) installed
4. Working knowledge of JavaScript

## Project Layout

```
src/
  01-core.js          Extension class + all block definitions (entry point)
  02-fs-utils.js      URI parsing, error helpers, constants
  03-prisms.js        Prism registry and in-memory file system
  04-permissions.js   Fine-grained permission store
  05-snapshots.js     Snapshot manager
  06-watchers.js      File watcher manager
  07-metadata.js      Metadata tagging
tests/
  helpers/
    mock-scratch.js   Scratch/mint global mock (provided by Mint)
  01-core.test.js     Extension class integration tests
  02-fs-utils.test.js URI / error utility unit tests
  03-prisms.test.js   Prism registry unit tests
  04-permissions.test.js Permission store unit tests
  05-snapshots.test.js   Snapshot manager unit tests
  06-watchers.test.js    Watcher manager unit tests
docs/
  prismfs.md          User-facing documentation
  mint-tooling/       Mint build-tooling documentation (do not edit)
```

## Getting Started

```bash
# Install dependencies
pnpm install        # or: npm install

# Build
npm run build

# Run tests
npm run test

# Lint + format + validate + build + test in one command
npm run fullstack
```

## Error Conventions

PrismFS errors always follow the structure `ERR<TYPE>: <message>`.  Reporter
blocks return this string instead of throwing so callers can detect failures
without a try/catch.  Possible error types:

| Type          | Meaning                                    |
|---------------|--------------------------------------------|
| `NOTFOUND`    | Prism, file, or snapshot not found         |
| `PERMISSION`  | Operation not permitted by permission set  |
| `INVALIDURI`  | Malformed PrismFS URI                      |
| `RESERVED`    | Attempt to mount/unmount a reserved prism  |
| `LIMIT`       | A quota (prisms, snapshots, watchers, …)   |
| `INVALID`     | Bad argument value                         |
| `READONLY`    | Write on an immutable prism                |
| `EXISTS`      | Name already taken                         |

A file, directory, or prism **name must not start with the three uppercase
letters `ERR`**, because PrismFS uses that prefix exclusively for error strings.

## Testing

Tests use Node's built-in `node:test` runner — no extra frameworks needed.

```bash
npm run test          # run all tests once
npm run test:watch    # re-run on file changes
```

### Testing Pure Logic

Functions exported from `02-fs-utils.js` through `07-metadata.js` are pure (or
nearly so) and can be imported and asserted against directly:

```js
import { parseUri } from '../src/02-fs-utils.js';
assert.deepEqual(parseUri('fs://hello.txt'), { prism: 'fs', filePath: 'hello.txt' });
```

### Testing Block Methods

Install the Scratch/mint mock before importing `01-core.js`:

```js
import { installScratchMock } from './helpers/mock-scratch.js';
const { mock } = installScratchMock();
let extension;
mock.extensions.register = instance => { extension = instance; };
await import('../src/01-core.js');
```

## Quality Standards

- All new functionality should have unit tests.
- Keep block implementations thin — delegate business logic to the helper modules.
- Follow the existing code style (Prettier + ESLint configs are committed).
- AI-generated code is welcome, but it must meet or exceed the human-authored
  standard.  See [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) for details.

## Submitting a Pull Request

1. Fork the repo and create a branch.
2. Make your changes with tests.
3. Run `npm run fullstack` — everything must pass.
4. Open a pull request and describe what you changed and why.
