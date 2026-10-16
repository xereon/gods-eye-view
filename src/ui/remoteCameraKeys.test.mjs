import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  MAX_RANGE_M,
  MENU_HOLD_MS,
  MIN_RANGE_M,
  ROTATE_STEP,
  ZOOM_FACTOR,
  bindRemoteCameraKeys,
  panFrame,
  rotateFrame,
  zoomFrame,
} from './remoteCameraKeys.js';

const frameAt = (lon, lat, { heading = 0, range = 10_000 } = {}) => ({
  target: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
  heading,
  pitch: Cesium.Math.toRadians(-89),
  range,
});

const degrees = (cartesian) => {
  const c = Cesium.Cartographic.fromCartesian(cartesian);
  return [
    Cesium.Math.toDegrees(c.longitude),
    Cesium.Math.toDegrees(c.latitude),
  ];
};

test('zoomFrame scales the range and stays inside the limits', () => {
  assert.equal(zoomFrame(frameAt(0, 0), ZOOM_FACTOR).range, 7_000);
  assert.equal(zoomFrame(frameAt(0, 0, { range: 35 }), 0.5).range, MIN_RANGE_M);
  assert.equal(
    zoomFrame(frameAt(0, 0, { range: MAX_RANGE_M }), 2).range,
    MAX_RANGE_M,
  );
});

test('rotateFrame turns the heading by the step', () => {
  assert.equal(rotateFrame(frameAt(0, 0), ROTATE_STEP).heading, ROTATE_STEP);
});

test('panFrame moves the target in screen directions for the heading', () => {
  const [, northLat] = degrees(panFrame(frameAt(0, 0), 0, 1).target);
  assert.ok(northLat > 0.005, 'up moves north when north is up');
  const [eastLon] = degrees(panFrame(frameAt(0, 0), 1, 0).target);
  assert.ok(eastLon > 0.005, 'right moves east when north is up');
  // Facing east, screen up is east.
  const facingEast = frameAt(0, 0, { heading: Cesium.Math.PI_OVER_TWO });
  const [upLon, upLat] = degrees(panFrame(facingEast, 0, 1).target);
  assert.ok(upLon > 0.005 && Math.abs(upLat) < 1e-6);
  const height = Cesium.Cartographic.fromCartesian(
    panFrame(frameAt(10, 50), 1, 1).target,
  ).height;
  assert.ok(Math.abs(height) < 1e-3, 'target stays on the ground');
});

class FakeElement extends EventTarget {
  constructor(documentRef, { form = false } = {}) {
    super();
    this.documentRef = documentRef;
    this.form = form;
    this.isConnected = true;
    this.disabled = false;
  }
  matches(selector) {
    return this.form && selector.includes('input');
  }
  getClientRects() {
    return [{}];
  }
  focus() {
    this.documentRef.activeElement = this;
  }
  blur() {
    this.documentRef.activeElement = this.documentRef.body;
  }
}

function setup() {
  const documentRef = new EventTarget();
  documentRef.body = new FakeElement(documentRef);
  documentRef.documentElement = {};
  documentRef.activeElement = documentRef.body;
  const button = new FakeElement(documentRef);
  documentRef.querySelectorAll = () => [button];
  // No camera: the key handling is under test here, the frame maths above.
  const viewer = { container: { contains: () => false } };
  const timers = [];
  const toasts = [];
  let clock = 0;
  const keys = bindRemoteCameraKeys({
    viewer,
    documentRef,
    showToast: (text) => toasts.push(text),
    now: () => clock,
    setTimer: (fn) => timers.push(fn) - 1,
    clearTimer: (id) => (timers[id] = null),
  });
  const press = (key, type = 'keydown', extra = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      key,
      ...extra,
    });
    documentRef.dispatchEvent(event);
    return event;
  };
  return {
    keys,
    documentRef,
    button,
    toasts,
    timers,
    press,
    advance: (ms) => (clock += ms),
  };
}

test('arrows on the globe are claimed; arrows on a control are not', () => {
  const t = setup();
  assert.equal(t.press('ArrowUp').defaultPrevented, true);
  assert.match(t.toasts[0], /hold OK for menu/);
  t.button.focus();
  assert.equal(t.press('ArrowUp').defaultPrevented, false);
  t.keys.destroy();
});

test('OK toggles zoom mode and a held OK hands focus to the controls', () => {
  const t = setup();
  t.press('Enter');
  t.advance(100);
  t.press('Enter', 'keyup');
  assert.equal(t.keys.mode, 'zoom');
  t.press('Enter');
  t.timers.at(-1)();
  t.press('Enter', 'keyup');
  assert.equal(t.keys.mode, 'zoom', 'a long press does not toggle the mode');
  assert.equal(t.documentRef.activeElement, t.button);
  assert.ok(MENU_HOLD_MS > 100);
  t.keys.destroy();
});

test('Back leaves a control, then zoom mode, then lets the app close', () => {
  const t = setup();
  t.press('Enter');
  t.press('Enter', 'keyup');
  t.button.focus();
  let escapes = 0;
  t.button.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') escapes++;
  });
  assert.equal(t.keys.handleBack(), true);
  assert.equal(escapes, 1);
  assert.equal(t.documentRef.activeElement, t.documentRef.body);
  assert.equal(t.keys.handleBack(), true);
  assert.equal(t.keys.mode, 'move');
  assert.equal(t.keys.handleBack(), false);
  t.keys.destroy();
});

test('zoom keys work from controls but not while typing', () => {
  const t = setup();
  t.button.focus();
  assert.equal(t.press('ChannelUp').defaultPrevented, true);
  const input = new FakeElement(t.documentRef, { form: true });
  input.focus();
  assert.equal(t.press('-').defaultPrevented, false);
  t.keys.destroy();
  t.documentRef.body.focus();
  assert.equal(t.press('ArrowUp').defaultPrevented, false, 'destroy unbinds');
});
