# Modules

Mint bundles your extension from multiple ES module files in `src/`. You can use `import ... from '...'` and `export function`/`export const` declarations, and the build script will strip the import lines and remove the leading `export` keyword before wrapping everything in a single IIFE. The forms shown in the examples on this page are fully supported.

## The core module (`01-core.js`)

This file is the heart of your extension. It defines the extension class, implements `getInfo()`, and calls `Scratch.extensions.register()`. Keep this file as the first in alphabetical order — the `01-` prefix ensures it always lands first in the bundle.

A minimal core module looks like this:

```js
class MyExtension {
  getInfo() {
    return {
      id: 'myExtension',
      name: Scratch.translate('My Extension'),
      blocks: [
        {
          opcode: 'doSomething',
          blockType: 'reporter',
          text: Scratch.translate('do something'),
        },
      ],
    };
  }

  doSomething() {
    return 'hello!';
  }
}

Scratch.extensions.register(new MyExtension());
```

## Feature modules

Any `.js` file in `src/` other than `01-core.js` is a feature module. Put your block implementations here to keep `01-core.js` readable.

```js
// 02-math.js
export function add(args) {
  return Number(args.A) + Number(args.B);
}
```

Then import it in `01-core.js`:

```js
// 01-core.js
import { add } from './02-math.js';

class MyExtension {
  // ...
  add(args) {
    return add(args);
  }
}
```

The bundler removes the `import` line and the `export` keyword, so both modules end up as plain JavaScript inside the same IIFE scope. Even though `01-core.js` sorts before `02-math.js` and therefore appears earlier in the bundle, the `add` function is still available when a block method calls it at runtime — method bodies do not execute until a block is triggered, by which point the entire bundle has already been parsed and all functions are defined. As long as you do not call an imported function at module load time (outside any method), the ordering is fine.

> [!NOTE]
>
> If you do need a helper to run at load time — for example, to set up some state when the extension is first registered — put that code inside the class constructor or make sure the helper is defined in a file that sorts earlier than the file calling it.

## The `manifest.json` file

`src/manifest.json` is not bundled, but Mint reads it to generate the metadata header in the output. The fields are:

| Field         | Purpose                                             |
| ------------- | --------------------------------------------------- |
| `name`        | Display name shown in the header and in `getInfo()` |
| `id`          | Extension ID (must be unique in TurboWarp)          |
| `version`     | Semver string                                       |
| `description` | Short description                                   |
| `author`      | Your name                                           |
| `license`     | SPDX identifier for the license                     |
| `url`         | Link to the extension's repository                  |

All fields have fallback defaults if omitted, but filling them out properly means the generated header is accurate and useful.

## Using `Scratch` and `__mint_getAsset`

Inside any source module you can use `Scratch` directly — it is passed as a parameter to the IIFE and is in scope throughout the bundle. ESLint is configured to treat it as a global, so you will not get "undefined variable" warnings.

`__mint_getAsset` is a generated helper that the bundler injects when there are files in `src/assets/`. It returns the base64 data URI for a given asset name. See [Assets](./assets.md) for how to use it.

## What you cannot do

Because Mint uses a simple text-based transform rather than a full module graph resolution, the following `import` and `export` forms are not supported and will produce broken output:

- **Bare side-effect imports** such as `import './x.js';` — the bundler only strips `import ... from '...'` lines; a bare import without `from` is left in place and will cause a syntax error in the bundle.
- **`export default ...`** — the `export` keyword is stripped, leaving `default ...` in the output, which is invalid JavaScript.
- **Named export lists** such as `export { foo };` — the `export` keyword is stripped, leaving `{ foo }` which is treated as a block statement rather than an export.
- **Re-exporting from another module** (`export { foo } from './bar.js'`) — not handled; import the value normally and use it directly.
- **Dynamic imports** (`import()` calls) — not supported; only static `import ... from '...'` statements are stripped.
- **Node.js built-in modules** (`fs`, `path`, etc.) — cannot be used; the bundle runs inside TurboWarp's browser sandbox, not Node.js.
