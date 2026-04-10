/* global Scratch */
import { average, joinText } from './02-operators.js';

/**
 * Operators template.
 *
 * Usage example: keep math/string logic in separate pure functions.
 */
class TurboWarpExtension {
  getInfo() {
    return {
      id: 'myTurboWarpExtension',
      name: Scratch.translate('Operators Starter'),
      blocks: [
        {
          opcode: 'average',
          blockType: 'reporter',
          text: Scratch.translate('average of [A] and [B]'),
          arguments: {
            A: { type: 'number', defaultValue: 1 },
            B: { type: 'number', defaultValue: 3 },
          },
        },
        {
          opcode: 'joinText',
          blockType: 'reporter',
          text: Scratch.translate('join [LEFT] and [RIGHT]'),
          arguments: {
            LEFT: { type: 'string', defaultValue: 'hello' },
            RIGHT: { type: 'string', defaultValue: 'mint' },
          },
        },
      ],
    };
  }

  average(args) {
    return average(args);
  }

  joinText(args) {
    return joinText(args);
  }
}

Scratch.extensions.register(new TurboWarpExtension());
