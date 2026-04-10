# PrismFS Documentation

PrismFS is a TurboWarp extension that provides a full file-system abstraction
for your projects.  Files are organised into named volumes called **prisms**
and addressed with the URI scheme `prism-name://path/to/file.ext`.

---

## URI Format

```
prism-name://path/to/file.ext
```

- **Prism name** — starts with a letter; may contain letters, digits, hyphens
  (`-`), and underscores (`_`).  Case-insensitive.
- **Path** — forward-slash separated.  Trailing slashes are normalised away.

### Examples

| URI                             | Prism       | Path                  |
|---------------------------------|-------------|-----------------------|
| `fs://notes.txt`                | `fs`        | `notes.txt`           |
| `documents://reports/q1.csv`    | `documents` | `reports/q1.csv`      |
| `tmp://`                        | `tmp`       | _(prism root)_        |

---

## Prism Types

| Type        | Persistent? | Cleared on green flag? | Writable? |
|-------------|-------------|------------------------|-----------|
| `prism`     | Yes (OPFS)  | No                     | Yes       |
| `temporary` | No          | Yes                    | Yes       |
| `immutable` | No          | Yes                    | No        |

---

## Default and Reserved Prisms

PrismFS mounts two prisms automatically:

| Prism    | Type      |
|----------|-----------|
| `fs://`  | `prism`   |
| `tmp://` | `temporary` |

The following prism names are reserved and cannot be mounted or unmounted:

| Prism          | Purpose                              |
|----------------|--------------------------------------|
| `prismsnap://` | Storage for all prism snapshots      |
| `prismfs://`   | Internal PrismFS system prism        |

---

## Permissions

Each file or directory can carry four permissions:

| Permission | Allows                                                          |
|------------|-----------------------------------------------------------------|
| `see`      | Listing the file/directory in search or directory listings      |
| `read`     | Reading the file's contents                                     |
| `write`    | Writing or overwriting the file                                 |
| `manage`   | Deleting, creating files inside a directory, changing permissions|

Permissions **cascade** from the prism root → directory → file.  A more
specific path entry overrides a less specific one.  All permissions are granted
by default.

---

## Blocks Reference

### Prism Management

| Block                              | Type    | Description                        |
|------------------------------------|---------|------------------------------------|
| `mount prism [NAME] as [TYPE]`     | command | Mount a new prism                  |
| `unmount prism [NAME]`             | command | Unmount a mounted prism            |
| `is prism [NAME] mounted?`         | boolean | Check mount status                 |
| `type of prism [NAME]`             | reporter| Returns `prism`, `temporary`, or `immutable` |
| `list of mounted prisms`           | reporter| Returns a JSON array of prism names|

### File Operations

| Block                              | Type    | Description                        |
|------------------------------------|---------|------------------------------------|
| `read [URI]`                       | reporter| Read file as plain text            |
| `read [URI] as [FORMAT]`           | reporter| Read as `text`, `base64`, or `data: URI` |
| `write [CONTENT] to [URI]`         | command | Write content to a file            |
| `delete file [URI]`                | command | Delete a file                      |
| `file [URI] exists?`               | boolean | Check if a file exists             |

### Directory Operations

| Block                              | Type    | Description                        |
|------------------------------------|---------|------------------------------------|
| `list files in [URI]`              | reporter| JSON array of file paths           |
| `search [URI] for [PATTERN]`       | reporter| Wildcard file search               |

Wildcard patterns use `*` to match within a path segment and `**` to match
across path segments.  Example: `*.txt`, `docs/**`, `**/*.js`.

### Permissions

| Block                              | Type    | Description                        |
|------------------------------------|---------|------------------------------------|
| `set [PERM] on [URI] to [VALUE]`   | command | Grant or revoke a permission       |
| `[URI] has [PERM] permission?`     | boolean | Check a permission                 |

### Snapshots

| Block                                       | Type    | Description              |
|---------------------------------------------|---------|--------------------------|
| `snapshot prism [PRISM] as [NAME]`          | command | Create a named snapshot  |
| `delete snapshot [NAME] from prism [PRISM]` | command | Delete a snapshot        |
| `snapshots of prism [PRISM]`                | reporter| JSON list of snapshots   |
| `diff prism [PRISM] snapshot [S1] → [S2]`  | reporter| JSON diff between two snapshots |

Diff output: `{ "added": [...], "removed": [...], "modified": [...] }`.

Maximum **20 snapshots per prism**.

### Backup & Restore

| Block                                | Type    | Description                  |
|--------------------------------------|---------|------------------------------|
| `backup prism [NAME]`                | reporter| Export prism to JSON string  |
| `restore prism from backup [DATA]`   | command | Reimport a JSON backup       |

### File Watching

| Block                   | Type    | Description                              |
|-------------------------|---------|------------------------------------------|
| `watch [PATTERN]`       | reporter| Register a watcher; returns UUID         |
| `unwatch [UUID]`        | command | Remove a watcher                         |
| `when [UUID] fires`     | hat     | Fires when the watcher's pattern matches |

Maximum **150 watchers** globally.  A watcher will not re-fire if the triggering
write originated from within its own script.

### Metadata

| Block                                   | Type    | Description               |
|-----------------------------------------|---------|---------------------------|
| `metadata [TAG] of [URI]`               | reporter| Get a metadata tag value  |
| `set metadata [TAG] of [URI] to [VALUE]`| command | Set a custom tag          |
| `all metadata of [URI]`                 | reporter| Get all tags as JSON      |

Built-in tags (read-only): `createdAt`, `modifiedAt`, `callerSprite`.  
Maximum **50 custom tags per entry**, each limited to **32 KB**.

### Debug

| Block                       | Type    | Description               |
|-----------------------------|---------|---------------------------|
| `set debug logging [VALUE]` | command | Toggle `PrismFS:` console logs |

---

## Error Reference

All errors use the format `ERR<TYPE>: <message>`.

| Type          | Cause                                               |
|---------------|-----------------------------------------------------|
| `NOTFOUND`    | Prism, file, snapshot, or watcher not found         |
| `PERMISSION`  | Operation denied by the permission system           |
| `INVALIDURI`  | URI does not match the `prism://path` format        |
| `RESERVED`    | Attempt to mount/unmount a reserved prism name      |
| `LIMIT`       | A quota has been reached                            |
| `INVALID`     | Invalid argument (bad type, unknown permission, …)  |
| `READONLY`    | Write attempted on an immutable prism               |
| `EXISTS`      | Duplicate name (prism already mounted, etc.)        |

> **Note:** File, directory, and prism names must not begin with the three
> uppercase letters `ERR` because PrismFS uses that prefix exclusively for
> error strings.
