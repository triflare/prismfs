/* global Scratch */
import { addItem, clearItems } from './02-storage.js';

/**
 * Data-storage template.
 *
 * Usage example: persist list-like extension state between block calls.
 */
class TurboWarpExtension {
  constructor() {
    this.items = [];
  }

  getInfo() {
    return {
      id: 'myTurboWarpExtension',
      name: Scratch.translate('Data Starter'),
      blocks: [
        {
          opcode: 'addItem',
          blockType: 'command',
          text: Scratch.translate('store item [VALUE]'),
          arguments: {
            VALUE: { type: 'string', defaultValue: 'value' },
          },
        },
        {
          opcode: 'itemCount',
          blockType: 'reporter',
          text: Scratch.translate('stored item count'),
        },
        {
          opcode: 'clearItems',
          blockType: 'command',
          text: Scratch.translate('clear stored items'),
        },
      ],
    };
  }

  addItem(args) {
    addItem(this.items, args.VALUE);
  }

  itemCount() {
    return this.items.length;
  }

  clearItems() {
    clearItems(this.items);
  }
}

Scratch.extensions.register(new TurboWarpExtension());
