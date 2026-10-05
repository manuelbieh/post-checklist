/** A short vibration, where the browser offers the Vibration API (Android). */
export function vibrate(): void {
  if (typeof navigator.vibrate === 'function') navigator.vibrate(12);
}

/**
 * Safari on iPhone (17.4+) plays a haptic tick when a finger toggles an
 * `<input type="checkbox" switch>`. Since iOS 26.5 only a real tap counts, not a
 * programmatic click, so touch controls carry a hidden switch the tap itself toggles.
 */
export const switchHaptics =
  typeof HTMLInputElement !== 'undefined' &&
  'switch' in HTMLInputElement.prototype &&
  matchMedia('(pointer: coarse)').matches;
