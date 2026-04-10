# Building

## Basic build

```bash
npm run build
```

This runs a single build and exits. The output goes to `build/`. If validation fails, the process exits with a non-zero code and prints the individual errors. If an unexpected exception occurs during bundling, a prominent failure banner also appears in your terminal.

### Source map options

By default, source maps are disabled.

```bash
npm run build -- --sourcemap
```

Generates external `*.map` files for each artifact that is produced:

- `build/extension.js.map`
- `build/min.extension.js.map` (when minification is available)
- `build/pretty.extension.js.map` (when formatting is available)

```bash
npm run build:prod -- --inline-sourcemap
```

Embeds inline source maps directly in each generated artifact instead of writing separate `.map` files.

## Caching

By default, Mint uses an internal cache in `.mint-cache/` to speed up incremental builds by reusing unchanged module transforms and cached validation results.

```bash
npm run build -- --no-cache
```

Use `--no-cache` when you want to force a clean, cache-bypassing build.

```bash
npm run build:clean
```

`build:clean` clears `.mint-cache/` and then runs a normal build.

## Output variants

Every successful build writes at least `build/extension.js`. Two optional variants are produced when the relevant packages are available:

| File                        | Requires      | Best for                                       |
| --------------------------- | ------------- | ---------------------------------------------- |
| `build/extension.js`        | nothing extra | General development and iteration              |
| `build/min.extension.js`    | `terser`      | Production deployment — smallest download size |
| `build/pretty.extension.js` | `prettier`    | Debugging — fully formatted and easy to read   |

If you ran `npm ci`, you already have both `terser` and `prettier` and all three files will be produced.

## Build report

After every successful build, Mint writes `build/BUILD_REPORT.md`. Open it to see the size of each artifact and a tailored recommendation:

- If `extension.js` exceeds 50 KB and a minified output was produced, the report recommends `min.extension.js` for production.
- Otherwise, `extension.js` is recommended.
- `pretty.extension.js` is always the recommendation for debugging.
- The report also includes a **Source Maps** section showing whether maps were generated inline or as external files.

## Watch mode

```bash
npm run watch
```

Builds once immediately, then watches `src/` for changes and rebuilds whenever a file is saved. A concurrency guard prevents overlapping builds: if a second change arrives while a build is in progress, the pending build runs as soon as the current one finishes.

You can combine watch mode with source map flags:

```bash
npm run watch -- --sourcemap
npm run watch -- --inline-sourcemap
```

When caching is enabled, build output includes cache hit/miss statistics and the number of rebuilt modules.

```bash
npm run watch:notify
```

Same as `watch`, but also sends a desktop notification when a build succeeds after a failure, or when a build fails. Notifications use the platform-native mechanism: `osascript` on macOS, PowerShell toast notifications on Windows, and `notify-send` on Linux.

## Production mode

```bash
npm run build:prod
```

Passes the `--production` flag to the build script. You can also set `NODE_ENV=production` before running the build command, though the syntax varies by shell: `NODE_ENV=production npm run build` (POSIX shells like bash/zsh), `$env:NODE_ENV='production'; npm run build` (PowerShell), or `set NODE_ENV=production&& npm run build` (cmd.exe). For a portable cross-platform approach, use the provided `npm run build:prod` script. In production mode, Mint runs an extra pass through Terser to strip developer comments from the output while keeping the metadata header lines (`Name`, `ID`, `Description`, `By`, `License`, `Version`).

## Debugging workflow in browser DevTools

1. Build with source maps enabled (`--sourcemap` or `--inline-sourcemap`).
2. Load `build/extension.js` (or `build/min.extension.js`) in TurboWarp.
3. Open browser DevTools and reproduce the issue.
4. In the Sources panel, open the mapped source and place breakpoints in the original code.
5. Refresh/reload the extension after rebuilding to pick up updated maps.

## What the bundler actually does

The build script transforms your ES modules into a single IIFE by:

1. Removing every `import ... from '...'` line.
2. Removing the `export` keyword from exported declarations so they become local variables or functions within the IIFE scope.
3. Indenting each file's content by two spaces and injecting a file name comment before it.
4. Wrapping everything in `(function (Scratch) { "use strict"; ... })(Scratch);`.

TypeScript (`.ts`) files are transpiled to JavaScript by `esbuild` before the above steps run. See [TypeScript Support](./typescript.md) for details.

The `Scratch` global is passed as a parameter rather than accessed directly. This matches TurboWarp's sandboxed extension loading model.

> [!NOTE]
>
> Because imports are removed and exports are inlined, every symbol you export from a module is automatically available to any module that appears later in the bundle. You do not need to change anything — just use `export function` / `export const` and `import ... from '...'` and the bundler handles the rest. For forms that are not supported, see [Modules — What you cannot do](./modules.md#what-you-cannot-do).

## Failure handling

If validation fails before bundling (see [Validation](./validation.md)), the build aborts and prints an error for each problem. In watch mode, Mint continues watching and will try again on the next file change. When the build recovers after a failure, a green "BUILD RECOVERED" banner is printed.

## The generated header

The top of every output file contains a comment block like this:

```js
// Name         :  My TurboWarp Extension
// ID           :  myTurboWarpExtension
// Description  :  A custom extension for TurboWarp
// By           :  Your Name
// License      :  LSL-1.0

// Version      :  1.0.1

// This file was generated by Mint, the new bundling toolchain for custom TurboWarp extensions.
// It is not recommended to edit this file on your own.
// Instead, edit it in this repository: https://example.com/my-extension
```

These values come from `src/manifest.json`. Update that file to change what appears here.
