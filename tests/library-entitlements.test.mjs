import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,row,child,copy,accountId} from './library-entitlements-fixture.mjs';
import {fixture as matchingFixture} from './matching-fixture.mjs';
import fs from 'node:fs';
import vm from 'node:vm';

const legacy={libraryItems:[{title:'Old',kind:'book',source:'humble',purchaseKey:'old',manualKind:'book'}],purchaseSummaries:[{purchaseKey:'old',itemCount:1}],historicalLibraryItems:[{title:'Earlier',purchaseKey:'earlier'}],historicalPurchaseSummaries:[{purchaseKey:'earlier'}],mediaTypeOverrides:{old:'book'},keyReminders:[],lastImport:{reconciled:true}};
const observations=f=>f.stored.libraryEntitlements.scopes[0].observations;
test('disabled collector and writer cannot start, fetch or alter storage',async()=>{
  const f=fixture({enabled:false});await assert.rejects(f.collect(),/not enabled/);await assert.rejects(f.store('entitlementBegin',{confirmed:true,scope:{principalId:'a',userId:'b'}}),/not enabled/);assert.equal(f.requests.length,0);assert.equal(f.writes.length,0);
});
test('actual acquisition -> serialized writer is additive, stable and preserves legacy/corrections/history',async()=>{
  const f=fixture({initial:legacy});const first=await f.collect();assert.equal(first.saved,8);assert.equal(first.scan.coverage,'accessible-pages-traversed');assert.equal(first.scan.historicalComplete,false);
  for(const [k,v]of Object.entries(legacy))assert.deepEqual(f.stored[k],v);
  await f.collect();assert.equal(observations(f).length,8);assert(observations(f).every(v=>v.admission==='humble-key-entitlement'&&v.activationStatus==='unknown'));
  assert(!JSON.stringify(f.stored).includes('SYNTHETIC_SECRET'));assert(!JSON.stringify(f.stored).includes('SYNTHETIC_PRIVATE_ACCOUNT'));
  assert(observations(f).every(v=>!('purchaseKey'in v)&&!('purchasedAt'in v)));
});
test('DRM-free admission is explicit; unknown media cannot become a book by default',async()=>{
  const f=fixture({rows:[row('drm','Synthetic DRM','download_drm_free')]});await f.collect();assert.equal(observations(f)[0].admission,'personal-drm-free-entitlement');assert.equal(observations(f)[0].mediaType,'unknown');assert.equal(f.E.matchingItems(f.stored).length,0);
});
for(const [field,value]of [['expired',true],['preOrdered',true],['outOfStock',true],['redeemable',false],['giftStatus','gifted'],['directRedeem',true],['directRedeem',undefined],['keyIntegrationId','unverified'],['unavailableAfter','2099-01-01T00:00:00.000Z'],['expired',undefined]])test(`unknown/restricted ${field}:${value} stays observation-only`,async()=>{
  const c=child('a');if(value===undefined)delete c[field];else c[field]=value;const f=fixture({rows:[row('a')],children:[c]});await f.collect();assert.equal(observations(f)[0].admission,'observation-only');
});
for(const parent of [{preOrder:true},{preOrder:undefined}])test('unknown or true parent preorder stays observation-only',async()=>{const f=fixture({parent});await f.collect();assert(observations(f).every(r=>r.admission==='observation-only'));});
test('choices, missing group evidence and subscription scopes do not gain Owned authority',async()=>{
  for(const entitlements of [{redemptionGroups:[{state:'AVAILABLE'}]},{redemptionGroups:undefined}]){const f=fixture({entitlements});await f.collect();assert(observations(f).every(r=>r.admission==='observation-only'));}
  const f=fixture({rows:[row('s','Subscription','subscriptioncontent')]});await f.collect();assert.equal(observations(f)[0].admission,'observation-only');
});
test('same title distinct IDs are preserved, presentation grouped, identifiers never title-derived',async()=>{
  const f=fixture({rows:[row('a'),row('b')]});await f.collect();assert.equal(observations(f).length,2);const matches=f.E.matchingItems(f.stored);assert.equal(matches.length,1);assert.equal(matches[0].libraryObservationRefs.length,2);assert(!matches[0].purchaseKey);
  const renamed=fixture({initial:f.stored,rows:[row('a','Renamed game')]});await renamed.collect();assert.equal(observations(renamed).length,2);assert.equal(observations(renamed).find(v=>v.nativeId==='a').title,'Renamed game');
});
test('overlapping pages deduplicate while conflicting IDs cannot replace saved observations',async()=>{
  const rows=Array.from({length:10},(_,i)=>row('id-'+i,'Game '+i));const pages=[rows.slice(0,5),[rows[4],...rows.slice(5,9)]];
  const f=fixture({rows,pages});await f.collect();assert.equal(observations(f).length,9);assert.equal(f.stored.libraryEntitlements.scopes[0].lastScan.duplicateItems,1);
  const bad=[rows.slice(0,5),[{...rows[4],title:'Conflicting'},...rows.slice(5,9)]];
  const g=fixture({initial:f.stored,rows,pages:bad});await g.collect();assert.equal(observations(g).find(r=>r.nativeId==='id-4').title,'Game 4');assert.equal(g.stored.libraryEntitlements.scopes[0].lastScan.conflictingItems,1);
});
test('late page failure and truncated responses retain verified items but not complete coverage',async()=>{
  for(const extra of [{failPage:2},{truncate:2}]){const f=fixture(extra);const r=await f.collect();assert.equal(r.saved,5);assert.equal(r.scan.coverage,'incomplete');assert.equal(r.scan.acquisition,'partial');assert.equal(r.scan.historicalComplete,false);}
});
test('bounded scans do not stop at known IDs, pagination loops and inconsistent totals are partial',async()=>{
  const f=fixture();await f.collect({pageLimit:1});assert.equal(observations(f).length,5);const n=f.requests.length;await f.collect({pageLimit:2});assert.equal(observations(f).length,8);assert.equal(f.requests.slice(n).filter(r=>r.method==='POST').length,2);
  const rows=Array.from({length:10},(_,i)=>row('loop-'+i));const g=fixture({rows,pages:[rows.slice(0,5),rows.slice(0,5)]});assert((await g.collect()).scan.failures.includes('pagination-loop'));
  const h=fixture({pagination:p=>p===2?{totalDocs:9}: {}});assert((await h.collect()).scan.failures.includes('pagination-inconsistent'));
});
test('account changes, foreign details, missing/foreign row scope and expired authentication abort without observations',async()=>{
  for(const extra of [{changedAccount:true},{detailForeign:true},{rows:[{...row('a'),userId:undefined}]},{rows:[{...row('a'),userId:'foreign'}]},{failPage:2,authFailure:true}]){const f=fixture({initial:legacy,...extra});await assert.rejects(f.collect());assert.equal(f.stored.libraryEntitlements,undefined);assert.deepEqual(f.stored.libraryItems,legacy.libraryItems);}
});
test('write failure preserves observations, history and corrections; restore invalidates in-flight token',async()=>{
  const f=fixture({initial:legacy});await f.collect();const baseline=f.stored;
  const g=fixture({initial:baseline,writeFailure:p=>!!p.libraryEntitlements});await assert.rejects(g.collect());assert.deepEqual(g.stored.libraryEntitlements,baseline.libraryEntitlements);assert.deepEqual(g.stored.mediaTypeOverrides,legacy.mediaTypeOverrides);
  const begin=await f.store('entitlementBegin',{confirmed:true,scope:{principalId:'principal-A',userId:'hub-A'}});await f.writer.execute('replace',[f.stored]);await assert.rejects(f.store('entitlementCommit',begin.token,{}),/superseded/);
});
test('backup restore validates scopes and strips untrusted payload fields; active account isolation',async()=>{
  const f=fixture();await f.collect();const backup=f.H.createLibraryBackup(f.stored),entry=backup.libraryEntitlements.scopes[0].observations[0];entry.key='secret';entry.eligibility.redemptionData={key:'secret'};entry.admission='owned';entry.activationStatus='activated';
  const restored=f.H.restoreBackupState(backup);assert(!JSON.stringify(restored).includes('secret'));assert.equal(restored.libraryEntitlements.scopes[0].observations[0].activationStatus,'unknown');
  const invalid=copy(backup);invalid.libraryEntitlements.scopes[0].observations.push(copy(entry));assert.throws(()=>f.H.restoreBackupState(invalid),/identity/);
  assert.equal(f.E.matchingItems({...f.stored,humbleAccountId:'22222222-2222-4222-8222-222222222222'}).length,0);
  const foreign=fixture({initial:f.stored});await assert.rejects(foreign.store('entitlementBegin',{confirmed:true,scope:{principalId:'different',userId:'hub-B'}}),/different/);
});
test('GL projection is distinguished, opaque, activation-unknown and not a transaction feed',async()=>{
  const f=fixture();await f.collect();const projection=await f.E.projectForGL(f.stored,'synthetic-salt');assert.equal(projection.format,'humble-library-entitlement-observations');assert(projection.records.every(r=>r.activationStatus==='unknown'&&r.evidenceSource==='authenticated-humble-library'));assert(!JSON.stringify(projection).includes('principal-A'));assert(!JSON.stringify(projection).includes('hub-A'));assert(!JSON.stringify(projection).includes('parent-A'));assert(!JSON.stringify(projection).includes('purchaseKey'));
});
test('shipped ownership path labels admitted keys Purchased, groups explanations, never establishes Steam ownership',async()=>{
  const f=fixture({rows:[row('a'),row('b')]});await f.collect();const records=f.E.matchingItems(f.stored);
  const m=matchingFixture(records,'game',{title:'Synthetic game'});const result=await m.classify();
  assert.equal(result.match.state,'owned');assert.equal(m.context.HumbleOwnership.presentation.status(m.context.offered,result.match),'Purchased');
  const views=m.context.HumbleOwnership.presentation.candidateViews(m.context.offered,result.match);
  assert.equal(views.length,1);assert(views[0].annotations.some(v=>/copy relationship/.test(v)));assert.match(views[0].access,/activation not confirmed/);
  const unknown=fixture({rows:[row('a')],children:[{...child('a'),expired:undefined}]});await unknown.collect();assert.equal(unknown.E.matchingItems(unknown.stored).length,0);
});
test('worker refuses foreign tab, stale clock, contradictory coverage and oversized scans',async()=>{
  const f=fixture();const begin=await f.store('entitlementBegin',{confirmed:true,scope:{principalId:'principal-A',userId:'hub-A'}});
  await assert.rejects(f.writer.execute('entitlementAbort',[begin.token,99]),/superseded/);
  await assert.rejects(f.collect({pageLimit:11}),/bounded/);
  const row={...child('a'),parentId:'parent-A',namespace:'steam',nativeId:'a'};assert.throws(()=>f.E.observation(row));
  const s={checkedAt:new Date().toISOString(),acquisition:'finished',coverage:'accessible-pages-traversed',pagesRead:1,reportedPages:2,reportedTotal:8,verifiedItems:0,unresolvedItems:0,duplicateItems:0,conflictingItems:0,failures:[]};
  assert.throws(()=>f.E.scan(s),/Contradictory/);
  await assert.rejects(f.store('entitlementCommit',begin.token,{scope:{principalId:'principal-A',userId:'hub-A'},observations:[],scan:{...s,coverage:'bounded',checkedAt:'2000-01-01T00:00:00.000Z'}}),/admission/);
});
test('backup cannot bind two provider scopes to one local account or admit a forged status',async()=>{
  const f=fixture();await f.collect();const b=f.H.createLibraryBackup(f.stored),scope=copy(b.libraryEntitlements.scopes[0]);scope.principalId='foreign';scope.userId='foreign-hub';scope.observations=[];b.libraryEntitlements.scopes.push(scope);assert.throws(()=>f.H.restoreBackupState(b),/binding/);
  b.libraryEntitlements.scopes.pop();b.libraryEntitlements.scopes[0].observations[0].eligibility.expired=null;b.libraryEntitlements.scopes[0].observations[0].admission='humble-key-entitlement';assert.equal(f.H.restoreBackupState(b).libraryEntitlements.scopes[0].observations[0].admission,'observation-only');
});
test('Flight truncation, cycles, duplicate frames and unsupported text lengths are rejected',()=>{
  const {E}=fixture();for(const body of ['0:{"results":[]}','0:"$0"\n','0:{}\n0:{}\n','0:Tff,short']){
    if(body==='0:"$0"\n')assert.throws(()=>E.flight(body).resolve('$0'),/reference/);else assert.throws(()=>E.flight(body));
  }
});
test('account switching preserves archived observations and cannot mix matching scopes',async()=>{
  const f=fixture();await f.collect();const b=f.H.createLibraryBackup(f.stored);
  const other='22222222-2222-4222-8222-222222222222';await f.writer.execute('replace',[{...f.H.LIBRARY_STATE_DEFAULTS,humbleAccountId:other,humbleProfileLabel:'B',profileArchives:[{profileLabel:'A',backup:b}]}]);
  assert.equal(f.E.matchingItems(f.stored).length,0);await f.writer.execute('selectProfile',[{profileLabel:'A',expectedActiveLabel:'B',confirmed:true}]);assert.equal(observations(f).length,8);assert.equal(f.E.matchingItems(f.stored).length,8);
});
test('saved account changes during source verification invalidate prior confirmation',async()=>{
  const f=fixture();let changed=false;await assert.rejects(f.collect({fetcher:async(path,init)=>{const response=await f.fetcher(path,init);if(!changed&&path==='/home/library'&&init.method!=='POST'){changed=true;await f.area.set({humbleAccountId:'22222222-2222-4222-8222-222222222222',humbleProfileLabel:'B'});}return response;}}),/selected saved account changed/);assert.equal(f.stored.libraryEntitlements,undefined);
});
test('production acquisition never reads secret values, even when getters would throw',async()=>{
  const f=fixture({poisonSecrets:true});await f.collect();assert.equal(observations(f).length,8);assert.equal(f.secretReads,0);
});
test('actual worker handler enforces origin, route, sender ID and tab binding',async()=>{
  const f=fixture();let listener;
  f.context.chrome={runtime:{id:'own',getURL:p=>'chrome-extension://own/'+p,onMessage:{addListener:fn=>{listener=fn;}}}};
  f.context.libraryStore=f.writer;
  const source=fs.readFileSync(new URL('../background.js',import.meta.url),'utf8'),start=source.indexOf('chrome.runtime.onMessage.addListener((message,sender,respond)=>{'),end=source.indexOf('\nchrome.runtime.onMessage.addListener',start+1);
  assert(start>0&&end>start);vm.runInContext(source.slice(start,end),f.context);
  const send=(operation,args,sender)=>new Promise(resolve=>listener({type:'HCL_STORE',operation,args},sender,resolve));
  for(const sender of [{id:'foreign',url:'https://www.humblebundle.com/home/library',tab:{id:7}},{id:'own',url:'https://evil.invalid/home/library',tab:{id:7}},{id:'own',url:'https://www.humblebundle.com/home/purchases',tab:{id:7}},{id:'own',url:'https://www.humblebundle.com/home/library-foreign',tab:{id:7}}])assert.equal((await send('entitlementContext',[],sender)).ok,false);
  const sender={id:'own',url:'https://www.humblebundle.com/home/library',tab:{id:7}},context=(await send('entitlementContext',[],sender)).result;
  const begin=await send('entitlementBegin',[{scope:{principalId:'principal-A',userId:'hub-A'},confirmed:true,expectedAccountId:context.accountId,expectedProfileLabel:context.profileLabel},999],sender);assert.equal(begin.ok,true);
  assert.equal((await send('entitlementAbort',[begin.result.token,999],{...sender,tab:{id:8}})).ok,false);
  assert.equal((await send('entitlementAbort',[begin.result.token,999],sender)).ok,true);
});
test('parent request ceiling preserves verified records without excessive retries',async()=>{
  const rows=Array.from({length:25},(_,i)=>({...row('bounded-'+i),productEntitlementId:'parent-'+i}));
  const f=fixture({rows,groupIds:rows.map(r=>r.productEntitlementId)});const r=await f.collect();
  assert.equal(r.saved,20);assert.equal(r.scan.unresolvedItems,5);assert.equal(r.scan.coverage,'incomplete');assert(r.scan.failures.includes('request-bound'));
  assert.equal(f.requests.filter(r=>r.path.startsWith('/home/library/parent-')).length,20);
});
test('production Flight reader respects UTF-8 text lengths and resolves module/model references',()=>{
  const {E}=fixture(),title='Synthetic é\ntext',length=new TextEncoder().encode(title).length.toString(16);
  const f=E.flight('4:T'+length+','+title+'\n1:I[1,[],"$2"]\n2:"AuthProvider"\n0:["$","$L1",null,{"title":"$4"}]\n');
  assert.equal(f.resolve('$4'),title);assert.equal(f.components[0].name,'AuthProvider');
});
