/* global Scratch */
import { repeatText, shouldContinue } from './02-control-flow.js';

/**
 * Control-flow template.
 *
 * Usage example: command + boolean/reporter pair for custom flow logic.
 */
class TurboWarpExtension {
  getInfo() {
    return {
      id: 'myTurboWarpExtension',
      name: Scratch.translate('Control Flow Starter'),
      blocks: [
        {
          opcode: 'repeatText',
          blockType: 'reporter',
          text: Scratch.translate('repeat [TEXT] [COUNT] times'),
          arguments: {
            TEXT: { type: 'string', defaultValue: 'mint' },
            COUNT: { type: 'number', defaultValue: 3 },
          },
        },
        {
          opcode: 'shouldContinue',
          blockType: 'boolean',
          text: Scratch.translate('should continue when [VALUE] > [LIMIT]?'),
          arguments: {
            VALUE: { type: 'number', defaultValue: 10 },
            LIMIT: { type: 'number', defaultValue: 5 },
          },
        },
      ],
    };
  }

  repeatText(args) {
    return repeatText(args);
  }

  shouldContinue(args) {
    return shouldContinue(args);
  }
}

Scratch.extensions.register(new TurboWarpExtension());
