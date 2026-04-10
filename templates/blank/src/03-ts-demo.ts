/// <reference path="../types/scratch.d.ts" />

/**
 * TypeScript Demo Module
 *
 * This file is a proof-of-concept showing that Mint can bundle TypeScript
 * source files alongside regular JavaScript modules. Type annotations,
 * interfaces, and other TypeScript syntax are stripped by esbuild during
 * the build, leaving clean ES2017 JavaScript in the output.
 *
 * Functions exported here are available to any module that is bundled after
 * this one (files are processed in alphabetical / numeric-prefix order).
 */

/** A 2D point with typed coordinates. */
interface Point {
  x: number;
  y: number;
}

/**
 * Compute the Euclidean distance between two typed points.
 * @param a - The first point.
 * @param b - The second point.
 * @returns The distance as a number.
 */
export function distanceBetween(a: Point, b: Point): number {
  const dx: number = b.x - a.x;
  const dy: number = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Clamp a numeric value between a minimum and maximum bound.
 * @param value - The number to clamp.
 * @param min   - Lower bound (inclusive).
 * @param max   - Upper bound (inclusive).
 * @returns The clamped value.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
