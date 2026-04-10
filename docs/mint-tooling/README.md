# Mint Tooling

Mint is a bundling toolchain for custom TurboWarp extensions. Instead of maintaining one massive file, you write your extension across small, focused ES modules in `src/` and Mint concatenates them into a single output file that TurboWarp can load.

This directory contains in-depth documentation for each part of the toolchain. If you just want to get something building, start with the [quickstart](../../QUICKSTART.md) instead.

## What Mint does

When you run `npm run build`, Mint:

1. Reads every `.js` file from `src/` in alphabetical order.
2. Strips `import` and `export` statements so the modules become plain JavaScript.
3. Wraps everything in an IIFE that receives `Scratch` as its only parameter.
4. Embeds any files found in `src/assets/` as base64 data URIs.
5. Prepends a metadata comment block generated from `src/manifest.json`.
6. Writes the result to `build/extension.js`, and optionally produces minified and formatted variants.

## Available commands

| Command                               | What it does                                                              |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `npm run build`                       | Build once                                                                |
| `npm run build:prod`                  | Build with comment stripping (same as `--production`)                     |
| `npm run build:sourcemap`             | Build once with external source maps                                      |
| `npm run build:prod:inline-sourcemap` | Production build with inline source maps                                  |
| `npm run watch`                       | Build and rebuild on every source change                                  |
| `npm run watch:notify`                | Same as `watch`, plus desktop notifications on build events               |
| `npm run serve`                       | Start a local HTTP server and watch for changes                           |
| `npm run lint`                        | Lint `src/` with ESLint                                                   |
| `npm run lint:fix`                    | Lint and auto-fix                                                         |
| `npm run format`                      | Format `src/` with Prettier                                               |
| `npm run validate`                    | Check block opcode signatures                                             |
| `npm run validate:assets`             | Check asset references                                                    |
| `npm run asset:list`                  | List all assets in `src/assets/` with types, sizes, and usage references  |
| `npm run asset:add`                   | Copy a file into `src/assets/` (interactive file picker if no path given) |
| `npm run asset:remove`                | Remove an asset from `src/assets/` (interactive picker if no name given)  |
| `npm run test`                        | Run all tests once                                                        |
| `npm run test:watch`                  | Run tests and re-run on file changes                                      |
| `npm run init`                        | Interactive project initializer                                           |
| `npm run update:mint`                 | Fetch and apply latest Mint tooling files to your repo                    |
| `npm run fullstack`                   | Format, lint, validate, build, and test in one shot                       |

## Documentation index

- [Project structure](./project-structure.md) — directory layout and file naming
- [Building](./building.md) — build system, output variants, and the build report
- [Modules](./modules.md) — how to write and organise source modules
- [Assets](./assets.md) — embedding images and other files
- [Validation](./validation.md) — pre-build opcode and asset checks
- [Testing](./testing.md) — writing and running unit tests
- [Initializing a project](./init.md) — using `npm run init` to start fresh
- [Updating Mint tooling](./updating.md) — sync tooling updates into your extension repo
- [Template gallery](../../templates/README.md) — starter extension patterns
