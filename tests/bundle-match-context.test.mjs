import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {bundleFixture} from './matching-fixture.mjs';
const root=new URL('../',import.meta.url),hb=fs.existsSync(new URL('ownership.js',root));
const ctx={URL,document:{querySelector:()=>null,querySelectorAll:()=>[]},location:{pathname:'/'}};ctx.globalThis=ctx;vm.createContext(ctx);
for(const file of hb?['shared.js','collection-mappings.js','ownership.js','content.js']:['src/shared.js'])vm.runInContext(fs.readFileSync(new URL(file,root),'utf8'),ctx);
const P=(hb?ctx.HumbleOwnership:ctx.FanaticalLibrary).presentation;
const original='Beneath the Trees Where Nobody Sees',sequel=original+': Rite of Spring';
const book=title=>({title,kind:'book',mediaType:'book'});
const record=(title=original,ownership='owned',extra={})=>({title,provider:'kindle',itemRef:'original-ref',ownership,relationship:'same-edition',reason:'Matching full book title with no conflicting identity evidence',...extra});
const strong=record(),weak=record(original,'owned',{relationship:'same-work',reason:'Related title or edition; compare the owned and offered titles.'}),subscription=record(sequel,'subscription',{itemRef:'sequel-ref'});
function rows(second={}){return [{item:book(original),match:{state:hb?'elsewhere':'owned-elsewhere',externalMatches:[strong],externalResult:{matches:[strong]}}},{item:book(sequel),match:{state:'possible',ownershipReview:true,externalPossibleMatches:[subscription,weak],externalResult:{matches:[],possibleMatches:[subscription,weak]},...second}}];}
const freeze=v=>{if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);Object.values(v).forEach(freeze);}return v;};
test('core example: same-title subscription stays primary, original suggestion moves to details without changing matches',()=>{
 const input=freeze(rows()),before=JSON.stringify(input),summary=JSON.stringify(P.summary(input));
 assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,1);
 assert.deepEqual(Array.from(P.primaryCandidateViews(input[1].item,input[1].match),v=>v.title),[sequel]);
 assert.equal(P.candidateViews(input[1].item,input[1].match).length,2);
 assert.match(P.explanation(input[1].item,input[1].match),/subscription access/);
 assert.equal(P.status(input[1].item,input[1].match),'Check ownership');
 assert.equal(P.status(input[0].item,input[0].match),'Owned elsewhere');
 assert.doesNotMatch(P.relatedCaption(input[1].item,input[1].match),/\+1 more/);
 assert.equal(JSON.stringify(input),before);assert.equal(JSON.stringify(P.summary(input)),summary);
});
test('real classification/merge boundary with complete catalogue preserves original ownership and subscription review',async()=>{
 const f=bundleFixture([book(original),book(sequel)],[],{[original]:{matches:[strong]},[sequel]:{matches:[],possibleMatches:[subscription,weak]}});
 const resolved=await f.classify(),before=JSON.stringify(resolved),summary=JSON.stringify(f.P.summary(resolved));
 assert.equal(f.P.reconcileBundle(resolved,{complete:true}).deferredCount,1);
 assert.equal(f.P.status(resolved[0].item,resolved[0].match),'Owned elsewhere');assert.equal(f.P.status(resolved[1].item,resolved[1].match),'Check ownership');
 assert.equal(f.P.primaryCandidateViews(resolved[1].item,resolved[1].match).length,1);
 assert.equal(JSON.stringify(resolved),before);assert.equal(JSON.stringify(f.P.summary(resolved)),summary);
});
test('missing exact companion / no strong evidence never selects a winner',()=>{
 const lone=rows().slice(1);assert.equal(P.reconcileBundle(lone,{complete:true}).deferredCount,0);
 const input=rows();input[0].match={state:'possible',externalPossibleMatches:[weak]};assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,0);
});
test('only-deferred candidate retains Possible and review guidance',()=>{const input=rows({ownershipReview:false,externalPossibleMatches:[weak],externalResult:{possibleMatches:[weak]}});P.reconcileBundle(input,{complete:true});assert.equal(P.status(input[1].item,input[1].match),'Possible');assert.match(P.explanation(input[1].item,input[1].match),/Match details/);assert.match(P.relatedCaption(input[1].item,input[1].match),/Match details/);});
test('duplicate products and tier repetitions retain all strong/related evidence',()=>{const input=rows();input[1].item=book(original);assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,0);const repeated=rows();repeated[1].item.sourceItemId='same-product';repeated[0].item.sourceItemId='same-product';assert.equal(P.reconcileBundle(repeated,{complete:true}).deferredCount,0);});
for(const [name,alter]of [
 ['PDF/EPUB',input=>{input[1].item.format='EPUB';input[0].item.format='PDF';}],
 ['standard/deluxe',input=>{input[1].item=book(original+' Deluxe Edition');}],
 ['explicit alternate editions',input=>{input[1].item.edition='2';}],
 ['omnibus and issues',input=>{input[1].item.contents=[{series:'Example',number:'1',unitType:'issue'}];input[1].match.coverage={total:2,owned:1,covered:[{evidence:[strong]}]};}],
 ['mapped collection',input=>{input[1].target={entries:[{number:'1'}]};}],
 ['software suite/component',input=>{input[0].item.kind=input[1].item.kind='software';input[1].item.components=[{title:'Component'}];}],
 ['shared identifiers',input=>{input[1].item.isbn=['9780306406157'];input[1].match.externalPossibleMatches=[{...weak,evidence:{isbn:['9780306406157']}}];input[1].match.externalResult={};}],
 ['numbered works',input=>{input[1].item.volume='2';}],
 ['independent same-edition evidence',input=>{input[1].match.externalPossibleMatches=[{...weak,relationship:'same-edition'}];input[1].match.externalResult={};}],
 ['manual same-work',input=>{input[1].match.externalPossibleMatches=[{...weak,reason:'Reviewed same-work relationship.'}];input[1].match.externalResult={};}],
 ['manual different-works barrier',input=>{input[1].match={state:'new',externalResult:{matches:[],possibleMatches:[]}};}],
 ['unknown candidate reason',input=>{input[1].match.externalPossibleMatches=[{...weak,reason:'Unspecified candidate'}];input[1].match.externalResult={};}],
 ['history',input=>{input[1].match.externalPossibleMatches=[{...weak,historical:true}];input[1].match.externalResult={};}]
])test(name+' is never deprioritized',()=>{const input=rows();alter(input);assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,0);});
test('record/account isolation: same title is not a canonical identifier',()=>{const input=rows();input[1].match.externalPossibleMatches=[subscription,{...weak,itemRef:'other-account-ref'}];input[1].match.externalResult={};assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,0);});
test('strong subscription/borrowed identity can anchor without claiming ownership',()=>{for(const ownership of ['subscription','borrowed','rental','unknown']){const input=rows();input[0].match={state:'possible',ownershipReview:true,externalPossibleMatches:[{...strong,ownership}]};assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,1);assert.equal(input[0].match.state,'possible');}});
test('incomplete bundle or any failed request preserves independent results and resets previous projection',()=>{const input=rows();assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,1);assert.equal(P.reconcileBundle(input,{complete:false}).deferredCount,0);input[0].match.lookupIncomplete=true;assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,0);delete input[0].match.lookupIncomplete;input[1].match.contentsLookupIncomplete=true;assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,0);});
test('order, batch boundaries and repeat reconciliation give the same primary records',()=>{const input=rows(),serialize=list=>Object.fromEntries(list.map(({item,match})=>[item.title,Array.from(P.primaryCandidateViews(item,match),v=>[v.title,v.access])]));P.reconcileBundle(input,{complete:true});const expected=serialize(input);assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,1);assert.deepEqual(serialize(input),expected);input.reverse();P.reconcileBundle(input,{complete:true});assert.deepEqual(serialize(input),expected);const split=rows();P.reconcileBundle(split.slice(0,1),{complete:false});P.reconcileBundle(split.slice(1),{complete:false});P.reconcileBundle(split,{complete:true});assert.deepEqual(serialize(split),expected);});
test('actual complete-catalogue gate rejects missing, dropped and partial context',async()=>{
 if(hb){const f=bundleFixture([book(original),book(sequel)],[],{}, {incomplete:true});await f.classify();assert.equal(vm.runInContext('completeBundleMatchContext(comparison.resolvedItems,bundleMediaContext())',f.context),false);const complete=bundleFixture([book(original),book(sequel)]);await complete.classify();assert.equal(vm.runInContext('completeBundleMatchContext(comparison.resolvedItems,bundleMediaContext())',complete.context),true);complete.context.comparison.resolvedItems.pop();assert.equal(vm.runInContext('completeBundleMatchContext(comparison.resolvedItems,bundleMediaContext())',complete.context),false);}
 else{const F=ctx.FanaticalLibrary,raw={_id:'bundle',name:'Synthetic',bundles:[{games:[{_id:'a',name:original,type:'book'},{_id:'b',name:sequel,type:'book'}]}]};assert.equal(F.isCompleteBundleCatalogue(F.parseBundle(raw)),true);for(const input of [{...raw,hasMore:true},{...raw,pagination:{}},{...raw,bundles:[{games:[...raw.bundles[0].games,{_id:'bad'}]}]},{...raw,bundles:{}},{...raw,bundles:[]}])assert.equal(F.isCompleteBundleCatalogue(F.parseBundle(input)),false);assert.equal(F.isCompleteBundleCatalogue(JSON.parse(JSON.stringify(F.parseBundle(raw)))),false);}
});

test('local exact purchase is an anchor only for the same active record object',async()=>{const f=bundleFixture([book(original),book(sequel)],[{title:original,source:"humble",sourceBundle:'Synthetic purchase',bundle:{title:'Synthetic purchase'}}]);const resolved=await f.classify();const before=JSON.stringify(resolved);assert.equal(resolved[0].match.state,'owned');assert.equal(resolved[1].match.state,'possible');assert.equal(f.P.reconcileBundle(resolved,{complete:true}).deferredCount,1);assert.equal(JSON.stringify(resolved),before);});

test('explicit format metadata survives catalogue projection without changing product data',()=>{
 if(!hb){const F=ctx.FanaticalLibrary,raw={_id:'formats',name:'Formats',bundles:[{games:[{_id:'a',name:original,type:'book',format:'PDF'},{_id:'b',name:sequel,type:'book',formats:['EPUB']}]}]},parsed=F.parseBundle(raw);assert.equal(F.isBundleOverlapProduct(parsed.products[0]),true);assert.equal(F.isBundleOverlapProduct(parsed.products[1]),true);assert.equal('format' in parsed.products[0],false);const input=rows();input.forEach((row,i)=>row.overlapProtected=F.isBundleOverlapProduct(parsed.products[i]));assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,0);}
 else {const input=rows();input[1].overlapProtected=true;assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,0);}
});
test('unfinished state and unrelated storefront sessions cannot reuse a deferred candidate',()=>{const input=rows();P.reconcileBundle(input,{complete:true});const isolated=rows().slice(1);assert.equal(P.primaryCandidateViews(isolated[0].item,isolated[0].match).length,2);input[0].match.state='unchecked';assert.equal(P.reconcileBundle(input,{complete:true}).deferredCount,0);});
