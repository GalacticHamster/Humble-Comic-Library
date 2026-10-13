import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {checkTitleSorting} from './natural-title-sort-fixture.mjs';
test('shared natural title sorting preserves unrelated title and identity text',()=>{
  const source=fs.readFileSync(new URL('../shared.js',import.meta.url),'utf8').match(/\/\/ BEGIN SHARED NATURAL TITLE SORT[\s\S]*?\/\/ END SHARED NATURAL TITLE SORT/u)?.[0];assert(source);
  const context=vm.createContext({Intl});vm.runInContext(source,context);checkTitleSorting(context.LibraryTitleSort,assert);
});
