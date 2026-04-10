# Project Structure

A typical Mint project looks like this:

```
my-extension/
  src/
    01-core.js            # Extension class and getInfo()
    02-example-module.js  # Additional block implementations
    manifest.json         # Extension metadata
    assets/               # Optional: images, sounds, etc.
      icons/
        menu.png
        block.png
  tests/
    helpers/
      mock-scratch.js     # Scratch environment mock (provided)
    01-core.test.js
    02-example-module.test.js
  build/                  # Generated — do not edit manually
    extension.js
    min.extension.js
    pretty.extension.js
    BUILD_REPORT.md
  scripts/                # Mint toolchain scripts
  docs/                   # Your extension's documentation lives here
  package.json
```

## The `src/` directory

This is where you write your extension. Mint reads every `.js` file in `src/` at build time, sorts them alphabetically, and bundles them in that order. The sort order is intentional: it lets you control the output order by prefixing file names with numbers.

### File naming

The convention is to prefix each file with a two-digit number:

- `01-core.js` — the extension class; always load this first
- `02-something.js`, `03-something-else.js` — feature modules

You can name the non-number part anything you like. The only requirement is that the file ends in `.js` and does not start with a `.`.

`manifest.json` is the one non-JS file Mint reads from `src/`. It is not included in the bundle itself; instead, its fields are used to generate the metadata comment block at the top of the output.

### The `src/assets/` subdirectory

Anything you place in `src/assets/` gets embedded into the bundle as a base64 data URI. See [Assets](./assets.md) for details.

## The `build/` directory

Mint creates this directory automatically. Never commit the files here unless you have a specific reason to — they are generated artifacts.

| File                  | Contents                                             |
| --------------------- | ---------------------------------------------------- |
| `extension.js`        | Standard build output                                |
| `min.extension.js`    | Minified output (only when `terser` is installed)    |
| `pretty.extension.js` | Formatted output (only when `prettier` is installed) |
| `BUILD_REPORT.md`     | Size summary and recommendation from the last build  |

## The `tests/` directory

Test files live here. The test runner picks up any file ending in `.test.js`, recursively. The `helpers/` subdirectory contains the Scratch environment mock that Mint ships with the template. See [Testing](./testing.md) for more.

## The `scripts/` directory

This is the Mint toolchain itself. You generally do not need to touch these files, but reading them is a good way to understand what each `npm run` command does.

| Script               | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `build.js`           | Bundles `src/` into `build/`                       |
| `serve.js`           | HTTP server for local preview                      |
| `validate.js`        | Opcode signature checker                           |
| `validate-assets.js` | Asset reference checker                            |
| `asset.js`           | Asset manager CLI                                  |
| `test.js`            | Test runner                                        |
| `init.js`            | Project initializer                                |
| `mime-map.js`        | MIME type map used by the asset bundler and server |
