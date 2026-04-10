/* global Scratch */
import { formatGreeting, rememberName, storedNameCount } from './02-greetings.js';

/**
 * Advanced template.
 *
 * Usage example: separate block wrappers, business logic, and state services.
 */
class TurboWarpExtension {
  constructor() {
    this.state = { names: [] };
  }

  getInfo() {
    return {
      id: 'myTurboWarpExtension',
      name: Scratch.translate('Advanced Starter'),
      blocks: [
        {
          opcode: 'formatGreeting',
          blockType: 'reporter',
          text: Scratch.translate('greet [NAME] with style [STYLE]'),
          arguments: {
            NAME: { type: 'string', defaultValue: 'Mint' },
            STYLE: {
              type: 'string',
              menu: 'greetingStyles',
              defaultValue: 'friendly',
            },
          },
        },
        {
          opcode: 'rememberName',
          blockType: 'command',
          text: Scratch.translate('remember [NAME]'),
          arguments: {
            NAME: { type: 'string', defaultValue: 'Mint' },
          },
        },
        {
          opcode: 'storedNameCount',
          blockType: 'reporter',
          text: Scratch.translate('remembered names count'),
        },
      ],
      menus: {
        greetingStyles: {
          acceptReporters: true,
          items: ['friendly', 'formal'],
        },
      },
    };
  }

  formatGreeting(args) {
    return formatGreeting(args);
  }

  rememberName(args) {
    rememberName(this.state, args.NAME);
  }

  storedNameCount() {
    return storedNameCount(this.state);
  }
}

Scratch.extensions.register(new TurboWarpExtension());
