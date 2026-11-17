import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({console, URL, Date, Intl});
context.globalThis = context;
vm.runInContext(fs.readFileSync(new URL('../shared.js', import.meta.url), 'utf8'), context);
const normalize = value => ({...context.HumbleComicLibrary.normalizeSummaryPreferences(value)});

test('the bundle panel starts bottom left, clear of the right-hand column with Humble\'s tier choices and Add to Cart', () => {
  assert.deepEqual(normalize(undefined), {minimized: false, position: 'bottom-left'});
  assert.deepEqual(normalize({}), {minimized: false, position: 'bottom-left'});
  assert.deepEqual(normalize({position: 'centre'}), {minimized: false, position: 'bottom-left'});
});

test('a saved corner and minimized state are kept, including the earlier bottom-right default', () => {
  for (const position of ['bottom-right', 'bottom-left', 'top-right', 'top-left']) for (const minimized of [false, true])
    assert.deepEqual(normalize({position, minimized}), {minimized, position});
});
