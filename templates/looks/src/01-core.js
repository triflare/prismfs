/* global Scratch */
import { cssShadow, normalizeColor } from './02-looks.js';

/**
 * Looks template.
 *
 * Usage example: convert user-facing values into renderer-friendly values.
 */
class TurboWarpExtension {
  getInfo() {
    return {
      id: 'myTurboWarpExtension',
      name: Scratch.translate('Looks Starter'),
      blocks: [
        {
          opcode: 'normalizeColor',
          blockType: 'reporter',
          text: Scratch.translate('normalize color [COLOR]'),
          arguments: {
            COLOR: { type: 'color', defaultValue: '#00AAFF' },
          },
        },
        {
          opcode: 'cssShadow',
          blockType: 'reporter',
          text: Scratch.translate('shadow from [X] [Y] [BLUR] [COLOR]'),
          arguments: {
            X: { type: 'number', defaultValue: 2 },
            Y: { type: 'number', defaultValue: 2 },
            BLUR: { type: 'number', defaultValue: 4 },
            COLOR: { type: 'color', defaultValue: '#000000' },
          },
        },
      ],
    };
  }

  normalizeColor(args) {
    return normalizeColor(args);
  }

  cssShadow(args) {
    return cssShadow(args);
  }
}

Scratch.extensions.register(new TurboWarpExtension());
