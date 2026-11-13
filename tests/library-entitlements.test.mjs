import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,row,child,copy,accountId,frames} from './library-entitlements-fixture.mjs';
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
for(const [field,value]of [['expired',true],['preOrdered',true],['outOfStock',true],['redeemable',false],['giftStatus',undefined],['directRedeem',true],['directRedeem',undefined],['keyIntegrationId','unverified'],['unavailableAfter','2099-01-01T00:00:00.000Z'],['expired',undefined]])test(`redemption/optional ${field}:${value} does not erase Purchased membership`,async()=>{
  const c=child('a');if(value===undefined)delete c[field];else c[field]=value;const f=fixture({rows:[row('a')],children:[c]});await f.collect();assert.equal(observations(f)[0].admission,'humble-key-entitlement');assert.equal(observations(f)[0].activationStatus,'unknown');
});
for(const parent of [{preOrder:true},{preOrder:undefined}])test('unknown or true parent preorder preserves a Purchased preorder',async()=>{const f=fixture({parent});await f.collect();assert(observations(f).every(r=>r.purchaseStatus==='purchased'));});
test('Purchased Choice items and missing group metadata qualify; explicit temporary access does not',async()=>{
  for(const entitlements of [{redemptionGroups:[{state:'AVAILABLE'}]},{redemptionGroups:undefined}]){const f=fixture({entitlements});await f.collect();assert(observations(f).every(r=>r.purchaseStatus==='purchased'));}
  const f=fixture({rows:[row('s','Subscription','subscriptioncontent')],children:[{...child('s','Subscription','subscriptioncontent'),temporaryAccess:true}]});await f.collect();assert.equal(observations(f)[0].admission,'observation-only');
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
  const unknown=fixture({rows:[row('a')],children:[{...child('a'),expired:undefined}]});await unknown.collect();assert.equal(unknown.E.matchingItems(unknown.stored).length,1);
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
  b.libraryEntitlements.scopes.pop();b.libraryEntitlements.scopes[0].observations[0].eligibility.giftStatus='gifted';b.libraryEntitlements.scopes[0].observations[0].admission='humble-key-entitlement';assert.equal(f.H.restoreBackupState(b).libraryEntitlements.scopes[0].observations[0].admission,'observation-only');
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

test('unrelated closed Flight streams and errors do not invalidate independent Library evidence',async()=>{
  const f=fixture();
  const fetcher=async(path,init)=>{
    const r=await f.fetcher(path,init);
    if(path.startsWith('/_next/'))return r;
    return {...r,text:async()=> 'f0:X\nf0:{"unrelated":"UI stream"}\nf0:C\nf1:E{"digest":"synthetic-unrelated-error"}\n'+await r.text()};
  };
  const saved=await f.collect({fetcher});
  assert.equal(saved.saved,8);assert.equal(saved.scan.historicalComplete,false);
  assert(!JSON.stringify(f.stored).includes('synthetic-unrelated-error'));
});

test('Flight streams and errors cannot supply required evidence or bypass framing integrity',async()=>{
  const {E}=fixture();
  for(const body of ['a:X\na:C\n','a:E{"digest":"synthetic"}\n']){
    const f=E.flight(body);assert.throws(()=>f.resolve('$a'),/reference/);assert.equal(f.models.size,0);
  }
  for(const body of ['a:X\n','a:C\n','a:X\na:X\n','a:E{}\na:{}\n','a:X\na:C\na:T1,x','a:Ebroken\n','a:X\na:broken\na:C\n'])assert.throws(()=>E.flight(body));
  const f=fixture();
  await assert.rejects(f.collect({fetcher:async(path,init)=>{
    const r=await f.fetcher(path,init);if(path!=='/home/library'||init.method==='POST')return r;
    return {...r,text:async()=> (await r.text()).replace('"id":"principal-A"','"id":"$f1"')+'f1:E{"digest":"synthetic-required-error"}\n'};
  }}),error=>error.fatalScope===true&&/signed-in Library account/.test(error.message));
  assert.equal(f.writes.length,0);
});

const bootstrap = body => '<!doctype html><script>globalThis.UNSAFE_BOOTSTRAP_EXECUTED=true</script><script>self.__next_f.push('+JSON.stringify([1,body])+')</script>';
const htmlTransport = (f,transform=body=>body) => async(path,init)=>{
  if(path.startsWith('/_next/'))return f.fetcher(path,init);
  assert.equal(init.headers.RSC,undefined);assert.equal(init.redirect,'manual');assert.equal(init.cache,'no-store');
  const r=await f.fetcher(path,init);
  if(init.method==='POST'){assert.equal(init.headers.Accept,'text/x-component');return r;}
  assert.equal(init.headers.Accept,'text/html');
  return {...r,headers:{get:()=> 'text/html; charset=utf-8'},text:async()=>bootstrap(transform(await r.text()))};
};
test('authenticated HTML bootstrap and agreeing account providers use actual acquisition and atomic storage',async()=>{
  const f=fixture({initial:legacy});
  const fetcher=htmlTransport(f,body=>body+frames([{name:'AuthProvider',props:{user:{id:'principal-A'}}}]).replaceAll('1:','e1:').replaceAll('$L1','$Le1').replace('0:','e0:'));
  const result=await f.collect({fetcher});assert.equal(result.saved,8);assert.equal(f.writes.filter(p=>p.libraryEntitlements).length,1);
  assert.equal(f.context.UNSAFE_BOOTSTRAP_EXECUTED,undefined);
  for(const [key,value] of Object.entries(legacy))assert.deepEqual(f.stored[key],value);
  await f.collect({fetcher});assert.equal(observations(f).length,8);
});
test('HTML bootstrap refuses conflicting or missing principals, malformed data and truncated frames',async()=>{
  for(const foreign of ['principal-B',null]){
    const f=fixture();const body=frames([{name:'AuthProvider',props:{user:{id:foreign}}}]).replaceAll('1:','e1:').replaceAll('$L1','$Le1').replace('0:','e0:');
    await assert.rejects(f.collect({fetcher:htmlTransport(f,v=>v+body)}));assert.equal(f.writes.length,0);
  }
  for(const html of ['<script>self.__next_f.push([1,notJSON])</script>','<script>self.__next_f.push([1,"0:{"])</script>','<script>self.__next_f.push([1,{}])</script>','<script>self.__next_f.push(getPrivateData())</script>','<html>No Library bootstrap</html>']){
    const f=fixture();await assert.rejects(f.collect({fetcher:async(path,init)=>({...await f.fetcher(path,init),headers:{get:()=> 'text/html'},text:async()=>html})}));assert.equal(f.writes.length,0);
  }
});
test('missing detail principal aborts the batch rather than retaining earlier new observations',async()=>{
  const rows=Array.from({length:8},(_,i)=>({...row('id-'+i),productEntitlementId:i<5?'parent-A':'parent-B'}));
  const f=fixture({initial:legacy,rows,groupIds:['parent-A','parent-B']});await assert.rejects(f.collect({fetcher:async(path,init)=>{const r=await f.fetcher(path,init);return path==='/home/library/parent-B'?{...r,text:async()=>(await r.text()).replace('"id":"principal-A"','"id":null')}:r;}}),error=>error.fatalScope===true);
  assert.equal(f.stored.libraryEntitlements,undefined);assert.equal(f.writes.filter(p=>p.libraryEntitlements).length,0);assert.deepEqual(f.stored.libraryItems,legacy.libraryItems);
});
// Live shape: the envelope lists bundle purchases only; store and widget purchases
// are reachable through their own authenticated detail route.
const detailPage=(parent,item,principal='principal-A',name='ProductKeysDownloads')=>({ok:true,status:200,headers:{get:()=>'text/x-component'},
  text:async()=>frames([{name:'AuthProvider',props:{user:{id:principal}}},{name,props:{productEntitlementId:parent,userLibraryItem:item}}])});
const item=(type,children)=>({id:'detail-'+type,preOrder:false,...(type?{type}:{}),entitlements:{keys:children.filter(c=>c.type!=='download_drm_free'),downloads:children.filter(c=>c.type==='download_drm_free'),redemptionGroups:[]}});
const under=(parent,id,title,type)=>({...row(id,title,type),productEntitlementId:parent});
test('store and widget purchases outside the bundle list verify only through their own account-checked detail',async()=>{
  const rows=[row('listed'),under('parent-S','store-1','Store game','download_drm_free'),under('parent-W','widget-1','Widget game'),under('parent-U','bundle-x','Unlisted bundle game'),
    under('parent-N','untyped','Untyped game'),under('parent-P','public','Public game'),under('parent-S','gift','Gifted game')];
  const details={'parent-S':item('storefront',[child('store-1','Store game','download_drm_free'),{...child('gift','Gifted game'),giftStatus:'gifted'}]),'parent-W':item('widget',[child('widget-1','Widget game')]),
    'parent-U':item('bundle',[child('bundle-x','Unlisted bundle game')]),'parent-N':item(undefined,[child('untyped','Untyped game')]),'parent-P':item('storefront',[child('public','Public game')])};
  const f=fixture({initial:legacy,rows,children:[child('listed')]});
  const fetcher=async(path,init)=>{const parent=decodeURIComponent(path.split('/').at(-1));
    if(parent==='parent-P')return detailPage(parent,details[parent],'principal-A','ProductPage');
    return details[parent]?detailPage(parent,details[parent]):f.fetcher(path,init);};
  const r=await f.collect({fetcher});
  assert.equal(r.scan.unresolvedItems,3);assert.equal(r.scan.coverage,'incomplete');
  const saved=Object.fromEntries(observations(f).map(o=>[o.nativeId,o]));
  assert.deepEqual(Object.keys(saved).sort(),['gift','listed','store-1','widget-1']);
  assert.equal(saved['store-1'].parentId,'parent-S');assert.equal(saved['store-1'].eligibility.parentType,'storefront');assert.equal(saved['store-1'].purchaseStatus,'purchased');
  assert.equal(saved['widget-1'].eligibility.parentType,'widget');assert.equal(saved['widget-1'].admission,'humble-key-entitlement');
  assert.equal(saved.gift.purchaseStatus,'excluded');assert.equal(saved.listed.eligibility.parentType,'bundle');
  for(const [k,v]of Object.entries(legacy))assert.deepEqual(f.stored[k],v);
  assert(!JSON.stringify(f.stored).includes('SYNTHETIC_SECRET'));
});
test('an unlisted parent detail from another account aborts the batch',async()=>{
  const f=fixture({initial:legacy,rows:[row('listed'),under('parent-S','store-1')],children:[child('listed')]});
  const fetcher=async(path,init)=>path==='/home/library/parent-S'?detailPage('parent-S',item('storefront',[child('store-1')]),'principal-B'):f.fetcher(path,init);
  await assert.rejects(f.collect({fetcher}),error=>error.fatalScope===true);
  assert.equal(f.stored.libraryEntitlements,undefined);assert.deepEqual(f.stored.libraryItems,legacy.libraryItems);
});
test('parent-level rows without an exact typed child stay unresolved, even when titles agree',async()=>{
  // Live shapes: a widget row whose ID is its parent and whose only child has no type, and
  // a bundle row whose ID is its listed parent while the detail lists differently identified files.
  const rows=[under('parent-W','parent-W','Widget purchase','widget'),under('parent-A','parent-A','Bundle purchase','bundle'),row('a')];
  const f=fixture({rows,children:[child('a'),child('file-1','Bundle purchase','download_drm_free'),child('file-2','Other file','download_drm_free')]});
  const fetcher=async(path,init)=>path==='/home/library/parent-W'?detailPage('parent-W',item('widget',[{...child('parent-W','Widget purchase'),type:null}])):f.fetcher(path,init);
  const r=await f.collect({fetcher});
  assert.equal(r.scan.unresolvedItems,2);assert.deepEqual(observations(f).map(o=>o.nativeId),['a']);
});
test('dependency-rich modules keep the eight-asset ceiling and require a unique observed action',async()=>{
  for(const found of [true,false]){
    const f=fixture();let assets=0;
    const fetcher=async(path,init)=>{
      if(path.startsWith('/_next/')){assets++;return {ok:true,text:async()=>found&&path.endsWith('synthetic-library.js')?`createServerReference("${'a'.repeat(40)}",callServer,0,0,"filterUserLibrary")`:'/* shared dependency */'};}
      const r=await f.fetcher(path,init);
      return path==='/home/library'&&init.method!=='POST'?{...r,text:async()=>(await r.text()).replace('["static/chunks/synthetic-library.js"]',JSON.stringify([...Array.from({length:12},(_,i)=>'static/chunks/dependency-'+i+'.js'),'static/chunks/synthetic-library.js']))}:r;
    };
    if(found)assert.equal((await f.collect({fetcher})).saved,8);else {await assert.rejects(f.collect({fetcher}),/read-only Library action/);assert.equal(f.stored.libraryEntitlements,undefined);}
    assert.equal(assets,8);
  }
});

test('live-shaped Steam metadata establishes Purchased but never Steam activation',async()=>{
  const c=child('native-steam');delete c.directRedeem;c.keyIntegrationId='synthetic-integration';c.unavailableAfter='2099-01-01T00:00:00.000Z';c.redeemedAt='2020-01-01T00:00:00.000Z';
  const f=fixture({initial:legacy,rows:[row(c.id)],children:[c],parent:{preOrder:undefined}});
  const result=await f.collect();assert.equal(result.saved,1);assert.equal(result.scan.unresolvedItems,0);
  const [r]=observations(f);assert.equal(r.admission,'humble-key-entitlement');assert.equal(r.purchaseStatus,'purchased');assert.equal(r.mediaType,'game');assert.equal(r.activationStatus,'unknown');assert.equal(r.eligibility.parentPreOrder,null);assert.equal(r.eligibility.directRedeem,null);assert.equal(r.eligibility.integration,'unknown');assert.equal(r.eligibility.unavailableAfter.state,'date');
  assert.equal(f.E.matchingItems(f.stored).length,1);assert.equal((await f.E.projectForGL(f.stored,'synthetic-salt')).records[0].purchaseStatus,'purchased');
  const restored=f.H.restoreBackupState(f.H.createLibraryBackup(f.stored));assert.equal(restored.libraryEntitlements.scopes[0].observations[0].purchaseStatus,'purchased');assert.deepEqual(copy(restored.mediaTypeOverrides),legacy.mediaTypeOverrides);
});

test('live-shaped DRM-free metadata is Purchased with unknown media and no media-specific matching',async()=>{
  const c=child('native-drm','Synthetic DRM','download_drm_free');delete c.directRedeem;delete c.keyIntegrationId;
  const f=fixture({rows:[row(c.id,c.title,c.type)],children:[c],parent:{preOrder:undefined}});const result=await f.collect();assert.equal(result.saved,1);assert.equal(result.scan.unresolvedItems,0);
  const [r]=observations(f);assert.equal(r.mediaType,'unknown');assert.equal(r.admission,'personal-drm-free-entitlement');assert.equal(r.purchaseStatus,'purchased');assert.equal(f.E.purchaseViews(f.stored)[0].status,'Purchased');assert.equal(r.eligibility.redemptionGroups,'none');assert.equal(f.E.matchingItems(f.stored).length,0);
});

for(const location of ['child','parent','row','listing-child'])for(const field of ['revoked','temporaryAccess','giftStatus']){
if(location==='parent'&&field==='giftStatus')continue; // Gifts are individual copies, not parent groups.
test(`explicit ${field} at ${location} excludes Purchased matching`,async()=>{
  const value=field==='giftStatus'?'gifted':true,c=child('excluded'),r=row(c.id);
  const options={initial:legacy,rows:[r],children:[c]};
  if(location==='child')c[field]=value;
  else if(location==='parent'){
    options.parent={[field]:value};
  }else if(location==='row')r[field]=value;
  else r.entitlements={keys:[{...c,[field]:value}]};
  const f=fixture(options);await f.collect();assert.equal(observations(f)[0].purchaseStatus,'excluded');assert.equal(f.E.matchingItems(f.stored).length,0);
  assert.notEqual(f.E.purchaseViews(f.stored)[0].status,'Purchased');
  const restored=f.H.restoreBackupState(f.H.createLibraryBackup(f.stored));assert.equal(restored.libraryEntitlements.scopes[0].observations[0].purchaseStatus,'excluded');assert.deepEqual(f.stored.libraryItems,legacy.libraryItems);
});
}

test('storefront and claimed Choice membership qualify independently of optional parent metadata',async()=>{
  for(const parentType of ['storefront','subscriptioncontent']){
    const f=fixture({parentType,parent:{preOrder:undefined},entitlements:{redemptionGroups:[{state:'AVAILABLE'}]}});await f.collect();assert(observations(f).every(r=>r.purchaseStatus==='purchased'));assert.equal(f.E.matchingItems(f.stored).length,8);
  }
  const r=row('unclaimed'),f=fixture({rows:[r],children:[],entitlements:{redemptionGroups:[{state:'AVAILABLE',options:[child(r.id)]}]}});
  const result=await f.collect();assert.equal(result.saved,0);assert.equal(result.scan.unresolvedItems,1);
});

test('generic Purchased display preserves unknown media, native copies and account isolation',async()=>{
  const f=fixture({rows:[row('a','Same title','download_drm_free'),row('b','Same title','download_drm_free'),row('c','Other key','gog')]});await f.collect();
  const views=f.E.purchaseViews(f.stored);assert.equal(views.length,3);assert.equal(new Set(views.map(r=>r.itemRef)).size,3);assert(views.every(r=>r.status==='Purchased'&&r.mediaType==='unknown'&&r.activationStatus==='unknown'));assert.equal(f.E.matchingItems(f.stored).length,0);
  assert.equal(f.E.purchaseViews({...f.stored,humbleAccountId:'22222222-2222-4222-8222-222222222222'}).length,0);
  const restored=f.H.restoreBackupState(f.H.createLibraryBackup(f.stored));assert.equal(f.E.purchaseViews(restored).length,3);
});

test('malformed exclusion evidence is unresolved and backup admission cannot override explicit exclusions',async()=>{
  const f=fixture({rows:[row('a')],children:[{...child('a'),revoked:'false'}]});const result=await f.collect();assert.equal(result.saved,0);assert.equal(result.scan.unresolvedItems,1);
  const g=fixture({rows:[row('b')],children:[{...child('b'),revoked:true}]});await g.collect();const backup=g.H.createLibraryBackup(g.stored),r=backup.libraryEntitlements.scopes[0].observations[0];r.purchaseStatus='purchased';r.admission='humble-key-entitlement';
  assert.equal(g.H.restoreBackupState(backup).libraryEntitlements.scopes[0].observations[0].purchaseStatus,'excluded');r.eligibility.temporaryAccess='false';assert.throws(()=>g.H.restoreBackupState(backup),/access evidence/);
});

for(const field of ['giftStatus','revoked','temporaryAccess'])test(`refresh preserves explicit ${field} when omitted and accepts explicit clearing evidence`,async()=>{
  const c=child('remembered');c[field]=field==='giftStatus'?'gifted':true;const first=fixture({initial:legacy,rows:[row(c.id)],children:[c]});await first.collect();
  const missing=child(c.id);delete missing[field];const second=fixture({initial:first.stored,rows:[row(c.id)],children:[missing]});await second.collect();assert.equal(observations(second)[0].purchaseStatus,'excluded');assert.deepEqual(second.stored.libraryItems,legacy.libraryItems);
  const clear=child(c.id);clear[field]=field==='giftStatus'?'unassigned':false;const third=fixture({initial:second.stored,rows:[row(c.id)],children:[clear]});await third.collect();assert.equal(observations(third)[0].purchaseStatus,'purchased');
  const record=observations(third)[0];assert.throws(()=>third.E.refreshObservation(record,{...record,nativeId:'other'}),/foreign/);
});

test('live titles with line breaks or tabs are normalized display metadata, not a reason to reject a purchase',async()=>{
  const title='Synthetic\tgame:\nsubtitle ',r=row('titled',title),c=child('titled',title);
  const f=fixture({initial:legacy,rows:[r],children:[c]});const result=await f.collect();
  assert.equal(result.saved,1);assert.equal(result.scan.unresolvedItems,0);
  const [saved]=observations(f);assert.equal(saved.title,'Synthetic game: subtitle');assert.equal(saved.purchaseStatus,'purchased');assert.equal(saved.nativeId,'titled');
  for(const [k,v]of Object.entries(legacy))assert.deepEqual(f.stored[k],v);
  // Stored observations stay strict: a raw control character cannot enter through backup restore.
  const backup=f.H.createLibraryBackup(f.stored);backup.libraryEntitlements.scopes[0].observations[0].title=title;assert.throws(()=>f.H.restoreBackupState(backup),/text/);
  for(const [rowTitle,childTitle] of [['\n\t','\n\t'],['Synthetic game','Different game']]){
    const g=fixture({rows:[row('bad',rowTitle)],children:[child('bad',childTitle)]});const bad=await g.collect();assert.equal(bad.saved,0);assert.equal(bad.scan.unresolvedItems,1);
  }
});
