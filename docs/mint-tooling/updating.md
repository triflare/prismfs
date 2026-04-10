# Updating Mint Tooling

If your extension repository was created from the Mint template, you can pull in the latest Mint tooling updates with:

```bash
npm run update:mint
```

This command:

- fetches the latest `main` branch from `triflare/mint-tooling`
- checks out Mint-managed tooling files (scripts, docs, templates, configs, workflows)
- updates tooling-related `package.json` fields (`type`, `main`, `scripts`, `devDependencies`) while preserving your project metadata and custom dependencies
- prints a message indicating Mint tooling is already up to date when no updates are needed

## Safety checks

- If the fetched latest commit changes `scripts/update-mint.js`, the updater stops and asks you to manually cherry-pick the latest updater commit(s) first.
- If your Mint version is already aligned with upstream (detected from `@triflare/mint-tooling` version metadata), this is used as an extra up-to-date signal.

## Dynamic structure support

`update:mint` supports custom project layouts without editing the script:

1. **Configurable checkout paths** via `package.json`
2. **Path aliases/redirects** via `package.json`
3. **Ignored update paths** via `.mintignore`

### package.json configuration

```json
{
  "mint": {
    "updateMint": {
      "checkoutPaths": ["scripts", "templates", "docs/mint-tooling"],
      "pathAliases": {
        "docs/mint-tooling": "documentation/mint-tooling"
      }
    }
  }
}
```

- `checkoutPaths` overrides the default list of Mint-managed paths.
- `pathAliases` remaps upstream paths to your local structure after checkout.

### .mintignore

Create a `.mintignore` file at repository root to skip selected paths:

```gitignore
# skip docs updates
docs/mint-tooling

# skip workflow updates
.github/workflows
```

Each entry ignores both the exact path and anything under it.

### Automatic docs alias detection

If `docs/mint-tooling` is selected for update, and your repo has `documentation/mint-tooling` but no `docs/mint-tooling`, the updater automatically redirects docs updates to `documentation/mint-tooling`.

## Options

- `--dry-run` — show what would be updated without changing files
- `--ref <ref>` — update from a specific branch, tag, or commit
- `--remote <url-or-remote>` — update from a custom Mint fork or remote

Examples:

```bash
npm run update:mint -- --dry-run
npm run update:mint -- --ref v2.0.5
npm run update:mint -- --remote https://github.com/your-org/mint-tooling.git --ref main
```

After updating, review your diff and run:

```bash
npm install
```

to refresh lockfiles if dependency versions changed.
