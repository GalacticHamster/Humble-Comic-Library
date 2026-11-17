import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({console, URL, Date, Intl});
context.globalThis = context;
vm.runInContext(fs.readFileSync(new URL('../shared.js', import.meta.url), 'utf8'), context);
const normalize = value => ({...context.HumbleComicLibrary.normalizeSummaryPreferences(value)});

test('the bundle panel starts bottom right when no corner is saved', () => {
  assert.deepEqual(normalize(undefined), {minimized: false, position: 'bottom-right'});
  assert.deepEqual(normalize({}), {minimized: false, position: 'bottom-right'});
  assert.deepEqual(normalize({position: 'centre'}), {minimized: false, position: 'bottom-right'});
});

test('a saved corner and minimized state are kept', () => {
  for (const position of ['bottom-right', 'bottom-left', 'top-right', 'top-left']) for (const minimized of [false, true])
    assert.deepEqual(normalize({position, minimized}), {minimized, position});
});
