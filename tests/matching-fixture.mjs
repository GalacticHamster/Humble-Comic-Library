import fs from 'node:fs';
import vm from 'node:vm';

// Mirrored policy fixture in HB/FAN; exercise shipped classification, never a
// reconstructed matcher. HB keeps the real storefront merge/count path here.
const fanatical = fs.existsSync(new URL('../src/shared.js', import.meta.url));
export function fixture(records, media, offered, central = null, historical = [], readSource = file => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')) {
  const context = { URL, Blob, Promise, setTimeout, clearTimeout, console, performance: { now: () => 0 },
    document: { title: '', querySelector: () => null, querySelectorAll: () => [] }, location: { pathname: '/' } };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of fanatical ? ['src/shared.js'] : ['shared.js', 'collection-mappings.js', 'ownership.js', 'content.js'])
    vm.runInContext(readSource(file), context, { filename: file });
  context.records = records.map(record => ({ ...record, [fanatical ? 'mediaType' : 'kind']: record.media ?? media }));
  context.historical = historical.map(record => ({ ...record, ...(fanatical && record.sourceBundle ? {bundle:{title:record.sourceBundle}} : {}), [fanatical ? 'mediaType' : 'kind']: record.media ?? media }));
  context.offered = { ...offered, [fanatical ? 'mediaType' : 'kind']: media, lookupTitle: offered.title, tier: { label: '$5 tier', price: 5 } };
  context.centralResult = central instanceof Error ? { matches: [], lookupIncomplete: true } : central;
  if (!fanatical) {
    context.central = central;
    context.chrome = { runtime: { sendMessage: async (_id, message) => {
      if (central instanceof Error) throw central;
      if (message.type === 'GET_STATUS') return {ok:true,apiVersion:1,capabilities:{mediaTypes:['game','book','audiobook','software']}};
      return { ok: true, apiVersion: 1, results: message.items.map(({ requestId }) => ({ requestId, matches: [], ...central })) };
    } } };
    vm.runInContext(
      "collectBundleItems = () => [offered]; sortBundleItems = () => ({}); annotateAllCoverCopies = () => {}; " +
      "applyBundleNewItemsOnlyFilter = () => {}; showComparisonProgress = () => {}; " +
      "renderComparisonSummary = (counts, tiers) => { summary = { counts, tiers: [...tiers.values()] }; }; " +
      "comparison = { job: 1, galactic: createGalacticLookup(central ? 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' : '') };", context);
  }
  return {
    context,
    async classify() {
      const match = fanatical ? vm.runInContext('FanaticalLibrary.resolveProduct(offered, records, FanaticalLibrary.localContents(records), () => centralResult, 0, historical)', context)
        : (await vm.runInContext("renderBundleComparison(createBundleLibraryMatcher(records, offered.kind, historical), offered.kind, [], [], comparison, 1)", context),
          context.comparison.resolvedItems[0].match);
      const candidates = [...(Array.isArray(match.item) ? match.item : match.item ? [match.item] : []), ...(match.candidates ?? []),
        ...(match.externalPossibleMatches ?? [])];
      return { match, candidates };
    }
  };
}
