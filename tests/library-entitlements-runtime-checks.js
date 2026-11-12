/* Synthetic provider transport; shipped collector, messaging, worker and storage. */
async function installedEntitlementChecks(disabled=false) {
  const E=HumbleLibraryEntitlements,H=HumbleComicLibrary,checks=[],check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
  const store=(operation,...args)=>H.storageRequest(operation,...args);
  if(disabled){
    let fetched=false,rejected=false;
    try{await E.collect({confirmed:true,store,fetcher:async()=>{fetched=true;throw Error('Must not fetch');}});}catch{rejected=true;}
    check(rejected&&!fetched&&!E.ENABLED,'installed default collector gate prevents acquisition');
    const result=await chrome.runtime.sendMessage({type:'HCL_STORE',operation:'entitlementBegin',args:[{confirmed:true,scope:{principalId:'a',userId:'b'}}]});
    check(!result.ok,'installed default worker independently rejects entitlement writes');
    E.installPanel();check(!document.getElementById('hcl-library-entitlement-pilot'),'installed default package exposes no collector controls');return {checks};
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
      return response('0:'+JSON.stringify({success:true,results:rows.slice((page-1)*5,page*5).map(r=>({...r,userId:foreign?'foreign-hub':r.userId})),pagination:{page,totalPages:2,totalDocs:8}})+(malformed?'':'\n'));
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
    E.installPanel({fetcher});const panel=document.getElementById('hcl-library-entitlement-pilot');
    check(!!panel,'installed pilot exposes a separate explicitly labeled collector panel');
    const button=panel.querySelector('button'),status=panel.querySelector('[role="status"]');button.click();
    check(/Confirm/.test(status.textContent)&&!button.disabled,'installed panel refuses an unconfirmed account without starting');
    const contextDeadline=Date.now()+5000;while(!/Saved account:/.test(panel.querySelector('p').textContent)&&Date.now()<contextDeadline)await new Promise(resolve=>setTimeout(resolve,20));
    panel.querySelector('input').checked=true;panel.querySelector('select').value='1';button.click();
    check(button.disabled&&/Checking/.test(status.textContent),'installed panel demonstrates acquisition started before waiting for completion');
    const deadline=Date.now()+15000;
    while(button.disabled&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
    check(!button.disabled&&/^Saved 5 entitlement observations/.test(status.textContent),'installed actual panel click completes acquisition through the guarded worker');
    check([...panel.querySelectorAll('details li')].some(li=>/Purchased.*Media: Unknown/.test(li.textContent)),'installed generic Purchased display supports unknown media without a book/game guess');
  }finally{document.getElementById('hcl-library-entitlement-pilot')?.remove();await store('replace',state);}
  return {checks};
}
