/**
 * Looks helpers.
 *
 * Usage example: provide reusable rendering utility functions.
 */
export function normalizeColor(args) {
  return String(args.COLOR ?? '#000000').toUpperCase();
}

export function cssShadow(args) {
  const x = Number(args.X) || 0;
  const y = Number(args.Y) || 0;
  const blur = Number(args.BLUR) || 0;
  const color = args.COLOR ?? '#000000';
  return `${x}px ${y}px ${blur}px ${color}`;
}
