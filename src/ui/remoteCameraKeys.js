import * as Cesium from 'cesium';
import {
  readCameraTargetFrame,
  setCameraTargetFrame,
} from './cameraOrientationControls.js';

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
// Keyboard, media-remote and TV-remote names for the same two actions.
const ZOOM_IN_KEYS = new Set([
  '+',
  '=',
  'PageUp',
  'ChannelUp',
  'MediaFastForward',
  'ZoomIn',
]);
const ZOOM_OUT_KEYS = new Set([
  '-',
  '_',
  'PageDown',
  'ChannelDown',
  'MediaRewind',
  'ZoomOut',
]);

export const PAN_FRACTION = 0.12;
export const ZOOM_FACTOR = 0.7;
export const ROTATE_STEP = Cesium.Math.toRadians(15);
export const MIN_RANGE_M = 30;
export const MAX_RANGE_M = 40_000_000;
// One press never moves the view further than this, so the full-globe view
// steps across continents instead of skipping past them.
const MAX_PAN_M = 1_500_000;
export const MENU_HOLD_MS = 600;

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Zoom the orbit frame in (factor < 1) or out (factor > 1). */
export function zoomFrame(frame, factor) {
  return {
    ...frame,
    range: Cesium.Math.clamp(frame.range * factor, MIN_RANGE_M, MAX_RANGE_M),
  };
}

/** Rotate the orbit frame's heading by `delta` radians. */
export function rotateFrame(frame, delta) {
  return { ...frame, heading: frame.heading + delta };
}

/**
 * Slide the orbit target along the ground, in screen directions: `right` and
 * `up` are -1, 0 or 1. The camera keeps its heading, pitch and range.
 */
export function panFrame(frame, right, up) {
  const distance = Math.min(frame.range * PAN_FRACTION, MAX_PAN_M);
  const sin = Math.sin(frame.heading);
  const cos = Math.cos(frame.heading);
  // Screen up is the heading direction; screen right is 90 degrees clockwise.
  const east = distance * (up * sin + right * cos);
  const north = distance * (up * cos - right * sin);
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(frame.target);
  const moved = Cesium.Matrix4.multiplyByPoint(
    transform,
    new Cesium.Cartesian3(east, north, 0),
    new Cesium.Cartesian3(),
  );
  const before = Cesium.Cartographic.fromCartesian(frame.target);
  const after = Cesium.Cartographic.fromCartesian(moved);
  if (!before || !after) return frame;
  after.height = before.height;
  return { ...frame, target: Cesium.Cartographic.toCartesian(after) };
}

/**
 * D-pad and remote-control camera keys for TVs, which have no pointer.
 *
 * The globe owns the arrows while no control has focus. Arrows move the map;
 * OK switches between move and zoom (Up/Down zoom, Left/Right rotate); holding
 * OK hands the D-pad back to the on-screen controls. Back on a control returns
 * to the globe through {@link handleBack}, which the Android app calls.
 */
export function bindRemoteCameraKeys({
  viewer,
  documentRef = document,
  runNavigation = (_noun, navigate) => navigate(),
  showToast = () => {},
  now = () => performance.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  let mode = 'move';
  let destroyed = false;
  let hinted = false;
  let holdTimer = null;
  let holdStarted = 0;
  let heldToMenu = false;
  let lastControl = null;

  const container = () => viewer?.container;
  const isGlobeFocused = () => {
    const active = documentRef.activeElement;
    return (
      !active ||
      active === documentRef.body ||
      active === documentRef.documentElement ||
      Boolean(container()?.contains?.(active))
    );
  };
  const isFormControl = (element) =>
    Boolean(element?.matches?.('input, select, textarea, [contenteditable]'));

  const apply = (change) =>
    runNavigation('camera', () => {
      const frame = readCameraTargetFrame(viewer);
      return frame ? setCameraTargetFrame(viewer, change(frame)) : false;
    });

  const setMode = (next) => {
    mode = next;
    showToast(
      next === 'zoom'
        ? 'Zoom: ▲▼ zoom · ◀▶ rotate · OK to move'
        : 'Move: arrows pan · OK to zoom',
    );
  };

  const focusControls = () => {
    const visible = (element) =>
      element?.isConnected &&
      !element.disabled &&
      element.getClientRects?.().length > 0;
    const target = visible(lastControl)
      ? lastControl
      : [...documentRef.querySelectorAll(FOCUSABLE)].find(
          (element) => !container()?.contains?.(element) && visible(element),
        );
    target?.focus?.();
  };

  const onFocusIn = (event) => {
    if (!isGlobeFocused() && !isFormControl(event.target))
      lastControl = event.target;
  };

  const onKeyDown = (event) => {
    if (destroyed || event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key;
    const globe = isGlobeFocused();

    if (ZOOM_IN_KEYS.has(key) || ZOOM_OUT_KEYS.has(key)) {
      if (isFormControl(documentRef.activeElement)) return;
      event.preventDefault();
      apply((frame) =>
        zoomFrame(frame, ZOOM_IN_KEYS.has(key) ? ZOOM_FACTOR : 1 / ZOOM_FACTOR),
      );
      return;
    }
    if (!globe) return;

    if (key === 'Enter') {
      event.preventDefault();
      if (event.repeat || holdTimer !== null) return;
      heldToMenu = false;
      holdStarted = now();
      holdTimer = setTimer(() => {
        holdTimer = null;
        heldToMenu = true;
        focusControls();
      }, MENU_HOLD_MS);
      return;
    }
    if (!ARROWS.has(key)) return;
    event.preventDefault();
    if (!hinted) {
      hinted = true;
      showToast('Remote: arrows move · OK zoom mode · hold OK for menu');
    }
    if (mode === 'zoom') {
      if (key === 'ArrowUp') apply((frame) => zoomFrame(frame, ZOOM_FACTOR));
      else if (key === 'ArrowDown')
        apply((frame) => zoomFrame(frame, 1 / ZOOM_FACTOR));
      else
        apply((frame) =>
          rotateFrame(frame, key === 'ArrowRight' ? ROTATE_STEP : -ROTATE_STEP),
        );
      return;
    }
    const right = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
    const up = key === 'ArrowUp' ? 1 : key === 'ArrowDown' ? -1 : 0;
    apply((frame) => panFrame(frame, right, up));
  };

  const onKeyUp = (event) => {
    if (destroyed || event.key !== 'Enter') return;
    if (holdTimer === null) {
      heldToMenu = false;
      return;
    }
    clearTimer(holdTimer);
    holdTimer = null;
    if (!heldToMenu && now() - holdStarted < MENU_HOLD_MS)
      setMode(mode === 'move' ? 'zoom' : 'move');
  };

  /**
   * The remote's Back button. Returns true when the page used it: leaving zoom
   * mode, or returning from the on-screen controls to the globe. False means
   * the app may go back or close.
   */
  const handleBack = () => {
    if (destroyed) return false;
    const active = documentRef.activeElement;
    if (!isGlobeFocused()) {
      // Let an open panel close itself the way the Escape key would.
      const init = { key: 'Escape', bubbles: true, cancelable: true };
      const escape =
        typeof KeyboardEvent === 'function'
          ? new KeyboardEvent('keydown', init)
          : Object.assign(new Event('keydown', init), { key: 'Escape' });
      active.dispatchEvent(escape);
      if (!escape.defaultPrevented) active.blur?.();
      return true;
    }
    if (mode === 'zoom') {
      setMode('move');
      return true;
    }
    return false;
  };

  documentRef.addEventListener('keydown', onKeyDown);
  documentRef.addEventListener('keyup', onKeyUp);
  documentRef.addEventListener('focusin', onFocusIn);

  return {
    handleBack,
    get mode() {
      return mode;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (holdTimer !== null) clearTimer(holdTimer);
      documentRef.removeEventListener('keydown', onKeyDown);
      documentRef.removeEventListener('keyup', onKeyUp);
      documentRef.removeEventListener('focusin', onFocusIn);
    },
  };
}
