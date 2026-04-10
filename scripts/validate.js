#!/usr/bin/env node

/**
 * Validate block opcode-to-method signatures.
 *
 * Checks that every block opcode declared in getInfo() has a corresponding
 * implementation method on the extension class, and that argument names
 * referenced in block text match the declared argument keys.
 *
 * Usage:
 *   node scripts/validate.js           (standalone)
 *   import { validateOpcodeSignatures } from './validate.js'  (from build.js)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.join(__dirname, '../src');
/**
 * Get all JS and TS files from src directory in order
 *
 * @param {string} [srcDir]
 * @returns {string[]}
 */
function getSourceFiles(srcDir = SRC_DIR) {
  const files = fs
    .readdirSync(srcDir)
    .filter(file => (file.endsWith('.js') || file.endsWith('.ts')) && !file.startsWith('.'))
    .sort();

  return files.map(f => path.join(srcDir, f));
}

/**
 * Extract the top-level argument keys from the content inside an `arguments: { … }` object.
 * Uses depth tracking so nested property names (type, defaultValue, …) are ignored.
 *
 * @param {string} inner - The text between the outer braces of the arguments object.
 * @returns {string[]} Top-level key names.
 */
function extractArgKeys(inner) {
  const keys = [];
  let depth = 0;
  let i = 0;

  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '{') {
      depth++;
      i++;
    } else if (ch === '}') {
      depth--;
      i++;
    } else if (depth === 0 && /[a-zA-Z_]/.test(ch)) {
      // Potential top-level key — look for `identifier:`
      const km = inner.slice(i).match(/^(\w+)\s*:/);
      if (km) {
        keys.push(km[1]);
        i += km[0].length;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return keys;
}

/**
 * Parse block definitions from a single source file.
 *
 * For each `opcode: 'name'` found, reads forward to collect:
 *   - textArgs  — argument placeholders like `[ARG]` from the block text
 *   - argKeys   — top-level keys from the `arguments: { … }` object
 *
 * @param {string} filePath
 * @returns {{ opcode: string, textArgs: string[], argKeys: string[], file: string }[]}
 */
function parseBlockDefinitions(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fileName = path.basename(filePath);
  const blocks = [];

  const opcodeRegex = /opcode:\s*['"]([^'"]+)['"]/g;
  const allMatches = [...content.matchAll(opcodeRegex)];

  for (let idx = 0; idx < allMatches.length; idx++) {
    const match = allMatches[idx];
    const opcode = match[1];

    // Segment spans from this opcode to the start of the next (or a fixed lookahead).
    const segStart = match.index;
    const segEnd = allMatches[idx + 1] ? allMatches[idx + 1].index : content.length;
    const segment = content.slice(segStart, segEnd);

    // Extract argument placeholders from block text, e.g. [A], [B], [NAME].
    // Use alternation to enforce matching opening/closing quote characters.
    const textMatch = segment.match(
      /\btext:\s*(?:Scratch\.translate\s*\(\s*)?(?:'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`)/
    );
    const rawText = textMatch ? (textMatch[1] ?? textMatch[2] ?? textMatch[3] ?? '') : '';
    const textArgs = [...rawText.matchAll(/\[([a-zA-Z_][a-zA-Z0-9_]*)\]/g)].map(m => m[1]);

    // Extract top-level argument keys from `arguments: { … }`
    let argKeys = [];
    const argsStart = segment.indexOf('arguments:');
    if (argsStart !== -1) {
      const braceOpen = segment.indexOf('{', argsStart);
      if (braceOpen !== -1) {
        // Find the matching closing brace
        let depth = 0;
        let braceClose = braceOpen;
        for (let j = braceOpen; j < segment.length; j++) {
          if (segment[j] === '{') depth++;
          else if (segment[j] === '}') {
            depth--;
            if (depth === 0) {
              braceClose = j;
              break;
            }
          }
        }
        argKeys = extractArgKeys(segment.slice(braceOpen + 1, braceClose));
      }
    }

    blocks.push({ opcode, textArgs, argKeys, file: fileName });
  }

  return blocks;
}

/**
 * Extract class method names from all source files.
 * Only matches methods indented with two spaces (standard prettier output for class bodies).
 *
 * @param {string[]} sourceFiles
 * @returns {Map<string, Set<string>>} file name → Set of method names
 */
function extractClassMethods(sourceFiles) {
  const methodsByFile = new Map();

  for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);

    const methods = new Set();
    const methodRegex =
      /^ {2}(?:(?:public|private|protected|static|override)\s+)*(?:async\s+)?(\w+)\s*\([^)]*\)(?:\s*:\s*[^{\n]*)?\s*\{/gm;
    for (const m of content.matchAll(methodRegex)) {
      methods.add(m[1]);
    }
    methodsByFile.set(fileName, methods);
  }

  return methodsByFile;
}

/**
 * Validate that every block opcode has a corresponding class method and that
 * argument names are consistent between block text and the arguments declaration.
 *
 * @param {string} [srcDir] - Source directory to scan (defaults to `../src`).
 * @returns {string[]} Array of error messages; empty means validation passed.
 */
export function validateOpcodeSignatures(srcDir = SRC_DIR) {
  const sourceFiles = getSourceFiles(srcDir);
  const methodsByFile = extractClassMethods(sourceFiles);
  const errors = [];

  for (const filePath of sourceFiles) {
    const fileName = path.basename(filePath);
    const fileMethods = methodsByFile.get(fileName) || new Set();

    for (const block of parseBlockDefinitions(filePath)) {
      const { opcode, textArgs, argKeys, file } = block;

      // 1. Every opcode must have a corresponding implementation method
      if (!fileMethods.has(opcode)) {
        errors.push(
          `  ✗ [${file}] Block opcode '${opcode}' has no corresponding implementation method in the extension class.`
        );
        continue;
      }

      // 2. Argument names in block text must match declared argument keys
      const textArgSet = new Set(textArgs);
      const argKeySet = new Set(argKeys);

      for (const arg of textArgs) {
        if (!argKeySet.has(arg)) {
          errors.push(
            `  ✗ [${file}] Block '${opcode}': argument '[${arg}]' is referenced in block text but not declared in arguments.`
          );
        }
      }

      for (const key of argKeys) {
        if (!textArgSet.has(key)) {
          errors.push(
            `  ✗ [${file}] Block '${opcode}': argument '${key}' is declared in arguments but not referenced in block text.`
          );
        }
      }
    }
  }

  return errors;
}

// --- Standalone runner ---
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Validating block opcode-to-method signatures...');
  const errors = validateOpcodeSignatures();
  if (errors.length > 0) {
    console.error('✗ Opcode validation failed:');
    for (const err of errors) {
      console.error(err);
    }
    process.exit(1);
  } else {
    console.log('✓ All block opcodes have corresponding implementation methods.');
    console.log('✓ All block argument names are consistent.');
  }
}
