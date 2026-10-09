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

// Full synthetic catalogue boundary, shared by the cross-companion context tests.
export function bundleFixture(offers, records=[], responses={}, options={}) {
  const f=fixture(records, offers[0]?.mediaType||offers[0]?.kind||'book', offers[0]||{title:'Empty'},null,[],options.readSource);
  const c=f.context;
  const media=offers[0]?.mediaType||offers[0]?.kind||'book';
  c.offers=offers.map((item,index)=>({...item,[fanatical?'mediaType':'kind']:item.mediaType||item.kind||media,lookupTitle:item.title,tier:{label:'$5 tier',price:5},...(fanatical?{sourceItemId:item.sourceItemId||'offer-'+index}:{})}));
  c.responses=responses;
  if(!fanatical){
    const page={bundleData:{tier_item_data:Object.fromEntries(c.offers.map((item,index)=>['offer-'+index,{human_name:item.title,...item}])),tier_display_data:{all:{tier_item_machine_names:c.offers.map((_,index)=>'offer-'+index)}}}};
    c.document.querySelector=selector=>selector==='#webpack-bundle-page-data'&&!options.incomplete?{textContent:JSON.stringify(page)}:null;
    c.chrome.runtime.sendMessage=async(_id,message)=>message.type==='GET_STATUS'?{ok:true,apiVersion:1,capabilities:{mediaTypes:['book','game','software','audiobook']}}:{ok:true,apiVersion:1,results:message.items.filter(item=>!(responses[item.title] instanceof Error)).map(item=>({requestId:item.requestId,matches:[],possibleMatches:[],partialMatches:[],...responses[item.title]}))};
    vm.runInContext("collectBundleItems=()=>offers;comparison={job:1,galactic:createGalacticLookup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')};",c);
  }
  return {context:c,P:(fanatical?c.FanaticalLibrary:c.HumbleOwnership).presentation,async classify(){
    if(!fanatical){await vm.runInContext('renderBundleComparison(createBundleLibraryMatcher(records,offers[0].kind),offers[0].kind,[],[],comparison,1)',c);return c.comparison.resolvedItems;}
    return c.offers.map(item=>({item,match:c.FanaticalLibrary.resolveProduct(item,c.records,c.FanaticalLibrary.localContents(c.records),query=>responses[query.title] instanceof Error?{matches:[],lookupIncomplete:true}:responses[query.title]||{matches:[]})}));
  }};
}
