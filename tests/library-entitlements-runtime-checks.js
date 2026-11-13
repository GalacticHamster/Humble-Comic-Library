/* Synthetic provider transport; shipped collector, messaging, worker and storage. */
async function installedEntitlementChecks(disabled=false,phase) {
  const E=HumbleLibraryEntitlements,H=HumbleComicLibrary,checks=[],check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
  const store=(operation,...args)=>H.storageRequest(operation,...args);
  if(phase==='resume')return installedSyncResume({store,check,checks});
  if(disabled){
    let fetched=false,rejected=false;
    try{await E.collect({confirmed:true,store,fetcher:async()=>{fetched=true;throw Error('Must not fetch');}});}catch{rejected=true;}
    check(rejected&&!fetched&&!E.ENABLED,'installed default collector gate prevents acquisition');
    const result=await chrome.runtime.sendMessage({type:'HCL_STORE',operation:'entitlementBegin',args:[{confirmed:true,scope:{principalId:'a',userId:'b'}}]});
    check(!result.ok,'installed default worker independently rejects entitlement writes');
    E.installPanel();check(!document.getElementById('hcl-library-entitlement-pilot'),'installed default package exposes no collector controls');
    await LibraryBrowser.renderOptions();check(LibraryBrowser.getGroups().native.enabled===false&&!LibraryBrowser.getGroups().groups.some(g=>g.source==='native'),'installed default package shows no native purchase groups');
    let runner=false;try{E.createSync({store,fetcher:async()=>{throw Error('Must not fetch');}});runner=true;}catch{}
    check(!runner,'installed default package cannot create a sync runner');
    const sync=await chrome.runtime.sendMessage({type:'HCL_STORE',operation:'entitlementSync',args:[{id:'44444444-4444-4444-8444-444444444444',revision:1,status:'cancelled'}]});
    check(!sync.ok,'installed default worker rejects sync checkpoint changes');return {checks};
  }
  check(E.ENABLED,'only disposable pilot build enables collector');
  const account='11111111-1111-4111-8111-111111111111';
  const baseline={...H.LIBRARY_STATE_DEFAULTS,humbleProfileLabel:'Synthetic A',humbleAccountId:account,libraryItems:[{title:'Legacy book',kind:'book',source:'humble',purchaseKey:'legacy',providerItemId:'legacy:product:book',manualKind:'book'}],purchaseSummaries:[{purchaseKey:'legacy',itemCount:1}],mediaTypeOverrides:{'legacy:product:book':'book'},historicalLibraryItems:[{title:'Earlier book',kind:'book',source:'humble',purchaseKey:'earlier'}],historicalPurchaseSummaries:[{purchaseKey:'earlier',itemCount:1}]};
  await store('replace',baseline);
  const committedBaseline=await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS);
  const row=n=>({id:'native-'+n,title:'Synthetic game '+n,type:'steam',userId:'hub-A',productEntitlementId:'parent-A'});
  const rows=Array.from({length:8},(_,n)=>row(n));let failPage=false,foreign=false,malformed=false,reads=0,liveShape=false,excludedShape=false,omitExclusion=false;
  const frames=components=>components.map((c,i)=>`${(i+1).toString(16)}:I${JSON.stringify([i+1,c.name==='UserLibrary'?['static/chunks/synthetic-library.js']:[],c.name])}`).join('\n')+'\n0:'+JSON.stringify(components.map((c,i)=>['$','$L'+(i+1).toString(16),null,c.props]))+'\n';
  const response=(body,status=200,type='text/x-component')=>({ok:status===200,status,headers:{get:()=>type},text:async()=>type==='text/x-component'&&status===200?'f0:X\nf0:{"ui":"synthetic stream"}\nf0:C\nf1:E{"digest":"synthetic unrelated UI error"}\n'+body:body});
  const htmlResponse=components=>response('<!doctype html><script>self.__next_f.push('+JSON.stringify([1,frames([...components,components[0]])])+')</script>',200,'text/html');
  const entitlement=r=>({...r,giftStatus:'unassigned',revoked:omitExclusion?undefined:excludedShape,expired:false,preOrdered:false,outOfStock:false,redeemable:true,directRedeem:liveShape?undefined:false,keyIntegrationId:liveShape?'synthetic-integration':null,unavailableBefore:null,unavailableAfter:liveShape?'2099-01-01T00:00:00.000Z':null,redeemedAt:liveShape?'2020-01-01T00:00:00.000Z':null,redemptionData:{keyFormatted:'SYNTHETIC_SECRET_NEVER_PERSIST'}});
  const fetcher=async(path,init={})=>{
    if(path==='/_next/static/chunks/synthetic-library.js')return response(`(0,r.createServerReference)("${'a'.repeat(40)}",r.callServer,void 0,r.findSourceMapURL,"filterUserLibrary")`,200,'text/javascript');
    if(path==='/home/library'&&init.method!=='POST')return htmlResponse([{name:'AuthProvider',props:{user:{id:'principal-A'}}},{name:'UserLibrary',props:{bundleItems:[{id:'group-A',productEntitlementId:'parent-A',userId:'hub-A',type:'bundle'}]}}]);
    if(path==='/home/library'&&init.method==='POST'){
      const page=Number(init.body.get('_1_page'));reads++;
      if(failPage&&page===2)return response('',503);
      return response('0:'+JSON.stringify({success:true,results:rows.slice((page-1)*Number(init.body.get('_1_limit')),page*Number(init.body.get('_1_limit'))).map(r=>({...r,userId:foreign?'foreign-hub':r.userId})),pagination:{page,totalPages:2,totalDocs:8}})+(malformed?'':'\n'));
    }
    if(path==='/home/library/parent-A')return htmlResponse([{name:'AuthProvider',props:{user:{id:'principal-A'}}},{name:'ProductKeysDownloads',props:{productEntitlementId:'parent-A',userLibraryItem:{id:'detail-A',preOrder:liveShape?undefined:false,entitlements:{redemptionGroups:[],downloads:rows.filter(r=>r.type==='download_drm_free').map(entitlement),keys:rows.filter(r=>r.type!=='download_drm_free').map(entitlement)}}}}]);
    throw Error('Unexpected fixture request');
  };
  const acquire=pageLimit=>E.collect({fetcher,store,confirmed:true,pageLimit});
  const first=await acquire(1);check(first.saved===5&&first.scan.coverage==='bounded','installed actual collector -> worker -> storage saves bounded native observations');
  failPage=true;const partial=await acquire(2);check(partial.saved===5&&partial.scan.coverage==='incomplete','installed later-page failure saves verified observations with incomplete coverage');
  failPage=false;reads=0;const complete=await acquire(2);let state=await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS);
  check(reads===2&&state.libraryEntitlements.scopes[0].observations.length===8,'installed retry reads known pages and adds unresolved observations without duplicate upserts');
  await acquire(2);state=await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS);check(state.libraryEntitlements.scopes[0].observations.length===8,'installed repeat acquisition keeps native identity stable');
  for(const name of ['libraryItems','purchaseSummaries','mediaTypeOverrides','historicalLibraryItems','historicalPurchaseSummaries'])check(JSON.stringify(state[name])===JSON.stringify(committedBaseline[name]),'installed preserves '+name);
  check(!JSON.stringify(state).includes('SYNTHETIC_SECRET'),'installed persistence excludes key values');
  check(state.libraryEntitlements.scopes[0].observations.every(r=>r.activationStatus==='unknown'),'installed key possession never becomes Steam activation');
  const backup=H.createLibraryBackup(state);await store('replace',H.restoreBackupState(backup));
  check((await chrome.storage.local.get('libraryEntitlements')).libraryEntitlements.scopes[0].observations.length===8,'installed backup/restore preserves separate observations');
  const original=JSON.stringify((await chrome.storage.local.get('libraryEntitlements')).libraryEntitlements);
  foreign=true;let refused=false;try{await acquire(2);}catch{refused=true;}foreign=false;
  check(refused&&JSON.stringify((await chrome.storage.local.get('libraryEntitlements')).libraryEntitlements)===original,'installed foreign-account response cannot change prior observations');
  const stale=await store('entitlementBegin',{confirmed:true,expectedAccountId:state.humbleAccountId,expectedProfileLabel:state.humbleProfileLabel,scope:{principalId:'principal-A',userId:'hub-A'}});await store('replace',state);
  try{await store('entitlementCommit',stale.token,{});throw Error('Unexpected stale commit');}catch(error){check(/superseded/.test(error.message),'installed restore invalidates pending collector commits');}
  const matching=E.matchingItems(state);check(matching.length===8&&matching.every(r=>r.entitlement==='third-party-key'&&!r.purchaseKey),'installed matching projection remains distinct from historical transactions');
  const feed=await E.projectForGL(state,'synthetic-salt');check(feed.records.every(r=>r.activationStatus==='unknown')&&feed.format==='humble-library-entitlement-observations','installed GL projection is distinguished and never a Steam ownership claim');
  check(complete.scan.historicalComplete===false&&complete.scan.reconciliationAuthority==='none','installed accessible traversal has no historical or deletion authority');
  liveShape=true;const liveResult=await acquire(2);const liveState=await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS);
  check(liveResult.saved===8&&liveResult.scan.unresolvedItems===0,'installed live-shaped Steam records persist as observations without parser rejection');
  check(E.matchingItems(liveState).length===8&&liveState.libraryEntitlements.scopes[0].observations.every(r=>r.purchaseStatus==='purchased'&&r.activationStatus==='unknown'),'installed missing optional fields and redemption boundaries retain Purchased without Steam activation');
  const liveRestored=H.restoreBackupState(H.createLibraryBackup(liveState));check(liveRestored.libraryEntitlements.scopes[0].observations.every(r=>r.purchaseStatus==='purchased')&&JSON.stringify(liveRestored.mediaTypeOverrides)===JSON.stringify(committedBaseline.mediaTypeOverrides),'installed live-shaped backup retains Purchased status and historical corrections');
  excludedShape=true;await acquire(2);const excluded=await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS);
  check(E.matchingItems(excluded).length===0&&E.purchaseViews(excluded).every(r=>r.status==='Revoked'),'installed explicit revocation excludes matching while retaining individual observations');
  omitExclusion=true;excludedShape=false;await acquire(2);check(E.matchingItems(await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS)).length===0,'installed refresh cannot erase prior revocation by omitting its optional flag');
  omitExclusion=false;await acquire(2);check(E.matchingItems(await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS)).length===8,'installed explicit revocation clearing restores Purchased without changing native identity');
  await store('replace',excluded);
  excludedShape=false;for(const r of rows)r.type='download_drm_free';await acquire(2);const generic=await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS);
  check(E.purchaseViews(generic).filter(r=>r.status==='Purchased'&&r.mediaType==='unknown').length===8&&E.matchingItems(generic).length===0,'installed unknown-media DRM purchases remain visible and outside media-specific matching');
  const genericBackup=H.restoreBackupState(H.createLibraryBackup(generic));check(E.purchaseViews(genericBackup).length===16&&JSON.stringify(genericBackup.mediaTypeOverrides)===JSON.stringify(committedBaseline.mediaTypeOverrides),'installed backup preserves separate native namespaces, excluded copies and corrections');

  try{
    // Real panel, worker and storage with short (still floor-respecting) pacing.
    const transport=syncTransport(Array.from({length:8},(_,n)=>row(n)));await store('replace',state);
    E.installPanel({fetcher:transport.fetch,settings:{pageSize:5,batchPages:1,requestSpacingMs:500,batchDelayMs:2000}});const panel=document.getElementById('hcl-library-entitlement-pilot');
    check(!!panel,'installed pilot exposes a separate explicitly labeled sync panel');
    const button=action=>panel.querySelector('[data-action="'+action+'"]'),status=panel.querySelector('[role="status"]');
    const until=async(test,label,ms=20000)=>{const deadline=Date.now()+ms;while(!test()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));check(test(),label);};
    button('full').click();
    check(/Confirm/.test(status.textContent)&&transport.requests()===0,'installed panel refuses an unconfirmed account without reading');
    await until(()=>/Saved account:/.test(panel.querySelector('p').textContent),'installed panel names the saved account before syncing');
    panel.querySelector('input[type="checkbox"]').checked=true;button('full').click();
    await until(()=>!button('pause').hidden&&/Syncing/.test(status.textContent),'installed panel shows a running sync with Pause available');
    button('pause').click();
    await until(()=>!button('resume').hidden&&/^Paused/.test(status.textContent),'installed Pause stops after the current page and offers Resume');
    check([...panel.querySelectorAll('.hcl-sync-facts li')].some(li=>/Pages read: 1 of 2/.test(li.textContent)),'installed panel reports pages processed against the reported total');
    button('resume').click();
    await until(()=>/^Finished: read all 2 pages/.test(status.textContent),'installed Resume completes the accessible range from the checkpoint');
    check(/not proof of your complete purchase history/.test(status.textContent),'installed completion does not claim complete purchase history');
    check([...panel.querySelectorAll('.hcl-sync-facts li')].some(li=>/0 new, 8 already saved/.test(li.textContent)),'installed panel separates new and refreshed observations');
    check([...panel.querySelectorAll('details li')].some(li=>/Purchased/.test(li.textContent)),'installed panel lists saved Purchased items');
    // Live pilot regression: an open 50-item list must not push status/controls off screen.
    const style=document.createElement('style');style.textContent=await (await fetch(chrome.runtime.getURL('content.css'))).text();document.head.append(style);
    const details=panel.querySelector('details'),list=details.querySelector('ul');while(list.children.length<50)list.append(Object.assign(document.createElement('li'),{textContent:'Synthetic saved item — Purchased · Media: Unknown'}));details.open=true;
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const box=panel.getBoundingClientRect();
    check(box.top>=0&&box.bottom<=innerHeight&&list.scrollHeight>list.clientHeight&&status.getBoundingClientRect().top>=0,'installed panel keeps status on screen with the saved-items list open');
    style.remove();
  }finally{document.getElementById('hcl-library-entitlement-pilot')?.remove();await store('replace',state);}
  await installedSyncChecks({store,state,baseline:committedBaseline,row,check});
  return {checks};
}

// Synthetic Library transport shared by both phases (the resume phase runs after reload/restart).
function syncTransport(rows){
  let requests=0,failNext=null,hang=null;
  const frames=components=>components.map((c,i)=>`${(i+1).toString(16)}:I${JSON.stringify([i+1,c.name==='UserLibrary'?['static/chunks/synthetic-library.js']:[],c.name])}`).join('\n')+'\n0:'+JSON.stringify(components.map((c,i)=>['$','$L'+(i+1).toString(16),null,c.props]))+'\n';
  const response=(body,status=200,type='text/x-component')=>({ok:status===200,status,type:'basic',headers:{get:name=>name==='content-type'?type:null},text:async()=>body});
  const html=components=>response('<!doctype html><script>self.__next_f.push('+JSON.stringify([1,frames(components)])+')</script>',200,'text/html');
  const auth={name:'AuthProvider',props:{user:{id:'principal-A'}}};
  const child=r=>({...r,giftStatus:'unassigned',expired:false,preOrdered:false,outOfStock:false,redeemable:true,directRedeem:false,keyIntegrationId:null,unavailableBefore:null,unavailableAfter:null,redeemedAt:null,redemptionData:{keyFormatted:'SYNTHETIC_SECRET_NEVER_PERSIST'}});
  const fetch=async(path,init={})=>{
    requests++;
    if(hang&&hang(path,init))return new Promise(()=>{});
    if(failNext&&failNext(path,init)){const r=failNext.response;failNext=null;if(r==='network')throw TypeError('Synthetic network failure');return r;}
    if(path==='/_next/static/chunks/synthetic-library.js')return response(`(0,r.createServerReference)("${'a'.repeat(40)}",r.callServer,void 0,r.findSourceMapURL,"filterUserLibrary")`,200,'text/javascript');
    if(path==='/home/library'&&init.method!=='POST')return html([auth,{name:'UserLibrary',props:{bundleItems:[{id:'group-A',productEntitlementId:'parent-A',userId:'hub-A',type:'bundle'}]}}]);
    if(path==='/home/library'&&init.method==='POST'){const page=Number(init.body.get('_1_page'));return response('0:'+JSON.stringify({success:true,results:rows.slice((page-1)*Number(init.body.get('_1_limit')),page*Number(init.body.get('_1_limit'))),pagination:{page,totalPages:Math.max(1,Math.ceil(rows.length/Number(init.body.get('_1_limit')))),totalDocs:rows.length}})+'\n');}
    if(path==='/home/library/parent-A')return html([auth,{name:'ProductKeysDownloads',props:{productEntitlementId:'parent-A',userLibraryItem:{id:'detail-A',preOrder:false,entitlements:{redemptionGroups:[],downloads:[],keys:rows.map(child)}}}}]);
    throw Error('Unexpected fixture request');
  };
  return {fetch,requests:()=>requests,fail(test,response){failNext=Object.assign(test,{response});},hang(test){hang=test;}};
}
// Drives the real Options page: 2,345 synthetic native entitlements under one parent whose IDs are not UUIDs.
async function installedBrowserChecks({check}){
  const before=JSON.stringify(await chrome.storage.local.get(null)),tick=()=>new Promise(resolve=>setTimeout(resolve,50));
  const fire=(el,type)=>el.dispatchEvent(new Event(type,{bubbles:true}));
  await LibraryBrowser.renderOptions();
  const groupsRadio=document.getElementById('library-view-groups');groupsRadio.checked=true;fire(groupsRadio,'change');
  let rows=[...document.querySelectorAll('#library-preview > li.library-group')];
  const native=rows.find(r=>/Native Library/.test(r.textContent)),legacy=rows.find(r=>/Historical import/.test(r.textContent));
  check(rows.length===2&&native&&legacy&&/2345 titles/.test(native.textContent)&&/name appears after the next full sync/.test(native.textContent),'installed Bundles & Orders view lists the native purchase and the historical order separately');
  check([...document.querySelectorAll('.library-title-only')].every(l=>l.hidden)&&[...document.querySelectorAll('.library-group-only')].every(l=>!l.hidden)&&document.getElementById('library-search-scope').value==='both','installed view switch shows that view\'s filters and search scope');
  check(!native.querySelector('.library-group-contents'),'installed group contents are not rendered until expanded');
  const details=native.querySelector('details');details.open=true;await tick();
  const contents=details.querySelectorAll('.library-group-contents > li'),more=details.querySelector('.library-group-more');
  check(contents.length===100&&more&&!more.hidden&&!details.querySelector('.library-open-humble')&&/No verified Humble page/.test(details.textContent)&&/Activation unknown/.test(contents[0].textContent),'installed expanded group renders in batches and offers no unverified Humble link');
  more.click();check(details.querySelectorAll('.library-group-contents > li').length===200,'installed group shows more titles on request');
  const search=document.getElementById('library-search');search.value='Synthetic game 1042';fire(search,'input');
  rows=[...document.querySelectorAll('#library-preview > li.library-group')];
  check(rows.length===1&&/1 matching title/.test(rows[0].textContent),'installed contained-title search reports matching titles');
  rows[0].querySelector('details').open=true;await tick();
  check(/^Match: Synthetic game 1042$/.test(rows[0].querySelector('.library-group-contents > li .library-provenance-primary').textContent),'installed matching titles are listed first and marked');
  search.value='';fire(search,'input');
  const titlesRadio=document.getElementById('library-view-titles');titlesRadio.checked=true;fire(titlesRadio,'change');
  check(document.getElementById('library-search-label').textContent==='Find titles'&&[...document.querySelectorAll('.library-group-only')].every(l=>l.hidden),'installed Titles view returns with its own controls');
  check(JSON.stringify(await chrome.storage.local.get(null))===before,'installed browsing writes nothing to storage');
}
async function installedSyncChecks({store,state,baseline,row,check}){
  const E=HumbleLibraryEntitlements,H=HumbleComicLibrary,fast={sleep:async()=>{}},context=await store('entitlementContext');
  const legacy=['libraryItems','purchaseSummaries','mediaTypeOverrides','historicalLibraryItems','historicalPurchaseSummaries'];
  const unchanged=async label=>{const now=await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS);check(legacy.every(k=>JSON.stringify(now[k])===JSON.stringify(baseline[k])),label);};
  const current=async()=>E.syncView(await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS));
  const rows=Array.from({length:23},(_,n)=>row(n)),transport=syncTransport(rows);
  await store('replace',{...state,libraryEntitlements:{version:1,scopes:[]}});
  let runner=E.createSync({fetcher:transport.fetch,store,settings:{pageSize:5,batchPages:2},...fast});
  let writes=0;const counted=changes=>{if(changes.libraryEntitlements)writes++;};chrome.storage.onChanged.addListener(counted);
  await runner.start({mode:'full',context,confirmed:true});await new Promise(resolve=>setTimeout(resolve,100));chrome.storage.onChanged.removeListener(counted);
  let view=await current();
  check(view.checkpoint.status==='completed'&&view.checkpoint.coverage==='accessible-pages-traversed'&&view.saved===23&&view.found===23,'installed initial sync traverses all pages across bounded batches');
  check(view.checkpoint.batches===3&&writes===3,'installed each batch commits observations and checkpoint in one write');
  check(view.checkpoint.historicalComplete===false&&view.checkpoint.reconciliationAuthority==='none','installed completed sync claims no historical completeness or deletion authority');
  await unchanged('installed sync preserves legacy purchases, history and corrections');
  check(!JSON.stringify(await chrome.storage.local.get(null)).includes('SYNTHETIC_SECRET'),'installed sync persistence excludes key values');

  transport.fail((path,init)=>init.method==='POST'&&init.body.get('_1_page')==='4','network');
  runner=E.createSync({fetcher:transport.fetch,store,settings:{pageSize:5,batchPages:2},...fast});await runner.start({mode:'full',context,confirmed:true});
  view=await current();check(view.checkpoint.status==='completed'&&view.checkpoint.refreshed===23&&view.saved===23,'installed interrupted network request retries and completes without duplicates');

  let signedOut=false;
  runner=E.createSync({fetcher:async(path,init)=>signedOut&&path==='/home/library'?{ok:false,status:0,type:'opaqueredirect',headers:{get:()=>null},text:async()=>''}:transport.fetch(path,init),store,settings:{pageSize:5,batchPages:2},...fast});
  runner.subscribe(v=>{if(v.phase==='waiting'&&v.checkpoint?.nextPage===3)signedOut=true;});await runner.start({mode:'full',context,confirmed:true});
  view=await current();check(runner.view.error==='signed-out'&&view.checkpoint.status==='stopped'&&view.checkpoint.reason==='signed-out'&&view.checkpoint.nextPage===3,'installed sign-in expiry stops safely at the checkpoint');
  signedOut=false;await runner.start({mode:'full',resume:view.checkpoint,context,confirmed:true});
  view=await current();check(view.checkpoint.status==='completed','installed stopped sync resumes after sign-in');

  const snapshot=H.createLibraryBackup(await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS));let restored=false;
  runner=E.createSync({fetcher:transport.fetch,store,settings:{pageSize:5,batchPages:2},...fast});
  runner.subscribe(v=>{if(!restored&&v.phase==='waiting'&&v.checkpoint?.nextPage===3){restored=true;store('replace',H.restoreBackupState(snapshot));}});
  await runner.start({mode:'full',context,confirmed:true});
  view=await current();check(runner.view.error==='superseded'&&view.checkpoint.status==='completed'&&view.saved===23,'installed restore during a sync supersedes it and keeps the restored records');

  rows.unshift(row(100),row(101));
  runner=E.createSync({fetcher:transport.fetch,store,settings:{pageSize:5,batchPages:2,refreshPages:1},...fast});await runner.start({mode:'refresh',context,confirmed:true});
  view=await current();check(view.checkpoint.mode==='refresh'&&view.checkpoint.coverage==='recent-pages'&&view.checkpoint.added===2&&view.saved===25,'installed recent-purchase refresh adds new purchases without a full traversal');
  check(view.checkpoint.lastFull?.coverage==='accessible-pages-traversed','installed refresh keeps the last full sync result');
  await unchanged('installed refresh and restore preserve legacy purchases, history and corrections');

  // Default 1,000-row pages through the installed worker and storage.
  await store('replace',{...state,libraryEntitlements:{version:1,scopes:[]}});
  const large=syncTransport(Array.from({length:2345},(_,n)=>row(1000+n)));writes=0;chrome.storage.onChanged.addListener(counted);
  await E.createSync({fetcher:large.fetch,store,...fast}).start({mode:'full',context,confirmed:true});await new Promise(resolve=>setTimeout(resolve,100));chrome.storage.onChanged.removeListener(counted);
  view=await current();check(view.checkpoint.status==='completed'&&view.checkpoint.coverage==='accessible-pages-traversed'&&view.checkpoint.pageSize===1000&&view.checkpoint.batches===3&&writes===3&&view.saved===2345,'installed default sync reads 1,000-row pages with one atomic write per page');
  await unchanged('installed large-page sync preserves legacy purchases, history and corrections');
  await installedBrowserChecks({check});
  await unchanged('installed Bundles & Orders browsing preserves legacy purchases, history and corrections');

  // Leave an interrupted sync (status running, lease held) for the reload/restart phase.
  await store('replace',state);
  const interrupted=syncTransport(Array.from({length:8},(_,n)=>row(n)));let posts=0;interrupted.hang((path,init)=>init.method==='POST'&&++posts>1);
  E.createSync({fetcher:interrupted.fetch,store,settings:{pageSize:5,batchPages:1},...fast}).start({mode:'full',context,confirmed:true});
  const deadline=Date.now()+10000;while((await current()).checkpoint?.nextPage!==2&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
  view=await current();check(view.checkpoint?.status==='running'&&view.checkpoint.nextPage===2&&view.saved===8,'installed sync is interrupted mid-run with a persisted checkpoint');
}
async function installedSyncResume({store,check,checks}){
  const E=HumbleLibraryEntitlements,before=await chrome.storage.local.get(null),view=E.syncView(before);
  check(view.checkpoint?.status==='running'&&view.checkpoint.nextPage===2&&before.hclLibraryEntitlementLease,'installed interrupted checkpoint and lease survive reload and extension restart');
  const row=n=>({id:'native-'+n,title:'Synthetic game '+n,type:'steam',userId:'hub-A',productEntitlementId:'parent-A'});
  const runner=E.createSync({fetcher:syncTransport(Array.from({length:8},(_,n)=>row(n))).fetch,store,settings:{pageSize:5,batchPages:1},sleep:async()=>{}});
  await runner.start({mode:'full',resume:view.checkpoint,context:await store('entitlementContext'),confirmed:true});
  const after=await chrome.storage.local.get(null),done=E.syncView(after);
  check(done.checkpoint.status==='completed'&&done.checkpoint.coverage==='accessible-pages-traversed'&&done.saved===8&&done.checkpoint.added===0&&done.checkpoint.refreshed===8,'installed sync resumes after restart from the checkpoint without duplicates');
  check(['libraryItems','purchaseSummaries','mediaTypeOverrides','historicalLibraryItems','historicalPurchaseSummaries','profileArchives'].every(k=>JSON.stringify(after[k])===JSON.stringify(before[k])),'installed resumed sync leaves legacy purchases, history and corrections unchanged');
  check(!after.hclLibraryEntitlementLease,'installed completed sync releases its lease');
  return {checks};
}
