import { remember, countRemembered } from './03-memory-service.js';

/**
 * Advanced block wrappers.
 *
 * Usage example: call lower-level service modules to keep wrappers tiny.
 */
export function formatGreeting(args) {
  const name = String(args.NAME ?? 'world');
  return args.STYLE === 'formal' ? `Good day, ${name}.` : `Hello, ${name}!`;
}

export function rememberName(state, name) {
  remember(state, name);
}

export function storedNameCount(state) {
  return countRemembered(state);
}
