/**
 * Sensing helpers.
 *
 * Usage example: split runtime access into helper modules for easier testing.
 */
export function getProjectTimer(runtime) {
  return runtime?.ioDevices?.clock?.projectTimer?.() ?? 0;
}

export function getStageDimensions(runtime) {
  const stage = runtime?.getTargetForStage?.();
  if (!stage) return '0 x 0';
  return `${stage.stageWidth ?? 0} x ${stage.stageHeight ?? 0}`;
}
