import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualSettings } from './visualSettings.js';

// Just enough of a VisualSettings for the HUD part of a style preset.
function settingsWithHud(hudUserOverridden) {
  const modes = [];
  return {
    modes,
    settings: {
      services: { governorRequestRender() {} },
      stages: {},
      _detectionUserOverridden: true,
      _hudUserOverridden: hudUserOverridden,
      _setBloomEnabled() {},
      _setSharpenEnabled() {},
      _setHudVariant() {},
      _updateHudButtonState() {},
      hud: {
        getVariant: () => 'tactical',
        setMode: (mode) => modes.push(mode),
      },
    },
  };
}

test('a style preset shows the HUD until the user toggles it', () => {
  const { settings, modes } = settingsWithHud(false);
  VisualSettings.prototype._applyStylePresetDefaults.call(settings, 'thermal');
  assert.deepEqual(modes, ['on']);
});

test('a style preset keeps a HUD the user showed or hid by hand', () => {
  const { settings, modes } = settingsWithHud(true);
  VisualSettings.prototype._applyStylePresetDefaults.call(settings, 'thermal');
  assert.deepEqual(modes, []);
});
