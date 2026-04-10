# Assets

Mint can embed images, sounds, and other binary files directly into your extension bundle as base64 data URIs. This means your extension is still a single self-contained `.js` file even when it uses icons or other media.

## Adding an asset

The easiest way is to use the asset manager. Run it without arguments for an interactive file picker:

```bash
npm run asset:add
```

```text
Interactive asset add
? Select file to add:
  Use ↑↓ arrows to move, Enter to select, Ctrl+C to cancel
  ❯ images/logo.png  (🖼️ image/png, 4.23 KB)
    sounds/beep.wav  (🔊 audio/wav, 12.00 KB)

? Store in assets/ subdirectory? (leave blank for root):
✓ Added src/assets/logo.png  (🖼️ image/png, 4.23 KB)

Usage snippets:
  Retrieve the asset data URI:
    mint.assets.get('logo.png')
  Check whether an asset is available before using it:
    mint.assets.exists('logo.png')
```

Or pass the file path directly to skip the picker:

```bash
npm run asset:add -- path/to/image.png
```

You can also copy files into `src/assets/` manually. Subdirectories are fine:

```text
src/assets/
  icons/
    menu.png
    block.png
  sounds/
    pop.wav
```

## Using an asset in your code

The `mint` object is always injected into the built bundle. Reference an asset by its path relative to `src/assets/`:

```js
menuIconURI: mint.assets.get('icons/menu.png') ?? '',
blockIconURI: mint.assets.get('icons/block.png') ?? '',
```

`mint.assets.get(name)` returns the base64 data URI string for the asset, or `undefined` if the asset is not present.

To check whether an asset exists before using it — useful for optional assets — call `mint.assets.exists`:

```js
if (mint.assets.exists('icons/overlay.png')) {
  this.overlay = mint.assets.get('icons/overlay.png');
}
```

> [!NOTE]
>
> Both `mint.assets.get()` and `mint.assets.exists()` are runtime functions injected by the bundler. They look up assets from an embedded map that is generated at build time. The `mint` object is always present in the bundle (it returns `undefined` / `false` when the `src/assets/` directory is absent or empty).

## Listing assets

```bash
npm run asset:list
```

Prints a table of every file in `src/assets/` with its MIME type, size, and how many source files reference it. Referenced assets are shown in green; unreferenced assets are highlighted in yellow as a reminder to clean them up if they are no longer needed.

```text
+------------------+-----------+---------+------+
| Name             | Type      | Size    | Refs |
+------------------+-----------+---------+------+
| icons/block.png  | image/png | 1.23 KB |    1 |
| icons/menu.png   | image/png | 0.98 KB |    0 |
+------------------+-----------+---------+------+
2 asset(s) total.

Usage references:
  icons/block.png
    └─ src/01-core.js

⚠ 1 asset(s) not referenced in any source file:
  icons/menu.png
```

## Removing an asset

Run without arguments for an interactive picker that lists your assets with reference and size info:

```bash
npm run asset:remove
```

```text
? Select asset to remove:
  Use ↑↓ arrows to move, Enter to select, Ctrl+C to cancel
  ❯ icons/menu.png  🖼️ 0.98 KB (unreferenced)
    icons/block.png  🖼️ 1.23 KB (referenced in 1 file)
```

Or pass the asset name directly:

```bash
npm run asset:remove -- icons/menu.png
```

A confirmation prompt is shown before the file is deleted (skipped automatically in non-interactive / CI environments where `stdin` is not a TTY):

```text
? Remove src/assets/icons/menu.png? (yes/no) (no):
```

Before deleting the file, the command scans top-level `.js` files directly under `src/` (it does not recurse into subdirectories) for `mint.assets.get('icons/menu.png')` and `mint.assets.exists('icons/menu.png')` references. If it finds any, it aborts:

```text
✗ Cannot remove 'icons/menu.png' — it is still referenced in:
  src/01-core.js
Remove or update those references first, then run this command again.
```

This prevents you from producing a build that references a missing asset.

## Supported file types

The bundler detects the MIME type from the file extension. Common types that are supported out of the box include:

| Extension       | MIME type       |
| --------------- | --------------- |
| `.png`          | `image/png`     |
| `.jpg`, `.jpeg` | `image/jpeg`    |
| `.gif`          | `image/gif`     |
| `.webp`         | `image/webp`    |
| `.svg`          | `image/svg+xml` |
| `.mp3`          | `audio/mpeg`    |
| `.wav`          | `audio/wav`     |
| `.ogg`          | `audio/ogg`     |

Files with an unrecognised extension are embedded as `application/octet-stream`.

## Build-time validation

Before bundling, the build script checks that every `mint.assets.get()` and `mint.assets.exists()` reference in top-level `.js` files directly under `src/` resolves to an actual file in `src/assets/`. If a reference is broken, the build fails and lists the problematic references. Assets that exist in `src/assets/` but are not referenced anywhere produce a warning but do not stop the build.

You can run this check on its own without building:

```bash
npm run validate:assets
```
