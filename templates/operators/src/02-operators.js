/**
 * Operator helpers.
 *
 * Usage example: these helpers can be unit-tested independently.
 */
export function average(args) {
  return (Number(args.A) + Number(args.B)) / 2;
}

export function joinText(args) {
  return `${args.LEFT ?? ''}${args.RIGHT ?? ''}`;
}
