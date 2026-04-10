# Validation

Mint runs two validation passes before every build to catch common mistakes early. You can also run each pass on its own without triggering a full build.

## Opcode signature validation

```bash
npm run validate
```

This scans each top-level `.js` file in `src/` for `opcode: '...'` patterns and checks that the opcode definitions and the class methods in that same file are consistent with each other. Specifically, it verifies:

1. Every `opcode` found in the file has a corresponding method with the same name in that same file's extension class.
2. Every argument placeholder in a block's `text` field (for example `[A]`, `[NAME]`) is declared in that block's `arguments` object.
3. Every key in a block's `arguments` object is referenced in the `text` field.

### What it catches

If you add a block to `getInfo()` but forget to implement the method:

```
  ✗ [01-core.js] Block opcode 'myNewBlock' has no corresponding implementation method in the extension class.
```

If your block text references an argument that is not declared:

```
  ✗ [01-core.js] Block 'greet': argument '[GREETING]' is referenced in block text but not declared in arguments.
```

If you declare an argument but never use it in the block text:

```
  ✗ [01-core.js] Block 'greet': argument 'GREETING' is declared in arguments but not referenced in block text.
```

The build will abort if any of these errors are present. Fix them and the build will proceed.

### How it works

The validator reads each top-level `.js` file directly in `src/` (it does not recurse into subdirectories), extracts `opcode: 'name'` patterns from that file, and then looks for a class method with the matching name in that same file. It does not execute any code — it is a purely static text-based analysis. Argument validation similarly uses regex matching against the block text and arguments object.

Because the `opcode` scan is regex-based, any object that happens to have an `opcode` key will also be checked — not just blocks inside `getInfo()`. In practice this is rarely a problem, but it is worth knowing if you use `opcode` as a property name elsewhere.

Because the analysis is text-based, it expects methods to be indented with two spaces (the standard Prettier output for class bodies). If you use a different indentation style, the method detection may miss some methods.

## Asset reference validation

```bash
npm run validate:assets
```

This checks that every `__ASSET__('path')` call in top-level `.js` files directly under `src/` (it does not recurse into subdirectories) resolves to an actual file under `src/assets/`. It also warns about files in `src/assets/` that are not referenced anywhere by those scanned files.

### What it catches

A missing asset file:

```
  ✗ [01-core.js] __ASSET__('icons/menu.png') — file not found: src/assets/icons/menu.png
```

A path traversal attempt (for example `__ASSET__('../secret.txt')`):

```
  ✗ [01-core.js] __ASSET__('../secret.txt') — invalid path (traversal detected)
```

An unreferenced asset (warning, not an error):

```
  ⚠ Asset not referenced in any source file: src/assets/old-icon.png
```

### Running both validations together

Both checks run automatically as part of every build. If you want to run them standalone — without triggering a full build — run each command manually in sequence:

```bash
npm run validate && npm run validate:assets
```

`npm run fullstack` also runs both validations, but it goes on to build and test as well.
