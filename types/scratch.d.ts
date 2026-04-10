/**
 * Type definitions for the TurboWarp / Scratch extension API.
 *
 * These types cover the subset of the Scratch global that is available inside
 * sandboxed TurboWarp extensions.  Import or reference this file from your
 * TypeScript source files to get autocomplete and compile-time safety.
 *
 * Usage — add a reference comment at the top of your .ts source file:
 *
 *   /// <reference path="../types/scratch.d.ts" />
 *
 * Or configure your tsconfig.json to include the types directory:
 *
 *   { "compilerOptions": { "typeRoots": ["./types"] } }
 */

// ---------------------------------------------------------------------------
// Block argument types
// ---------------------------------------------------------------------------

/** Scratch argument type identifiers accepted by block argument declarations. */
type ScratchArgumentType =
  | 'angle'
  | 'Boolean'
  | 'color'
  | 'number'
  | 'string'
  | 'matrix'
  | 'note'
  | 'image';

/** Scratch block type identifiers. */
type ScratchBlockType =
  | 'Boolean'
  | 'button'
  | 'command'
  | 'conditional'
  | 'event'
  | 'hat'
  | 'loop'
  | 'reporter';

// ---------------------------------------------------------------------------
// Block & extension info shapes
// ---------------------------------------------------------------------------

/** A single argument declared within a block definition. */
interface ScratchBlockArgument {
  type: ScratchArgumentType;
  defaultValue?: string | number | boolean;
  menu?: string;
}

/** Arguments map passed to a block implementation at runtime. */
type ScratchBlockArgs = Record<string, string | number | boolean>;

/** A single block entry inside the `blocks` array returned by `getInfo()`. */
interface ScratchBlockDefinition {
  opcode: string;
  blockType: ScratchBlockType;
  text: string;
  arguments?: Record<string, ScratchBlockArgument>;
  hideFromPalette?: boolean;
  isTerminal?: boolean;
  isDynamic?: boolean;
  filter?: string[];
  disableMonitor?: boolean;
}

/** A separator or label entry that can appear in the `blocks` array. */
interface ScratchBlockSeparator {
  blockType: 'label' | 'button';
  text: string;
}

/** Shape returned by `getInfo()` in every TurboWarp extension class. */
interface ScratchExtensionInfo {
  id: string;
  name: string;
  color1?: string;
  color2?: string;
  color3?: string;
  menuIconURI?: string;
  blockIconURI?: string;
  docsURI?: string;
  blocks: Array<ScratchBlockDefinition | ScratchBlockSeparator>;
  menus?: Record<string, ScratchMenuDefinition>;
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

/** A static menu item. */
interface ScratchMenuItem {
  text: string;
  value: string | number;
}

/** A menu definition: either a static list or a dynamic generator function name. */
interface ScratchMenuDefinition {
  acceptReporters?: boolean;
  items: ScratchMenuItem[] | string;
}

// ---------------------------------------------------------------------------
// Scratch global
// ---------------------------------------------------------------------------

/** The `Scratch.extensions` namespace. */
interface ScratchExtensions {
  /**
   * Register the extension instance with the Scratch VM.
   * Call this once at the end of your core module.
   */
  register(extension: object): void;

  /** Returns `true` when the extension is loaded in an unsandboxed context. */
  unsandboxed: boolean;
}

/** The `Scratch.translate` function. */
interface ScratchTranslate {
  /** Return a translated string for the given message. Falls back to the source text. */
  (message: string, params?: Record<string, string | number>): string;
}

/** The `Scratch.Cast` utilities. */
interface ScratchCast {
  toNumber(value: unknown): number;
  toString(value: unknown): string;
  toBoolean(value: unknown): boolean;
  toRgbColorObject(value: unknown): { r: number; g: number; b: number };
  compare(v1: unknown, v2: unknown): number;
}

/** The `Scratch.renderer` interface (available in unsandboxed mode). */
interface ScratchRenderer {
  penLine(
    penSkinId: number,
    penAttributes: object,
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ): void;
}

/** The top-level `Scratch` global available inside every sandboxed TurboWarp extension. */
declare const Scratch: {
  /** Register and manage extensions. */
  extensions: ScratchExtensions;
  /** Translate user-facing strings. */
  translate: ScratchTranslate;
  /** Type-casting utilities. */
  Cast: ScratchCast;
  /** Argument type constants. */
  ArgumentType: Record<ScratchArgumentType, ScratchArgumentType>;
  /** Block type constants. */
  BlockType: Record<ScratchBlockType, ScratchBlockType>;
  /** The Scratch renderer (unsandboxed only). */
  renderer?: ScratchRenderer;
  /** The Scratch VM runtime (unsandboxed only). */
  vm?: object;
};

// ---------------------------------------------------------------------------
// Asset helper injected by Mint at build time
// ---------------------------------------------------------------------------

/**
 * Retrieve a bundled asset by its relative path under `src/assets/`.
 * Returns a `data:` URI string, or `undefined` if the key is not found.
 *
 * Mint replaces `__ASSET__('path')` call-sites with inline data URIs at
 * build time, so this function is only needed at runtime when the asset map
 * is present.
 *
 * @example
 * const icon = __mint_getAsset('icons/menu.png');
 */
declare function __mint_getAsset(name: string): string | undefined;
