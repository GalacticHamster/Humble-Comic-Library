import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = { URL }; context.globalThis = context; vm.createContext(context);
for (const file of ['shared.js', 'collection-mappings.js', 'ownership.js']) vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context);
const O = context.HumbleOwnership; const H = context.HumbleComicLibrary;
const unit = (number, overrides = {}) => ({ series: 'Manga', run: '2000', unitType: 'volume', number: String(number), language: 'en', completeness: 'full', ...overrides });
const row = (title, price, state = 'new', missing = [], possibleCovered = []) => ({ item: { title, kind: 'book', tier: { price } }, match: { state, coverage: { missing, possibleCovered } } });

test('overlapping collections count new units once; lower tier can satisfy all contents despite a higher duplicate edition', () => {
  const rows = [row('First collection', 5, 'partial', [unit(3), unit(4)]), row('Second collection', 15, 'partial', [unit(3), unit(4)])];
  const plan = O.planBundle(rows, [], 'contents');
  assert.equal(plan.goalCount, 2);
  assert.equal(plan.lowest.price, 5);
  assert.equal(plan.tiers[1].newUnits, 2);
  assert.equal(plan.tiers[1].addedUnits, 0);
  assert.equal(plan.tiers[0].costPerNewUnit, 2.5);
  assert.equal(plan.tiers[1].marginalCostPerUnit, null);
});

test('confirmed-new products and weighted wishlist goals choose their own lowest cumulative tier', () => {
  const rows = [row('Low book', 5), row('High book', 15), row('Owned book', 15, 'owned')];
  const wanted = [{ title: 'Low book', kind: 'book', weight: 3 }, { title: 'Owned book', kind: 'book', weight: 100 }];
  assert.equal(O.planBundle(rows, wanted, 'items').lowest.price, 15);
  const plan = O.planBundle(rows, wanted, 'wishlist');
  assert.equal(plan.lowest.price, 5);
  assert.equal(plan.goalCount, 1);
  assert.equal(plan.tiers[1].wishlistValue, 3);
  assert.equal(plan.tiers[1].wishlistCount, 1);
  assert.equal(plan.tiers[0].newUnits, 0, 'Unknown contents get no invented unit value');
});

test('uncertain matches require explicit selection and never change ownership or confirm uncertain unit coverage', () => {
  const rows = [row('Low book', 5), row('Possible edition', 15, 'possible', [unit(3)], [unit(3)]), row('Unknown range', 15, 'partial', [unit(4, { run: '' })])];
  assert.equal(O.planBundle(rows, [], 'items').lowest.price, 5);
  assert.equal(O.planBundle(rows, [], 'items', true).lowest.price, 15);
  assert.equal(O.planBundle(rows, [], 'contents', true).goalCount, 0);
  assert.equal(rows[1].match.state, 'possible');
});

test('fractional unit aliases deduplicate; different runs and languages remain separate goals', () => {
  const plan = O.planBundle([row('A', 5, 'partial', [unit('1/2'), unit('0.5'), unit('0.5', { run: '2021' }), unit('0.5', { language: 'ja' })])], [], 'contents');
  assert.equal(plan.goalCount, 3);
  assert.equal(plan.tiers[0].newUnits, 3);
});

test('unknown tier prices cannot produce a falsely satisfied plan; empty or unoffered wishlist is explicit', () => {
  const rows = [row('Known', 5), row('Unknown', null)];
  assert.equal(O.planBundle(rows, [], 'items').lowest, null);
  assert.equal(O.planBundle(rows, [], 'wishlist').goalCount, 0);
  assert.equal(O.planBundle(rows, [{ title: 'Outside bundle', kind: 'book' }], 'wishlist').goalCount, 0);
});

test('wishlist validation bounds priorities and preserves media/edition identity without secrets', () => {
  const wanted = H.normalizeWishlist([{ title: 'Work', kind: 'audiobook', weight: 7, isbn: ['9780306406157'], purchaseKey: 'secret' }]);
  assert.equal(wanted[0].purchaseKey, undefined);
  assert.equal(O.wishlistMatches(wanted[0], { title: 'Work', kind: 'book', isbn: ['9780306406157'] }), false);
  assert.equal(O.wishlistMatches(wanted[0], { title: 'Work', kind: 'audiobook', isbn: ['9780140328721'] }), false);
  assert.equal(O.wishlistMatches(wanted[0], { title: 'Work', kind: 'audiobook' }), false);
  assert.equal(O.wishlistMatches(wanted[0], { title: 'Work', kind: 'audiobook', isbn: ['9780306406157'] }), true);
  for (const invalid of [{ title: '' }, { title: 'X', weight: 0 }, { title: 'X', weight: 101 }, { title: 'X', weight: 1.5 }, { title: 'X', kind: 'unknown' }]) assert.throws(() => H.normalizeWishlist([invalid]));
});
