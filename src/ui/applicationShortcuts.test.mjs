import test from 'node:test';
import assert from 'node:assert/strict';

import { bindApplicationShortcuts } from './applicationShortcuts.js';

function harness() {
  let listener;
  const calls = [];
  const documentRef = {
    addEventListener: (_type, fn) => (listener = fn),
    removeEventListener: () => {},
  };
  const record = (name) => () => calls.push(name);
  bindApplicationShortcuts({
    documentRef,
    searchInput: {},
    actions: {
      setStyle: (style) => calls.push(`style:${style}`),
      dismissSearch: record('dismissSearch'),
      toggleHud: record('toggleHud'),
      toggleOrbit: record('toggleOrbit'),
      toggleCleanView: record('toggleCleanView'),
      toggleLayers: record('toggleLayers'),
      cycleDetection: record('cycleDetection'),
      toggleCctv: record('toggleCctv'),
    },
  });
  const press = (key, extra = {}) => listener({ key, target: {}, ...extra });
  return { calls, press };
}

test('bare letter keys run their shortcut', () => {
  const { calls, press } = harness();
  press('c');
  press('H');
  assert.deepEqual(calls, ['toggleCctv', 'toggleHud']);
});

test('modifier combinations are left to the browser', () => {
  const { calls, press } = harness();
  press('c', { ctrlKey: true });
  press('c', { metaKey: true });
  press('f', { ctrlKey: true });
  press('d', { altKey: true });
  press('1', { ctrlKey: true });
  assert.deepEqual(calls, []);
});

test('typing in an editable element does not trigger shortcuts', () => {
  const { calls, press } = harness();
  press('c', { target: { isContentEditable: true } });
  assert.deepEqual(calls, []);
});
