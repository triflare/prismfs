/**
 * Blank starter template.
 *
 * Usage example:
 * - Add a block object in getInfo().blocks.
 * - Add the matching method on the class.
 */
/* global Scratch */
class TurboWarpExtension {
  getInfo() {
    return {
      id: 'myTurboWarpExtension',
      name: Scratch.translate('My Extension'),
      blocks: [],
    };
  }
}

Scratch.extensions.register(new TurboWarpExtension());
