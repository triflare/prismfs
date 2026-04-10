# TypeScript Support

Mint has optional TypeScript support. You can write your extension in `.ts` files and Mint will transpile them to JavaScript before bundling. Existing `.js` projects are completely unaffected — no configuration changes are required.

## Requirements

TypeScript transpilation is handled by [`esbuild`](https://esbuild.github.io/). Install it as a dev dependency:

```bash
npm install --save-dev esbuild
```

> [!NOTE]
>
> `esbuild` performs **type stripping only** — it does not type-check your code. Run `tsc --noEmit` (with a `tsconfig.json`) separately if you want compile-time type errors.

## Using TypeScript files

Create `.ts` files in `src/` following the same naming convention as `.js` files:

```
src/
  01-core.ts
  02-helpers.ts
  manifest.json
```

You can mix `.js` and `.ts` files freely. Files are sorted alphabetically before bundling, so the numeric prefix controls load order exactly as it does for JavaScript files.

## Type definitions

The file `types/scratch.d.ts` contains type definitions for the TurboWarp / Scratch extension API — including the `Scratch` global, block and argument types, and the `__mint_getAsset` helper.

Add a triple-slash reference directive at the top of each `.ts` source file to enable autocomplete and type checking in your editor:

```ts
/// <reference path="../types/scratch.d.ts" />
```

Or, if you have a `tsconfig.json`, add the `types` directory to `typeRoots`:

```json
{
  "compilerOptions": {
    "typeRoots": ["./types"],
    "target": "ES2017",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true
  }
}
```

## Example extension in TypeScript

```ts
/// <reference path="../types/scratch.d.ts" />

import { greet } from './02-helpers.js';

class MyExtension {
  getInfo(): ScratchExtensionInfo {
    return {
      id: 'myExtension',
      name: Scratch.translate('My Extension'),
      blocks: [
        {
          opcode: 'greetUser',
          blockType: 'reporter',
          text: Scratch.translate('greet [NAME]'),
          arguments: {
            NAME: {
              type: 'string',
              defaultValue: 'world',
            },
          },
        },
      ],
    };
  }

  greetUser(args: ScratchBlockArgs): string {
    return greet(String(args.NAME));
  }
}

Scratch.extensions.register(new MyExtension());
```

## Build output

TypeScript files are transpiled in memory before bundling — no intermediate `.js` files are written to disk. The final output in `build/` is always plain JavaScript.

## What the build does

1. `esbuild` strips TypeScript-specific syntax (type annotations, interfaces, enums, etc.) and outputs ES2017-compatible JavaScript.
2. The resulting JavaScript goes through the same IIFE bundling, minification, and formatting steps as regular `.js` files.
3. If `esbuild` is not installed and a `.ts` file is present, the build fails with a clear message telling you to run `npm install --save-dev esbuild`.

## Validation

The opcode and asset-reference validators scan both `.js` and `.ts` files, so all existing validation rules apply to TypeScript source files without any extra configuration.

## Linting

The default ESLint configuration targets `src/` and only processes `.js` files. To lint TypeScript files, install [`typescript-eslint`](https://typescript-eslint.io/) and extend your `eslint.config.mjs` accordingly.

## Recommended `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "typeRoots": ["./types"]
  },
  "include": ["src/**/*.ts"]
}
```

With `"noEmit": true`, running `tsc` only type-checks — it does not write any files. Mint's build pipeline handles the actual compilation via `esbuild`.
