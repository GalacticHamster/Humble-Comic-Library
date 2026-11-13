import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,row,child,copy} from './library-entitlements-fixture.mjs';

// Synthetic provider only. Every test also checks legacy history/corrections stay byte-identical.
const legacy={libraryItems:[{title:'Old',kind:'book',source:'humble',purchaseKey:'old',manualKind:'book'}],purchaseSummaries:[{purchaseKey:'old',itemCount:1}],historicalLibraryItems:[{title:'Earlier',purchaseKey:'earlier'}],historicalPurchaseSummaries:[{purchaseKey:'earlier'}],mediaTypeOverrides:{old:'book'},keyReminders:[],lastImport:{reconciled:true}};
const many=(n,prefix='id')=>Array.from({length:n},(_,i)=>row(prefix+'-'+i,'Synthetic game '+i));
const scope=f=>f.stored.libraryEntitlements?.scopes[0];
const preserved=f=>{for(const [k,v] of Object.entries(legacy))assert.deepEqual(f.stored[k],v,'legacy '+k+' changed');};
const setup=(options={})=>{const rows=options.rows??many(37);return fixture({initial:legacy,rows,children:options.children??rows.map(r=>child(r.id,r.title,r.type)),...options});};
const runner=(f,{fetcher=f.fetcher,settings={},sleep=async()=>{}}={})=>f.E.createSync({fetcher,store:f.store,settings:{batchPages:3,pageSize:5,refreshPages:6,...settings},sleep});
const start=async(f,s,options={})=>s.start({mode:'full',context:await f.store('entitlementContext'),confirmed:true,...options});
const posts=f=>f.requests.filter(r=>r.method==='POST');
const pages=f=>posts(f).length;

test('initial sync traverses every accessible page in bounded atomic batches',async()=>{
  const f=setup(),s=runner(f);await start(f,s);
  const cp=scope(f).sync;
  assert.equal(cp.status,'completed');assert.equal(cp.coverage,'accessible-pages-traversed');assert.equal(cp.historicalComplete,false);assert.equal(cp.reconciliationAuthority,'none');
  assert.equal(cp.nextPage,9);assert.equal(cp.targetPages,8);assert.equal(cp.reportedTotal,37);assert.equal(cp.batches,3);assert.equal(cp.added,37);assert.equal(cp.refreshed,0);
  assert.equal(scope(f).observations.length,37);assert.equal(f.E.syncView(f.stored).found,37);
  // Each batch is one atomic write carrying its observations and checkpoint together.
  const writes=f.writes.filter(w=>w.libraryEntitlements);assert.equal(writes.length,3);
  assert.deepEqual(writes.map(w=>w.libraryEntitlements.scopes[0].sync.nextPage),[4,7,9]);
  assert.deepEqual(writes.map(w=>w.libraryEntitlements.scopes[0].observations.length),[15,30,37]);
  assert.equal(pages(f),8+2,'two later batches each re-read one prior page');
  assert.equal(f.requests.filter(r=>r.path.startsWith('/home/library/parent-')).length,1,'account-checked parent details are reused within the session');
  assert.equal(f.stored.hclLibraryEntitlementLease,null);assert.equal(f.stored.hclLibraryEntitlementControl,null);
  preserved(f);
});

test('pause and resume continue from the checkpoint without rereading earlier pages',async()=>{
  const f=setup(),s=runner(f);
  s.subscribe(v=>{if(v.phase==='waiting'&&v.checkpoint?.nextPage===4)s.pause();});
  await start(f,s);
  assert.equal(scope(f).sync.status,'paused');assert.equal(scope(f).sync.nextPage,4);assert.equal(s.view.phase,'paused');assert.equal(scope(f).observations.length,15);
  const before=pages(f);await s.start({mode:'full',resume:scope(f).sync,context:await f.store('entitlementContext'),confirmed:true});
  assert.equal(scope(f).sync.status,'completed');assert.equal(scope(f).observations.length,37);
  assert.equal(pages(f)-before,7,'pages 4-8 plus one overlap re-read per batch; pages 1-2 are not reread');
  preserved(f);
});

test('browser reload and extension restart resume an interrupted sync from persisted storage',async()=>{
  const f=setup();let batches=0;
  const hanging=async(path,init)=>{if(init.method==='POST'&&++batches>3)return new Promise(()=>{});return f.fetcher(path,init);};
  start(f,runner(f,{fetcher:hanging}));
  for(let n=0;n<200&&scope(f)?.sync?.nextPage!==4;n++)await new Promise(r=>setTimeout(r,5));
  await new Promise(r=>setTimeout(r,20));
  // A new worker, storage view and tab: the old runner is gone with its lease left behind.
  const g=setup({initial:{...f.stored}});assert.equal(scope(g).sync.status,'running');assert.ok(g.stored.hclLibraryEntitlementLease);
  assert.equal(g.E.syncView(g.stored).checkpoint.nextPage,4);
  const s=runner(g);await s.start({mode:'full',resume:scope(g).sync,context:await g.store('entitlementContext'),confirmed:true});
  assert.equal(scope(g).sync.status,'completed');assert.equal(scope(g).observations.length,37);assert.equal(scope(g).sync.added,37);preserved(g);
});

test('interrupted network requests retry with bounded backoff, rolling back incomplete pages',async()=>{
  const f=setup(),delays=[];let failed=0;
  const flaky=async(path,init)=>{
    if(init.method==='POST'&&Number(init.body.get('_1_page'))===5&&failed<2){failed++;throw TypeError('network down');}
    return f.fetcher(path,init);
  };
  const s=runner(f,{fetcher:flaky,sleep:async ms=>{delays.push(ms);}});await start(f,s);
  assert.equal(scope(f).sync.status,'completed');assert.equal(scope(f).observations.length,37);assert.deepEqual(delays.filter(v=>v>=15000),[15000],'one no-progress retry after the partial batch');
  // Parent failures roll back the page rather than recording unresolved items.
  const g=setup({rows:many(12).map((r,i)=>({...r,productEntitlementId:i<5?'parent-A':'parent-B'})),groupIds:['parent-A','parent-B']});let parentFailures=0;
  const parentFlaky=async(path,init)=>path==='/home/library/parent-B'&&parentFailures++<1?{ok:false,status:502,headers:{get:()=>null},text:async()=>''}:g.fetcher(path,init);
  await start(g,runner(g,{fetcher:parentFlaky}));
  assert.equal(scope(g).sync.status,'completed');assert.equal(scope(g).sync.coverage,'accessible-pages-traversed');assert.equal(scope(g).observations.length,12);assert.equal(scope(g).sync.unresolved,0);
  preserved(f);preserved(g);
});

test('retries stop after the bound, keeping verified progress and the checkpoint',async()=>{
  const f=setup(),delays=[];
  const down=async(path,init)=>init.method==='POST'&&Number(init.body.get('_1_page'))===5?{ok:false,status:503,headers:{get:()=>null},text:async()=>''}:f.fetcher(path,init);
  const s=runner(f,{fetcher:down,sleep:async ms=>{delays.push(ms);}});await start(f,s);
  assert.equal(s.view.phase,'stopped');assert.equal(s.view.error,'failed');
  assert.equal(scope(f).sync.status,'stopped');assert.equal(scope(f).sync.reason,'failed');assert.equal(scope(f).sync.nextPage,5);assert.equal(scope(f).observations.length,20);
  assert.deepEqual(delays.filter(v=>v>10000),[15000,60000,180000]);
  assert.equal(posts(f).filter(r=>r.path==='/home/library').length>0,true);preserved(f);
});

test('expired authentication and redirects stop the sync safely and can be resumed after sign-in',async()=>{
  for(const failure of [{type:'opaqueredirect',status:0,ok:false,headers:{get:()=>null}},{ok:false,status:401,headers:{get:()=>null}}]){
    const f=setup();let signedOut=false;
    const fetcher=async(path,init)=>{if(signedOut&&path==='/home/library'&&init.method==='POST')return {...failure,text:async()=>''};const r=await f.fetcher(path,init);return r;};
    const s=runner(f,{fetcher});s.subscribe(v=>{if(v.phase==='waiting'&&v.checkpoint?.nextPage===4)signedOut=true;});
    await start(f,s);
    assert.equal(s.view.error,'signed-out');assert.equal(scope(f).sync.status,'stopped');assert.equal(scope(f).sync.reason,'signed-out');assert.equal(scope(f).observations.length,15);preserved(f);
    signedOut=false;await s.start({mode:'full',resume:scope(f).sync,context:await f.store('entitlementContext'),confirmed:true});
    assert.equal(scope(f).sync.status,'completed');assert.equal(scope(f).observations.length,37);
  }
});

test('provider rate limiting stops immediately without retrying around it',async()=>{
  const f=setup(),delays=[];let limited=false,after=0;
  const fetcher=async(path,init)=>{if(limited){after++;return {ok:false,status:429,headers:{get:name=>name==='retry-after'?'120':null},text:async()=>''};}return f.fetcher(path,init);};
  const s=runner(f,{fetcher,sleep:async ms=>{delays.push(ms);}});s.subscribe(v=>{if(v.phase==='waiting'&&v.checkpoint?.nextPage===4)limited=true;});
  await start(f,s);
  assert.equal(s.view.error,'rate-limited');assert.equal(s.view.retryAfter,120000);assert.equal(after,1,'no request follows a slow-down response');
  assert.equal(scope(f).sync.reason,'rate-limited');assert.equal(scope(f).sync.nextPage,4);assert(!delays.some(v=>v>=15000));preserved(f);
});

test('account change mid-sync aborts without foreign writes; profile switch suspends and travels with the profile',async()=>{
  const f=setup({changedAccount:true});const s=runner(f);await start(f,s);
  assert.equal(s.view.error,'account');assert.equal(f.stored.libraryEntitlements,undefined);preserved(f);
  const other='22222222-2222-4222-8222-222222222222',base=setup();
  const archive=base.H.createLibraryBackup({...base.H.LIBRARY_STATE_DEFAULTS,humbleAccountId:other,humbleProfileLabel:'B'});
  const g=setup({initial:{...legacy,profileArchives:[{profileLabel:'B',backup:archive}]}}),t=runner(g);
  let switched=false;t.subscribe(v=>{if(!switched&&v.phase==='waiting'&&v.checkpoint?.nextPage===4){switched=true;g.writer.execute('selectProfile',[{profileLabel:'B',expectedActiveLabel:'A',confirmed:true}]);}});
  await start(g,t);
  assert.equal(t.view.error,'account');assert.equal(g.stored.humbleProfileLabel,'B');assert.equal(g.stored.libraryEntitlements.scopes.length,0,'no observations leak into the other profile');
  assert.equal(g.stored.hclLibraryEntitlementLease,null);
  const saved=g.stored.profileArchives.find(a=>a.profileLabel==='A').backup.libraryEntitlements.scopes[0];assert.equal(saved.sync.nextPage,4);assert.equal(saved.observations.length,15);
  await g.writer.execute('selectProfile',[{profileLabel:'A',expectedActiveLabel:'B',confirmed:true}]);
  await t.start({mode:'full',resume:scope(g).sync,context:await g.store('entitlementContext'),confirmed:true});
  assert.equal(scope(g).sync.status,'completed');assert.equal(scope(g).observations.length,37);preserved(g);
});

test('restore during a sync supersedes the running tab; restored checkpoints and pre-feature backups stay valid',async()=>{
  const f=setup(),s=runner(f);let backup;
  s.subscribe(v=>{if(!backup&&v.phase==='waiting'&&v.checkpoint?.nextPage===4){backup=f.H.createLibraryBackup(f.stored);}});
  let replaced=false;s.subscribe(v=>{if(backup&&!replaced&&v.phase==='waiting'&&v.checkpoint?.nextPage===7){replaced=true;f.writer.execute('replace',[f.H.restoreBackupState(backup)]);}});
  await start(f,s);
  assert.equal(s.view.error,'superseded');assert.equal(scope(f).sync.nextPage,4,'restored checkpoint matches the restored observations');assert.equal(scope(f).observations.length,15);
  await s.start({mode:'full',resume:scope(f).sync,context:await f.store('entitlementContext'),confirmed:true});assert.equal(scope(f).sync.status,'completed');
  const old=copy(f.H.createLibraryBackup(f.stored));for(const sc of old.libraryEntitlements.scopes){delete sc.sync;delete sc.lastScan.firstPage;}
  const restored=f.H.restoreBackupState(old);assert.equal(restored.libraryEntitlements.scopes[0].sync,null);assert.equal(restored.libraryEntitlements.scopes[0].observations.length,37);
  const legacyBackup=copy(old);delete legacyBackup.libraryEntitlements;assert.deepEqual(copy(f.H.restoreBackupState(legacyBackup).libraryEntitlements),{version:1,scopes:[]});
  preserved(f);
});

test('clear library ends the sync lease and removes the checkpoint with its observations',async()=>{
  const f=setup(),s=runner(f);s.subscribe(v=>{if(v.phase==='waiting'&&v.checkpoint?.nextPage===4)f.writer.execute('remove',[['libraryItems']]);});
  await start(f,s);assert(['account','superseded'].includes(s.view.error));assert.equal(f.stored.libraryEntitlements,undefined);assert.equal(f.stored.hclLibraryEntitlementLease,undefined);
});

test('storage failure rolls back the whole batch, then a retry commits; persistent failure stops with the prior checkpoint',async()=>{
  let failures=1;const f=setup({writeFailure:p=>p.libraryEntitlements?.scopes?.[0]?.sync?.nextPage===7&&failures-->0});
  const seen=[];const s=runner(f);s.subscribe(v=>{if(v.phase==='retrying')seen.push(copy(scope(f).sync));});await start(f,s);
  assert.equal(seen.length,1);assert.equal(seen[0].nextPage,4,'failed write left the earlier checkpoint intact');
  assert.equal(scope(f).sync.status,'completed');assert.equal(scope(f).observations.length,37);preserved(f);
  const g=setup({writeFailure:p=>p.libraryEntitlements?.scopes?.[0]?.sync?.nextPage===7}),t=runner(g);await start(g,t);
  assert.equal(t.view.error,'failed');assert.equal(scope(g).sync.nextPage,4);assert.equal(scope(g).sync.status,'stopped');assert.equal(scope(g).observations.length,15);preserved(g);
});

test('overlapping and duplicate native IDs deduplicate; conflicting records mark coverage uncertain',async()=>{
  const rows=many(15),pagesData=[rows.slice(0,5),[rows[4],...rows.slice(5,9)],rows.slice(9,14)];
  const f=setup({rows,pages:pagesData,pagination:()=>({totalDocs:15,totalPages:3})});await start(f,runner(f));
  // Humble reports 15 rows but its pages served 14: the repeated boundary row hid a skipped one.
  assert.equal(scope(f).observations.length,14);assert.equal(scope(f).sync.duplicates>=1,true);assert.equal(scope(f).sync.coverage,'incomplete');assert.deepEqual(scope(f).sync.uncertainty,['items-missed']);
  const bad=[rows.slice(0,5),[{...rows[4],title:'Conflicting'},...rows.slice(5,9)],rows.slice(9,14)];
  const g=setup({rows,pages:bad,pagination:()=>({totalDocs:15,totalPages:3})});await start(g,runner(g));
  assert.equal(scope(g).sync.status,'completed');assert.equal(scope(g).sync.coverage,'incomplete');assert(scope(g).sync.uncertainty.includes('duplicate-conflict'));assert(scope(g).sync.uncertainty.includes('items-unresolved'));
  assert(!scope(g).observations.some(r=>r.nativeId==='id-4'));preserved(g);
});

test('changed totals and reordering are reported as uncertainty, extend the range and never delete',async()=>{
  const rows=many(30),children=rows.map(r=>child(r.id,r.title)),f=setup({rows,children}),s=runner(f);let changed=false;
  s.subscribe(v=>{if(!changed&&v.phase==='waiting'&&v.checkpoint?.nextPage===4){changed=true;
    const added=many(4,'new');rows.unshift(...added);children.push(...added.map(r=>child(r.id,r.title)));rows.splice(rows.findIndex(r=>r.id==='id-20'),1);}});
  await start(f,s);const cp=scope(f).sync;
  assert.equal(cp.status,'completed');assert.equal(cp.coverage,'incomplete');assert(cp.uncertainty.includes('totals-changed'));assert(cp.uncertainty.includes('ordering-changed'));
  assert.equal(cp.reportedTotal,33);assert.equal(cp.targetPages,7);
  assert(scope(f).observations.some(r=>r.nativeId==='id-0'),'earlier observations are never removed when they move or disappear');
  const nested=setup({rows:many(10),pages:[many(10).slice(0,5),many(10).slice(0,5)]});await start(nested,runner(nested,{settings:{batchPages:1}}));
  assert.equal(nested.E.syncView(nested.stored).checkpoint.status,'stopped');assert(scope(nested).sync.uncertainty.includes('pagination-loop'));
  preserved(f);
});

test('request pacing and backoff timings honour conservative settings floors',async()=>{
  const f=setup({rows:many(10)}),delays=[];await start(f,runner(f,{settings:{batchPages:1},sleep:async ms=>{delays.push(ms);}}));
  assert(delays.includes(5000),'batches wait between them');
  assert(delays.filter(v=>v<=1000).length>0,'requests are spaced');
  for(const bad of [{requestSpacingMs:10},{batchDelayMs:0},{batchPages:11},{retryDelaysMs:[1]},{refreshPages:41},{maxSessionRequests:0},{pageSize:1000},{pageSize:250}])assert.throws(()=>f.E.createSync({fetcher:f.fetcher,store:f.store,settings:bad}),/settings/);
  const g=setup({rows:many(40)}),t=runner(g,{settings:{batchPages:1,maxSessionRequests:6}});await start(g,t);
  assert.equal(t.view.phase,'paused');assert.equal(t.view.error,'session-limit');assert.equal(scope(g).sync.reason,'session-limit');assert(scope(g).sync.nextPage<9);
});

test('cancellation keeps found purchases, and an unfinished sync blocks a silent restart',async()=>{
  const f=setup(),s=runner(f);let cancelled=false;s.subscribe(v=>{if(!cancelled&&v.phase==='reading'&&v.pageRange?.[0]===4){cancelled=true;s.cancel();}});await start(f,s);
  assert.equal(scope(f).sync.status,'cancelled');assert.equal(scope(f).sync.reason,'user');assert(scope(f).observations.length>=15);preserved(f);
  await start(f,s);assert.equal(scope(f).sync.status,'completed','a new run may start after cancellation');
  const g=setup(),t=runner(g);t.subscribe(v=>{if(v.phase==='waiting'&&v.checkpoint?.nextPage===4)t.pause();});await start(g,t);
  const u=runner(g);await start(g,u);assert.equal(u.view.error,'superseded');assert.equal(scope(g).sync.status,'paused','an unfinished checkpoint is never replaced silently');
  const cp=scope(g).sync;assert.equal((await g.store('entitlementSync',{id:cp.id,revision:cp.revision,status:'cancelled',reason:'user'})).status,'cancelled');
  await assert.rejects(g.store('entitlementSync',{id:cp.id,revision:cp.revision,status:'cancelled'}),/superseded/);
});

test('empty or short pages that contradict reported totals never advance the checkpoint',async()=>{
  const rows=many(20),f=setup({rows,pages:[rows.slice(0,5),rows.slice(5,10),[],rows.slice(15,20)]});const s=runner(f,{settings:{batchPages:2}});await start(f,s);
  assert.equal(s.view.error,'failed');assert.equal(scope(f).sync.nextPage,3);assert.equal(scope(f).observations.length,10);assert(scope(f).sync.uncertainty.includes('totals-changed'));preserved(f);
});

test('previously collected observations are refreshed, counted separately and never duplicated',async()=>{
  const f=setup({rows:many(12)});await f.collect({pageLimit:1});assert.equal(scope(f).observations.length,5);assert.equal(scope(f).sync,null);
  await start(f,runner(f));const cp=scope(f).sync;assert.equal(cp.added,7);assert.equal(cp.refreshed,5);assert.equal(scope(f).observations.length,12);assert.equal(f.E.syncView(f.stored).found,12);
  // The bounded pilot check still works afterwards and leaves the checkpoint alone.
  await f.collect({pageLimit:1});assert.deepEqual(scope(f).sync,cp);preserved(f);
});

test('explicit revoked, gifted and temporary access stay excluded through a full sync',async()=>{
  const rows=many(6),children=rows.map((r,i)=>({...child(r.id,r.title),...[{revoked:true},{giftStatus:'gifted'},{temporaryAccess:true}][i]??{}}));
  const f=setup({rows,children});await start(f,runner(f));
  assert.equal(scope(f).observations.filter(r=>r.purchaseStatus==='excluded').length,3);assert.equal(f.E.matchingItems(f.stored).length,3);
  assert(scope(f).observations.every(r=>r.activationStatus==='unknown'));preserved(f);
});

test('refresh checks recent pages, widens for new purchases and keeps the last full result',async()=>{
  const rows=many(40),children=rows.map(r=>child(r.id,r.title)),f=setup({rows,children});await start(f,runner(f));
  const full=scope(f).sync;assert.equal(full.coverage,'accessible-pages-traversed');
  const added=many(12,'fresh');rows.unshift(...added);children.push(...added.map(r=>child(r.id,r.title)));
  const before=pages(f);const s=runner(f,{settings:{refreshPages:2}});await s.start({mode:'refresh',context:await f.store('entitlementContext'),confirmed:true});
  const cp=scope(f).sync;assert.equal(cp.mode,'refresh');assert.equal(cp.status,'completed');assert.equal(cp.coverage,'recent-pages');assert.equal(cp.historicalComplete,false);
  assert.equal(cp.targetPages,5,'growth of 12 widens to ceil(12/5)+2 pages');assert.equal(cp.added,12);assert.equal(scope(f).observations.length,52);
  assert(pages(f)-before<=7);assert.deepEqual(cp.lastFull,full.lastFull);preserved(f);
});

test('worker rejects forged progress, stale revisions, foreign leases and contradictory checkpoints',async()=>{
  const f=setup({rows:many(12)});await start(f,runner(f));const cp=scope(f).sync,{E,H}=f;
  for(const forged of [{...cp,status:'completed',nextPage:2},{...cp,uncertainty:['ordering-changed']},{...cp,reason:'whatever'},{...cp,status:'running',reason:'user'},{...cp,mode:'refresh',coverage:'accessible-pages-traversed'},{...cp,lastSignature:[['$ref','steam']]}])
    assert.throws(()=>E.checkpoint(forged));
  const backup=H.createLibraryBackup(f.stored);backup.libraryEntitlements.scopes[0].sync.status='completed';backup.libraryEntitlements.scopes[0].sync.nextPage=1;assert.throws(()=>H.restoreBackupState(backup),/checkpoint/);
  const lease='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444',scopeRef={principalId:'principal-A',userId:'hub-A'};
  await assert.rejects(f.store('entitlementBegin',{confirmed:true,scope:scopeRef,sync:{id,revision:0,mode:'full',startPage:1,pageSize:5,lease,claim:false}}),/superseded/);
  await assert.rejects(f.store('entitlementBegin',{confirmed:true,scope:scopeRef,sync:{id:cp.id,revision:cp.revision+1,mode:'full',startPage:cp.nextPage,pageSize:5,lease,claim:true}}),/superseded/);
  for(const pageSize of [undefined,250,50])await assert.rejects(f.store('entitlementBegin',{confirmed:true,scope:scopeRef,sync:{id,revision:0,mode:'full',startPage:1,pageSize,lease,claim:true}}),/Invalid Library sync request/);
  const begun=await f.store('entitlementBegin',{confirmed:true,scope:scopeRef,sync:{id,revision:0,mode:'full',startPage:1,pageSize:5,lease,claim:true}});
  const scan={checkedAt:new Date().toISOString(),acquisition:'finished',coverage:'bounded',firstPage:1,pagesRead:1,reportedPages:3,reportedTotal:12,verifiedItems:0,unresolvedItems:0,duplicateItems:0,conflictingItems:0,failures:[]};
  await assert.rejects(f.store('entitlementCommit',begun.token,{scope:scopeRef,observations:[],scan,sync:{nextPage:3,signature:null,orderingChanged:false,uncertainty:[],status:'running',reason:null}}),/progress/);
  assert.deepEqual(scope(f).sync,cp);preserved(f);
});

test('a second tab claiming the sync supersedes the first without double commits',async()=>{
  const f=setup(),a=runner(f),b=runner(f);let claimed=false;
  a.subscribe(v=>{if(!claimed&&v.phase==='waiting'&&v.checkpoint?.nextPage===4){claimed=true;a.pause();}});await start(f,a);
  const cp=scope(f).sync;const first=a.start({mode:'full',resume:cp,context:await f.store('entitlementContext'),confirmed:true});
  const second=b.start({mode:'full',resume:cp,context:await f.store('entitlementContext'),confirmed:true});await Promise.all([first,second]);
  assert.equal([a.view.error,b.view.error].filter(e=>e==='superseded').length,1);assert.equal(scope(f).sync.status,'completed');assert.equal(scope(f).observations.length,37);preserved(f);
});

test('disabled build exposes no sync runner',()=>{
  const f=fixture({enabled:false});assert.throws(()=>f.E.createSync({fetcher:f.fetcher,store:f.store}),/not enabled/);
});

// Default page sizes: the read-only action honours larger limits than the site's pager.
const fast=(f,options={})=>runner(f,{...options,settings:{pageSize:null,refreshPages:1,...options.settings}});
const limits=f=>[...new Set(posts(f).map(r=>r.limit))];
const tracked=f=>async(path,init)=>{const r=await f.fetcher(path,init);if(init.method==='POST')f.requests.at(-1).limit=init.body.get('_1_limit');return r;};
test('full sync reads 1,000-row pages in one atomic batch per page, including the final partial page',async()=>{
  const f=setup({rows:many(2345)});await start(f,fast(f,{fetcher:tracked(f)}));
  const cp=scope(f).sync;
  assert.equal(cp.status,'completed');assert.equal(cp.coverage,'accessible-pages-traversed');assert.equal(cp.pageSize,1000);assert.deepEqual(cp.uncertainty,[]);
  assert.equal(cp.targetPages,3);assert.equal(cp.nextPage,4);assert.equal(cp.batches,3);assert.equal(cp.added,2345);assert.equal(scope(f).observations.length,2345);
  assert.deepEqual(limits(f),['1000']);assert.equal(pages(f),3+2,'three pages plus one boundary re-read per later batch');
  const writes=f.writes.filter(w=>w.libraryEntitlements);assert.deepEqual(writes.map(w=>w.libraryEntitlements.scopes[0].observations.length),[1000,2000,2345]);
  assert.equal(scope(f).lastScan.pageSize,1000);assert.equal(f.stored.hclLibraryEntitlementLease,null);preserved(f);
});
test('a row Humble skips at a large-page boundary is reported as missed, never as complete coverage',async()=>{
  const rows=many(2000),pagesData=[rows.slice(0,1000),[rows[999],...rows.slice(1001,2000)]];
  const f=setup({rows,pages:pagesData});await start(f,fast(f));
  const cp=scope(f).sync;assert.equal(cp.status,'completed');assert.equal(cp.coverage,'incomplete');assert.deepEqual(cp.uncertainty,['items-missed']);
  assert.equal(scope(f).observations.length,1999);assert(!scope(f).observations.some(r=>r.nativeId==='id-1000'));assert.equal(cp.lastFull.coverage,'incomplete');preserved(f);
});
test('if Humble caps the page size, the sync stops instead of skipping rows',async()=>{
  const f=setup({rows:many(1500)});
  const capped=async(path,init)=>{if(init.method==='POST'){init.body.set('_1_limit','500');}return f.fetcher(path,init);};
  const s=fast(f,{fetcher:capped});await start(f,s);
  assert.equal(s.view.phase,'stopped');assert.equal(s.view.error,'failed');assert.notEqual(scope(f)?.sync?.status,'completed');
  assert.equal(scope(f)?.observations.length??0,0);preserved(f);
});
test('an unfinished 5-row checkpoint resumes at its own page size after the upgrade',async()=>{
  const f=setup(),s=runner(f);s.subscribe(v=>{if(v.phase==='waiting'&&v.checkpoint?.nextPage===4)s.pause();});await start(f,s);
  assert.equal(scope(f).sync.pageSize,5);
  const t=fast(f,{fetcher:tracked(f)});await t.start({mode:'full',resume:scope(f).sync,context:await f.store('entitlementContext'),confirmed:true});
  const cp=scope(f).sync;assert.equal(cp.status,'completed');assert.equal(cp.pageSize,5);assert.equal(cp.coverage,'accessible-pages-traversed');assert.equal(scope(f).observations.length,37);
  assert.deepEqual(limits(f).filter(Boolean),['5']);preserved(f);
});
test('refresh reads one 50-row page by default and widens by 50-row pages for new purchases',async()=>{
  const rows=many(140),children=rows.map(r=>child(r.id,r.title)),f=setup({rows,children});await start(f,fast(f));
  const full=scope(f).sync;assert.equal(full.coverage,'accessible-pages-traversed');
  await fast(f,{fetcher:tracked(f)}).start({mode:'refresh',context:await f.store('entitlementContext'),confirmed:true});
  let cp=scope(f).sync;assert.equal(cp.pageSize,50);assert.equal(cp.targetPages,1);assert.equal(cp.coverage,'recent-pages');assert.equal(cp.added,0);assert.equal(cp.refreshed,50);
  const added=many(60,'fresh');rows.unshift(...added);children.push(...added.map(r=>child(r.id,r.title)));
  await fast(f,{fetcher:tracked(f)}).start({mode:'refresh',context:await f.store('entitlementContext'),confirmed:true});
  cp=scope(f).sync;assert.equal(cp.targetPages,4,'growth of 60 widens to ceil(60/50)+2 pages, here every reported page');assert.equal(cp.added,60);assert.equal(scope(f).observations.length,200);
  assert.deepEqual(cp.lastFull,full.lastFull);preserved(f);
});
