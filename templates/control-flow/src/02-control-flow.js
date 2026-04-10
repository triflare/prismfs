/**
 * Control-flow helpers.
 *
 * Usage example: place branching/loop logic here and keep block wrappers thin.
 */
export function repeatText(args) {
  const times = Math.max(0, Math.floor(Number(args.COUNT) || 0));
  return Array.from({ length: times }, () => String(args.TEXT ?? '')).join(' ');
}

export function shouldContinue(args) {
  return Number(args.VALUE) > Number(args.LIMIT);
}
