import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = {
  Blob, URL, clearTimeout, console,
  document: { title: '' },
  location: { pathname: '/' },
  performance: { now: () => 0 },
  Promise, setTimeout
};
context.globalThis = context;
vm.createContext(context);
for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
}

test('exact Galactic records with uncertain or temporary access require ownership review', () => {
  const matches = [
    { provider: 'kindle', ownership: 'unknown' },
    { provider: 'audible', ownership: 'subscription' },
    { provider: 'kindle', ownership: 'borrowed' },
    { provider: 'kindle', ownership: 'rental' },
    { provider: 'humble', ownership: 'unknown' }
  ];
  context.reviewResult = { matches };
  const review = vm.runInContext('needsOwnershipReviewOutsideHumble(reviewResult)', context);
  assert.equal(review.length, 4);
  assert.equal(vm.runInContext('ownedOutsideHumble(reviewResult).length', context), 0);
});

test('confirmed ownership remains an owned match', () => {
  context.reviewResult = { matches: [
    { provider: 'kindle', ownership: 'unknown' },
    { provider: 'fanatical', ownership: 'owned' }
  ] };
  assert.equal(vm.runInContext('ownedOutsideHumble(reviewResult).length', context), 1);
});
