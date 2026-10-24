// Check of the render quality presets (settingSlice.js): node src/store/slices/settingSlice.check.mjs
import assert from 'node:assert/strict';
import { autoLadder, createSettingsSlice, QUALITY_PRESETS } from './settingSlice.js';

// minimal zustand-like store over the slice (no localStorage in node: the slice falls back to defaults)
let state;
const set = (update) => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
state = createSettingsSlice(set);

// default: Auto, starting at High
assert.equal(state.settings.renderPreset, 'auto');
assert.equal(state.settings.ssr, true);

// Auto ladder (MAX_DPR is 1 in node, no window): effects only, High -> Medium -> Low, then nothing
assert.deepEqual(autoLadder(state.settings), [['high', 1], ['medium', 1], ['low', 1]]);
assert.equal(state.stepAuto(1), true);
assert.deepEqual([state.settings.ssgi, state.settings.ssr], [true, false]); // Medium
assert.equal(state.stepAuto(1), true);
assert.equal(state.settings.ssgi, false); // Low
assert.equal(state.stepAuto(1), false); // nothing left to lower
assert.equal(state.settings.renderPreset, 'auto');
// and back up, one step at a time
assert.equal(state.stepAuto(-1), true);
assert.deepEqual([state.settings.ssgi, state.settings.ssr], [true, false]); // Medium again
assert.equal(state.stepAuto(-1), true);
assert.equal(state.settings.ssr, true); // High
assert.equal(state.stepAuto(-1), false); // already at the top

// a named preset applies its switches; Auto does not step it
state.setRenderPreset('high');
assert.equal(state.settings.ssr, QUALITY_PRESETS.high.values.ssr);
state.stepAuto(1);
assert.equal(state.settings.ssr, true);

// forced resolution is validated; the auto ratio is never saved as a setting
state.setRenderResolution('1.5');
assert.equal(state.settings.renderResolution, '1.5');
state.setRenderResolution('4');
assert.equal(state.settings.renderResolution, '1.5');

// a switch changed by hand -> Custom; intensities do not touch the preset
state.setRenderSetting('giIntensity', 6);
assert.equal(state.settings.renderPreset, 'high');
state.toggleRenderSetting('ssr');
assert.equal(state.settings.renderPreset, 'custom');

// invalid values are ignored
state.setRenderSetting('giIntensity', 999);
assert.equal(state.settings.giIntensity, 6);
state.setRenderPreset('ultra');
assert.equal(state.settings.renderPreset, 'custom');

console.log('ok');
