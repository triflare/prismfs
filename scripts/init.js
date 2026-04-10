#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';
import { stdin as input, stdout as output } from 'node:process';

export const TEMPLATE_OPTIONS = [
  { key: 'blank', label: 'Blank', description: 'Empty extension (default starter)' },
  { key: 'sensing-blocks', label: 'Sensing Blocks', description: 'Read sprite and stage state' },
  { key: 'operators', label: 'Operators', description: 'Math and text operations' },
  { key: 'control-flow', label: 'Control Flow', description: 'Custom loops and conditionals' },
  { key: 'looks', label: 'Looks', description: 'Visual effects and rendering helpers' },
  { key: 'data-storage', label: 'Data Storage', description: 'Variables and list-style state' },
  { key: 'advanced', label: 'Advanced', description: 'Complex multi-module extension' },
];
export const CORE_ID_PLACEHOLDER = 'myTurboWarpExtension';

/**
 * Prompt the user with a question and return their response or a default when input is empty.
 * @param {string} question - The prompt text shown to the user.
 * @param {string} [def=''] - The default value returned when the user submits an empty response.
 * @returns {Promise<string>} A Promise that resolves to the user's input trimmed; if the user enters nothing, the provided default.
 */
async function prompt(rl, question, def = '') {
  let closeAfter = false;
  let reader = rl;
  if (!reader) {
    reader = readline.createInterface({ input, output });
    closeAfter = true;
  }
  const q = def ? `${question} (${def}): ` : `${question}: `;
  try {
    const answer = await reader.question(q);
    return (answer || def).trim();
  } finally {
    if (closeAfter) reader.close();
  }
}

/**
 * Convert a string into a camelCase identifier suitable for use as an extension id.
 * @param {string} s - The input string (e.g., display name or package name) to convert.
 * @returns {string} The camelCased identifier; `'extensionId'` if the conversion produces an empty string.
 */
function toCamelCase(s) {
  return (
    s
      .replace(/[^a-zA-Z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((word, i) =>
        i === 0 ? word.toLowerCase() : (word[0]?.toUpperCase() || '') + word.slice(1)
      )
      .join('')
      .replace(/[^a-zA-Z0-9]/g, '') || 'extensionId'
  );
}

export function resolveTemplateChoice(selection = '') {
  const normalized = selection.trim().toLowerCase();
  if (!normalized) return TEMPLATE_OPTIONS[0].key;

  if (/^\d+$/.test(normalized)) {
    const numeric = Number.parseInt(normalized, 10);
    if (numeric >= 1 && numeric <= TEMPLATE_OPTIONS.length) {
      return TEMPLATE_OPTIONS[numeric - 1].key;
    }
  }

  const matched = TEMPLATE_OPTIONS.find(t => t.key === normalized);
  if (matched) return matched.key;

  throw new Error(
    `Unknown template "${selection}". Use a number from 1-${TEMPLATE_OPTIONS.length} or a template key.`
  );
}

function printTemplateOptions() {
  console.log('\nChoose a template:');
  TEMPLATE_OPTIONS.forEach((template, index) => {
    console.log(`  ${index + 1}. ${template.label} (${template.key}) — ${template.description}`);
  });
}

export async function scaffoldTemplate(templateKey, cwd = process.cwd()) {
  const validTemplateKeys = new Set(TEMPLATE_OPTIONS.map(template => template.key));
  if (!validTemplateKeys.has(templateKey)) {
    throw new Error(
      `Unknown template "${templateKey}". Use one of: ${TEMPLATE_OPTIONS.map(template => template.key).join(', ')}.`
    );
  }

  const templatesRoot = path.join(cwd, 'templates');
  const resolvedTemplatesRoot = path.resolve(templatesRoot);
  const templateSrc = path.join(templatesRoot, templateKey, 'src');
  const resolvedTemplateSrc = path.resolve(templateSrc);
  const srcDir = path.join(cwd, 'src');

  if (!resolvedTemplateSrc.startsWith(`${resolvedTemplatesRoot}${path.sep}`)) {
    throw new Error(
      `Template "${templateKey}" resolves outside the repository templates directory.`
    );
  }

  try {
    await fs.access(resolvedTemplateSrc);
  } catch {
    throw new Error(
      `Template "${templateKey}" was not found in the repository templates directory.`
    );
  }

  await fs.rm(srcDir, { recursive: true, force: true });
  await fs.mkdir(srcDir, { recursive: true });
  await fs.cp(resolvedTemplateSrc, srcDir, { recursive: true });
  console.log(`copied template files from templates/${templateKey}/src`);
}

function validateInputs({ name, version, id }) {
  const npmNameRe = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
  const semverRe =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
  const idRe = /^[A-Za-z][A-Za-z0-9]*$/;

  if (!npmNameRe.test(name)) throw new Error(`Invalid npm package name: "${name}"`);
  if (!semverRe.test(version)) throw new Error(`Invalid semver version: "${version}"`);
  if (!idRe.test(id)) throw new Error(`Invalid extension id: "${id}"`);
}

/**
 * Apply the provided key/value pairs to the project's package.json and persist the change.
 * @param {Object} updates - An object whose keys are package.json fields to set and whose values are the new values to write; existing fields will be overwritten and new fields will be added.
 */
async function updatePackageJson(updates) {
  const pkgPath = path.join(process.cwd(), 'package.json');
  const raw = await fs.readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw);
  for (const k of Object.keys(updates)) pkg[k] = updates[k];
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('updated package.json');
}

/**
 * Ensures `src/01-core.js` begins with an initialization header containing the display name and author.
 *
 * If the file does not already contain the marker "Initialized by npm run init", the header
 * is prepended; if the file is missing, the function returns without error. Other filesystem
 * errors are propagated.
 *
 * @param {string} displayName - Human-readable name to include in the header.
 * @param {string} author - Author string to include in the header.
 * @throws {Error} Propagates non-ENOENT filesystem errors encountered while reading or writing the file.
 */
async function addHeaderToCore(displayName, author) {
  const corePath = path.join(process.cwd(), 'src', '01-core.js');
  try {
    let content = await fs.readFile(corePath, 'utf8');
    const header = `// ${displayName}\n// Author: ${author}\n// Initialized by npm run init\n\n`;
    if (!content.includes('Initialized by npm run init')) {
      content = header + content;
      await fs.writeFile(corePath, content, 'utf8');
      console.log('updated src/01-core.js with header');
    } else {
      console.log('src/01-core.js already contains an init header — leaving unchanged');
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('src/01-core.js not found — skipping header update.');
      return;
    }
    throw err;
  }
}

/**
 * Rewrite scaffolded core metadata placeholders with user-selected id and display name.
 *
 * @param {Object} params - Metadata replacement values.
 * @param {string} params.id - Extension id to inject into `getInfo()`.
 * @param {string} params.displayName - Extension display name to inject into `getInfo()`.
 * @param {Object} [options] - Optional configuration.
 * @param {string} [options.cwd] - Working directory to use; defaults to process.cwd().
 */
export async function rewriteCoreMetadata({ id, displayName }, { cwd = process.cwd() } = {}) {
  const corePath = path.join(cwd, 'src', '01-core.js');
  try {
    let content = await fs.readFile(corePath, 'utf8');

    content = content.replace(
      new RegExp(`id:\\s*['"]${CORE_ID_PLACEHOLDER}['"]`),
      `id: ${JSON.stringify(id)}`
    );
    content = content.replace(
      /name:\s*Scratch\.translate\((?:'[^']*'|"[^"]*")\)/,
      `name: Scratch.translate(${JSON.stringify(displayName)})`
    );
    content = content.replace(
      /name:\s*(?:'My Extension'|"My Extension")/,
      `name: ${JSON.stringify(displayName)}`
    );

    await fs.writeFile(corePath, content, 'utf8');
    console.log('updated src/01-core.js metadata placeholders');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('src/01-core.js not found — skipping metadata rewrite.');
      return;
    }
    throw err;
  }
}

/**
 * Write a src/manifest.json file containing the provided extension metadata.
 *
 * @param {Object} params - Manifest fields.
 * @param {string} params.name - Extension name to write as `name`.
 * @param {string} params.id - Extension identifier to write as `id`.
 * @param {string} params.version - Version string to write as `version`.
 * @param {string} params.description - Description to write as `description`.
 * @param {string} params.author - Author to write as `author`.
 * @param {string} params.license - License identifier to write as `license`.
 * @param {string} params.url - URL to write as `url`.
 * @throws {Error} If creating the src directory or writing the file fails; the underlying error is rethrown.
 */
async function writeManifest({ name, id, version, description, author, license, url }) {
  const srcDir = path.join(process.cwd(), 'src');
  try {
    await fs.mkdir(srcDir, { recursive: true });
    const manifestPath = path.join(srcDir, 'manifest.json');
    const manifest = { name, id, version, description, author, license, url };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log('wrote src/manifest.json');
  } catch (err) {
    console.error('Failed to write manifest.json:', err);
    throw err;
  }
}

/**
 * Run an interactive CLI that initializes a Mint extension project.
 *
 * Prompts the user for package and extension metadata, asks for confirmation,
 * then applies the chosen changes: scaffolds src/ from the selected template,
 * rewrites scaffolded core metadata placeholders, writes src/manifest.json,
 * updates package.json, and ensures an initialization header is present in
 * src/01-core.js. On completion or error the readline interface is closed and
 * the process exits with an appropriate status.
 */
async function main() {
  const rl = readline.createInterface({ input, output });
  try {
    console.log('Welcome to Mint Extension Creator!\n');
    console.log('This script will help initialize a Mint extension from a template.');

    printTemplateOptions();
    const templateInput = await prompt(rl, 'Template number or key', '1');
    const template = resolveTemplateChoice(templateInput);
    const templateInfo = TEMPLATE_OPTIONS.find(t => t.key === template);
    console.log(`Selected template: ${templateInfo?.label ?? template}`);

    const name = await prompt(rl, 'npm package name (kebab-case)', path.basename(process.cwd()));
    const displayName = await prompt(rl, 'Extension display name', 'My Mint Extension');
    const description = await prompt(rl, 'Description', 'A Mint extension');
    const author = await prompt(rl, 'Author', '');
    const version = await prompt(rl, 'Initial version', '0.1.0');
    const license = await prompt(rl, 'License', 'LSL-1.0');
    const url = await prompt(rl, 'URL (homepage for the extension)', '');
    const defaultId = toCamelCase(displayName || name);
    const id = await prompt(rl, 'Extension id (camelCase, no spaces)', defaultId);
    validateInputs({ name, version, id });

    console.log('\nThe script will:');
    console.log(`- Replace src/ with files from templates/${template}/src`);
    console.log('- Update package.json with the provided values');
    console.log('- Create src/manifest.json with basic metadata');
    console.log('- Add an initialization header to the scaffolded src/01-core.js when missing');

    const confirm = (await prompt(rl, 'Proceed? (yes/no)', 'no')).toLowerCase();
    if (confirm !== 'yes' && confirm !== 'y') {
      console.log('Aborted by user. No changes made.');
      process.exit(0);
    }

    await scaffoldTemplate(template);
    await rewriteCoreMetadata({ id, displayName });
    await addHeaderToCore(displayName, author);
    await writeManifest({ name: displayName, id, version, description, author, license, url });
    await updatePackageJson({ name, description, author, version });

    console.log('\nInitialization complete.');
    console.log(`Created extension from '${template}' template.`);
    console.log('Next steps:');
    console.log('- Review package.json, src/manifest.json and src/01-core.js');
    console.log(
      "- Start adding your extension files under src/ (keep '01-core.js' as the core entry)"
    );
  } catch (err) {
    console.error('Error during init:', err);
    process.exit(1);
  } finally {
    rl.close();
  }
}

const isDirectExecution =
  process.argv[1] &&
  import.meta.url.startsWith('file:') &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  main();
}
