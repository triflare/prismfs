/**
 * Data-storage helpers.
 *
 * Usage example: keep mutation logic isolated for easier testing.
 */
export function addItem(items, value) {
  items.push(String(value ?? ''));
}

export function clearItems(items) {
  items.length = 0;
}
