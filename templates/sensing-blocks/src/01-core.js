/* global Scratch */
import { getProjectTimer, getStageDimensions } from './02-sensing.js';

/**
 * Sensing template.
 *
 * Usage example: connect reporters to runtime values.
 */
class TurboWarpExtension {
  constructor(runtime) {
    this.runtime = runtime ?? null;
  }

  getInfo() {
    return {
      id: 'myTurboWarpExtension',
      name: Scratch.translate('Sensing Starter'),
      blocks: [
        {
          opcode: 'projectTimer',
          blockType: 'reporter',
          text: Scratch.translate('project timer'),
        },
        {
          opcode: 'stageSize',
          blockType: 'reporter',
          text: Scratch.translate('stage size'),
        },
      ],
    };
  }

  projectTimer() {
    return getProjectTimer(this.runtime);
  }

  stageSize() {
    return getStageDimensions(this.runtime);
  }
}

Scratch.extensions.register(new TurboWarpExtension(Scratch.vm?.runtime));
