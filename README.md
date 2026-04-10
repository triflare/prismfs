<p align="center">
  <img src="src/assets/icons/menu.svg" alt="Mint logo" width="100">
</p>

# PrismFS

> An OPFS-powered, volume-based file system extension for TurboWarp projects.

PrismFS brings a full file-system experience to TurboWarp. Instead of one root folder, files are organised into named volumes called **prisms**, addressed with a URI scheme:

```
prism-name://path/to/file.ext
```

## Key Features

- **Volume-based:** Files live inside named prisms. Multiple sprites can share the same prism, with concurrent operations resolved in case-insensitive alphabetical sprite order.
- **OPFS-powered:** Persistent prisms are stored in the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system), giving you stable, secure, cross-session storage.
- **Prism types:** Prisms can be `prism` (persistent), `temporary` (discarded on green flag / project stop), or `immutable` (read-only).
- **Fine-grained permissions:** Every file and directory supports `see`, `read`, `write`, and `manage` permissions that cascade from prism → directory → file.
- **Snapshots:** Up to 20 named snapshots per prism for in-session emergency rollback. Stored in the reserved `prismsnap://` prism.
- **Backup & restore:** Export a prism to JSON and reimport it later, even across projects.
- **File watching:** Register wildcard-pattern watchers identified by UUID; hat blocks fire when matching paths are written.
- **Metadata tagging:** Every entry automatically receives `createdAt`, `modifiedAt`, and `callerSprite` tags. Developers can add up to 50 custom tags (32 KB each).
- **Wildcard search:** Search files by glob pattern within a prism or directory.
- **Three read formats:** Read files as plain `text`, `base64`, or a `data:` URI.
- **Debug logging:** Enable or disable verbose console logging with a single block.

## Default Prisms

| Prism    | Type      | Notes                                |
| -------- | --------- | ------------------------------------ |
| `fs://`  | prism     | General-purpose persistent volume    |
| `tmp://` | temporary | Cleared on green flag / project stop |

## Reserved Prisms

| Prism          | Use                                      |
| -------------- | ---------------------------------------- |
| `prismsnap://` | Internal storage for prism snapshots     |
| `prismfs://`   | Internal system prism for PrismFS itself |

## Error Format

All PrismFS errors follow the structure `ERR<TYPE>: <message>`, for example:

```
ERRNOTFOUND: Prism "archive" is not mounted.
ERRPERMISSION: No read permission on "fs://private.txt".
```

A reporter block will return the error string on failure so you can inspect or react to it in your scripts.

## Limits

| Limit                      | Value  |
| -------------------------- | ------ |
| Max files per prism        | 10 000 |
| Max single file size       | 8 GB   |
| Max mounted prisms         | 50     |
| Max watchers (global)      | 150    |
| Max metadata tags per file | 50     |
| Max metadata tag size      | 32 KB  |
| Max snapshots per prism    | 20     |

## Quick Start

```bash
pnpm install
npm run build      # outputs build/extension.js
npm run test       # runs the test suite
```

See [QUICKSTART.md](./QUICKSTART.md) for how to load the built extension into TurboWarp.

## Documentation

Full developer documentation is in [`docs/`](./docs/prismfs.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).
