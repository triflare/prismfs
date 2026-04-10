/**
 * Advanced shared service.
 *
 * Usage example: shared state helpers reused by multiple block modules.
 */
export function remember(state, name) {
  if (!Array.isArray(state.names)) {
    state.names = [];
  }
  state.names.push(String(name ?? ''));
}

export function countRemembered(state) {
  return Array.isArray(state.names) ? state.names.length : 0;
}
