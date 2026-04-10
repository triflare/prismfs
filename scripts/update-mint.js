#!/usr/bin/env node
import { isDeepStrictEqual, promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);

const DEFAULT_REMOTE = 'https://github.com/triflare/mint-tooling.git';
const DEFAULT_REF = 'main';
const DOCS_MINT_TOOLING_PATH = 'docs/mint-tooling';
const DEFAULT_CHECKOUT_PATHS = [
  '.github/workflows',
  '.github/dependabot.yml',
  '.github/pull_request_template.md',
  '.prettierrc.json',
  DOCS_MINT_TOOLING_PATH,
  'eslint',
  'eslint.config.mjs',
  'scripts',
  'templates',
  'tsconfig.json',
  'types',
];
const DEFAULT_PATH_ALIASES = {
  [DOCS_MINT_TOOLING_PATH]: 'documentation/mint-tooling',
};
const MINT_PACKAGE_NAME = '@triflare/mint-tooling';
const UPDATE_SCRIPT_PATH = 'scripts/update-mint.js';

export function parseUpdateArgs(argv = process.argv.slice(2)) {
  const parsed = {
    remote: DEFAULT_REMOTE,
    ref: DEFAULT_REF,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }

    if (token === '--remote') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-'))
        throw new Error('--remote requires a value');
      parsed.remote = value;
      index += 1;
      continue;
    }

    if (token === '--ref') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('-')) throw new Error('--ref requires a value');
      parsed.ref = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return parsed;
}

export function mergePackageJson(currentPackageJson, upstreamPackageJson) {
  const mergedPackageJson = {
    ...currentPackageJson,
    scripts: {
      ...(currentPackageJson.scripts ?? {}),
      ...(upstreamPackageJson.scripts ?? {}),
    },
    devDependencies: {
      ...(currentPackageJson.devDependencies ?? {}),
      ...(upstreamPackageJson.devDependencies ?? {}),
    },
  };

  if (upstreamPackageJson.type !== undefined) {
    mergedPackageJson.type = upstreamPackageJson.type;
  }
  if (upstreamPackageJson.main !== undefined) {
    mergedPackageJson.main = upstreamPackageJson.main;
  }

  return mergedPackageJson;
}

function normalizeVersion(version) {
  if (typeof version !== 'string') return null;
  const trimmed = version.trim();
  if (!trimmed) return null;
  const withoutRangePrefix = /^[~^]/.test(trimmed) ? trimmed.slice(1) : trimmed;
  return withoutRangePrefix.startsWith('v') ? withoutRangePrefix.slice(1) : withoutRangePrefix;
}

export function getMintToolingVersion(packageJson) {
  if (!packageJson || typeof packageJson !== 'object') return null;
  if (packageJson.name === MINT_PACKAGE_NAME && typeof packageJson.version === 'string') {
    return packageJson.version;
  }

  const dependencyFields = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
  ];
  for (const dependencyField of dependencyFields) {
    if (!dependencyField || typeof dependencyField !== 'object') continue;
    const version = dependencyField[MINT_PACKAGE_NAME];
    if (typeof version === 'string') return version;
  }

  return null;
}

export function isMintVersionUpToDate(localPackageJson, upstreamPackageJson) {
  const localVersion = normalizeVersion(getMintToolingVersion(localPackageJson));
  const upstreamVersion = normalizeVersion(getMintToolingVersion(upstreamPackageJson));
  return Boolean(localVersion && upstreamVersion && localVersion === upstreamVersion);
}

export function hasToolingPackageUpdates(currentPackageJson, mergedPackageJson) {
  return !(
    isDeepStrictEqual(currentPackageJson.type, mergedPackageJson.type) &&
    isDeepStrictEqual(currentPackageJson.main, mergedPackageJson.main) &&
    isDeepStrictEqual(currentPackageJson.scripts ?? {}, mergedPackageJson.scripts ?? {}) &&
    isDeepStrictEqual(
      currentPackageJson.devDependencies ?? {},
      mergedPackageJson.devDependencies ?? {}
    )
  );
}

function assertSafeRepoRelativePath(value, fieldName) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${fieldName} entries must be non-empty strings`);
  }
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (
    normalized === '.' ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error(`${fieldName} entries must stay inside the repository: "${value}"`);
  }
  return normalized.replace(/\/+$/, '');
}

export function parseMintIgnore(content = '') {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

export function shouldIgnorePath(repoPath, ignorePatterns) {
  return ignorePatterns.some(pattern => {
    const normalizedPattern = pattern.replace(/\/+$/, '');
    if (repoPath === normalizedPattern) return true;
    return repoPath.startsWith(`${normalizedPattern}/`);
  });
}

export function resolveCheckoutPaths(basePaths, ignorePatterns) {
  const uniquePaths = [
    ...new Set(basePaths.map(value => assertSafeRepoRelativePath(value, 'checkoutPaths'))),
  ];
  return uniquePaths.filter(repoPath => !shouldIgnorePath(repoPath, ignorePatterns));
}

export async function detectAutoPathAliases(repoRoot, checkoutPaths) {
  const aliases = {};

  const docsPath = path.join(repoRoot, 'docs', 'mint-tooling');
  const documentationPath = path.join(repoRoot, 'documentation', 'mint-tooling');
  if (checkoutPaths.includes(DOCS_MINT_TOOLING_PATH)) {
    const docsExists = await fs
      .access(docsPath)
      .then(() => true)
      .catch(() => false);
    const documentationExists = await fs
      .access(documentationPath)
      .then(() => true)
      .catch(() => false);
    if (!docsExists && documentationExists) {
      aliases[DOCS_MINT_TOOLING_PATH] = DEFAULT_PATH_ALIASES[DOCS_MINT_TOOLING_PATH];
    }
  }

  return aliases;
}

async function loadUpdateConfig(repoRoot) {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const configured = packageJson?.mint?.updateMint ?? {};
  const configuredPaths = configured.checkoutPaths ?? DEFAULT_CHECKOUT_PATHS;
  const configuredAliases = configured.pathAliases ?? {};
  if (!Array.isArray(configuredPaths)) {
    throw new Error('package.json mint.updateMint.checkoutPaths must be an array');
  }
  if (
    configuredAliases === null ||
    Array.isArray(configuredAliases) ||
    typeof configuredAliases !== 'object'
  ) {
    throw new Error('package.json mint.updateMint.pathAliases must be an object');
  }

  const safeAliases = Object.fromEntries(
    Object.entries(configuredAliases).map(([from, to]) => [
      assertSafeRepoRelativePath(from, 'pathAliases'),
      assertSafeRepoRelativePath(to, 'pathAliases'),
    ])
  );

  const mintIgnorePath = path.join(repoRoot, '.mintignore');
  const mintIgnoreContent = await fs.readFile(mintIgnorePath, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw new Error(
      `Failed to read ${mintIgnorePath} (${error.code ?? 'unknown'}): ${error.message}`
    );
  });
  const ignorePatterns = parseMintIgnore(mintIgnoreContent).map(pattern =>
    assertSafeRepoRelativePath(pattern, '.mintignore')
  );

  const checkoutPaths = resolveCheckoutPaths(configuredPaths, ignorePatterns);
  const autoAliases = await detectAutoPathAliases(repoRoot, checkoutPaths);
  const pathAliases = { ...autoAliases, ...safeAliases };

  return { checkoutPaths, pathAliases, ignorePatterns };
}

async function applyPathAliases(repoRoot, pathAliases, checkoutPaths) {
  for (const [sourcePath, targetPath] of Object.entries(pathAliases)) {
    if (!checkoutPaths.includes(sourcePath) || sourcePath === targetPath) continue;

    const sourceAbsPath = path.join(repoRoot, sourcePath);
    const targetAbsPath = path.join(repoRoot, targetPath);
    const sourceExists = await fs
      .access(sourceAbsPath)
      .then(() => true)
      .catch(() => false);
    if (!sourceExists) continue;

    const targetStat = await fs.lstat(targetAbsPath).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (targetStat) {
      if (!targetStat.isDirectory()) {
        throw new Error(
          `Refusing to overwrite existing file target for alias "${sourcePath}" -> "${targetPath}"`
        );
      }
      const existingEntries = await fs.readdir(targetAbsPath);
      if (existingEntries.length > 0) {
        const sourceStat = await fs.lstat(sourceAbsPath).catch(() => null);
        if (!sourceStat || !sourceStat.isDirectory()) {
          throw new Error(
            `Refusing to overwrite non-empty alias target "${targetPath}". Move files out of the way or remove this alias.`
          );
        }
        const sourceEntries = await fs.readdir(sourceAbsPath);
        const existingSorted = existingEntries.slice().sort();
        const sourceSorted = sourceEntries.slice().sort();
        const identical =
          existingSorted.length === sourceSorted.length &&
          existingSorted.every((v, i) => v === sourceSorted[i]);
        if (!identical) {
          throw new Error(
            `Refusing to overwrite non-empty alias target "${targetPath}". Move files out of the way or remove this alias.`
          );
        }
        // Directory entries are identical by name — remove existing target to allow rename
        await fs.rm(targetAbsPath, { recursive: true, force: true });
      } else {
        await fs.rm(targetAbsPath, { recursive: false, force: false });
      }
    }

    await fs.mkdir(path.dirname(targetAbsPath), { recursive: true });
    await fs.rename(sourceAbsPath, targetAbsPath);
  }
}

async function runGit(args, cwd) {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

async function main() {
  try {
    const { remote, ref, dryRun } = parseUpdateArgs();
    const cwd = process.cwd();
    await runGit(['rev-parse', '--is-inside-work-tree'], cwd);
    const repoRoot = await runGit(['rev-parse', '--show-toplevel'], cwd);
    const { checkoutPaths, pathAliases, ignorePatterns } = await loadUpdateConfig(repoRoot);
    console.log(`Fetching Mint updates from ${remote} (${ref})...`);
    await runGit(['fetch', remote, ref], repoRoot);
    const fetchedCommit = await runGit(['rev-parse', '--short', 'FETCH_HEAD'], repoRoot);
    const updaterDiffOutput = await runGit(
      ['diff-tree', '--no-commit-id', '--name-only', '-r', 'FETCH_HEAD', '--', UPDATE_SCRIPT_PATH],
      repoRoot
    );
    if (updaterDiffOutput.trim()) {
      const updaterCommits = await runGit(
        ['log', '--oneline', '--max-count', '5', 'FETCH_HEAD', '--', UPDATE_SCRIPT_PATH],
        repoRoot
      );
      const suggestedCherryPickCommit = updaterCommits.split(/\r?\n/)[0]?.trim().split(/\s+/)[0];
      const cherryPickExample = suggestedCherryPickCommit
        ? `git cherry-pick ${suggestedCherryPickCommit}`
        : 'git cherry-pick <commit-sha>';
      throw new Error(
        `Latest Mint commit ${fetchedCommit} from ${remote}/${ref} changes ${UPDATE_SCRIPT_PATH}. Manually cherry-pick the latest Mint commit(s) touching this updater from that remote/ref into your branch (for example: ${cherryPickExample}), then rerun update:mint.${
          updaterCommits ? `\nRecent updater commits:\n${updaterCommits}` : ''
        }`
      );
    }

    const upstreamPackageRaw = await runGit(['show', 'FETCH_HEAD:package.json'], repoRoot);
    const upstreamPackageJson = JSON.parse(upstreamPackageRaw);
    const localPackagePath = path.join(repoRoot, 'package.json');
    const localPackageJson = JSON.parse(await fs.readFile(localPackagePath, 'utf8'));
    const mergedPackageJson = mergePackageJson(localPackageJson, upstreamPackageJson);
    const managedPathDiff = checkoutPaths.length
      ? await runGit(
          ['diff', '--name-only', 'HEAD', 'FETCH_HEAD', '--', ...checkoutPaths],
          repoRoot
        )
      : '';
    const hasManagedPathUpdates = managedPathDiff.trim().length > 0;
    const hasPackageJsonUpdates = hasToolingPackageUpdates(localPackageJson, mergedPackageJson);
    if (!hasManagedPathUpdates && !hasPackageJsonUpdates) {
      const localMintVersion = getMintToolingVersion(localPackageJson);
      const versionSuffix =
        isMintVersionUpToDate(localPackageJson, upstreamPackageJson) && localMintVersion
          ? ` (${MINT_PACKAGE_NAME} ${localMintVersion})`
          : '';
      if (dryRun) {
        console.log(`[dry-run] Mint tooling is already up-to-date${versionSuffix}. Nothing to do.`);
        console.log(`[dry-run] Fetched commit: ${fetchedCommit}`);
        return;
      }
      console.log(`Mint tooling is already up-to-date${versionSuffix}. Nothing to do.`);
      return;
    }

    if (dryRun) {
      console.log(`[dry-run] Would check out: ${checkoutPaths.join(', ')}`);
      if (ignorePatterns.length > 0) {
        console.log(`[dry-run] Ignoring paths from .mintignore: ${ignorePatterns.join(', ')}`);
      }
      if (Object.keys(pathAliases).length > 0) {
        console.log(`[dry-run] Applying path aliases: ${JSON.stringify(pathAliases)}`);
      }
      console.log('[dry-run] Would merge package.json tooling fields from FETCH_HEAD');
      console.log(`[dry-run] Fetched commit: ${fetchedCommit}`);
      return;
    }

    if (checkoutPaths.length > 0) {
      const statusOutput = await runGit(
        ['status', '--porcelain', '--', ...checkoutPaths],
        repoRoot
      );
      if (statusOutput) {
        throw new Error(
          `Uncommitted or modified files detected in Mint-managed paths: ${checkoutPaths.join(
            ', '
          )}. Commit, stash, or remove local changes before running update:mint.`
        );
      }

      await runGit(['checkout', 'FETCH_HEAD', '--', ...checkoutPaths], repoRoot);
      await applyPathAliases(repoRoot, pathAliases, checkoutPaths);
    } else {
      console.log(
        'No Mint-managed paths selected for checkout after applying configuration/ignore rules.'
      );
    }
    await fs.writeFile(localPackagePath, `${JSON.stringify(mergedPackageJson, null, 2)}\n`, 'utf8');

    console.log(`Updated Mint tooling from commit ${fetchedCommit}.`);
    console.log('Review the diff, then run npm install to refresh lockfiles if needed.');
  } catch (error) {
    console.error('Failed to update Mint tooling:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

const isDirectExecution =
  process.argv[1] &&
  import.meta.url.startsWith('file:') &&
  realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main();
}
