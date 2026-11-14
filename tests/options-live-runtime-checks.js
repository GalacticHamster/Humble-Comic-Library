/* Installed Options page stays current while a Library sync writes elsewhere. Real sync runner, collector,
   worker and storage; synthetic Humble responses with UUID identities. Runs in the installed options.html. */
async function installedRuntimeChecks(phase){
  const E=HumbleLibraryEntitlements,H=HumbleComicLibrary,checks=[],check=(v,label)=>{if(!v)throw Error(label);checks.push(label);};
  const store=(operation,...args)=>H.storageRequest(operation,...args),tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(test,label,ms=30000)=>{const end=Date.now()+ms;while(!(await test())&&Date.now()<end)await tick(25);check(await test(),label);};
  const fire=(el,type)=>el.dispatchEvent(new Event(type,{bubbles:true})),stats=()=>LibraryBrowser.getRefreshStats?.()??{renders:0,pending:false};
  const u=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,content=n=>'https://www.humblebundle.com/home/library/content/'+u(n);
  const account='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
  const rows=()=>[...document.querySelectorAll('#library-preview > li')];
  const rowFor=title=>rows().find(r=>r.querySelector('summary')?.textContent.startsWith(title+' —'));
  const search=async value=>{const input=document.getElementById('library-search');input.value=value;fire(input,'input');await tick(50);};
  const view=async name=>{const radio=document.getElementById(name==='groups'?'library-view-groups':'library-view-titles');radio.checked=true;fire(radio,'change');await tick(50);};
  const opened=[];
  // Record where Open on Humble goes without opening tabs.
  try{chrome.tabs.create=async options=>{opened.push(options.url);};}catch{}
  // Settled: no refresh pending or running, and none started for a while.
  const settled=async label=>{await tick(100);await until(async()=>{if(stats().pending)return false;const now=stats().renders;await tick(500);return !stats().pending&&stats().renders===now;},label,60000);};
  if(phase==='reload'){
    // After a page reload (and, in Firefox, an add-on restart) the page reads the same account's records.
    await until(()=>LibraryBrowser.getGroups().native.present,'reloaded Options reads native records for the active account');
    await view('titles');await search('saga');
    check(rowFor('Saga #1')?.querySelector('.library-title-purchases .library-open-humble')?.textContent==='Open on Humble','reloaded Options still offers the verified Saga #1 link');
    const state=await chrome.storage.local.get(['humbleAccountId','libraryEntitlements']);
    check(state.humbleAccountId===account&&state.libraryEntitlements.scopes.every(s=>s.localAccountId===account),'reloaded Options shows only the active account; no other account was created');
    return {checks};
  }
  check(E.ENABLED,'release package enables the Library sync');

  // Historical library only: 3 titles in two orders plus 120 filler comics, so Titles has three pages of 50.
  const filler=Array.from({length:120},(_,n)=>({title:'Filler comic '+String(n).padStart(3,'0'),kind:'comic',source:'humble',purchaseKey:'K3',sourceBundle:'Filler Bundle',purchasedAt:'2020-01-01T00:00:00.000Z'}));
  const baseline={...H.LIBRARY_STATE_DEFAULTS,humbleProfileLabel:'Synthetic A',humbleAccountId:account,
    libraryItems:[{title:'Saga #1',kind:'comic',source:'humble',purchaseKey:'K1',sourceBundle:'Image Comics Bundle',purchasedAt:'2021-01-01T00:00:00.000Z'},{title:'Monstress #1',kind:'comic',source:'humble',purchaseKey:'K1',sourceBundle:'Image Comics Bundle',purchasedAt:'2021-01-01T00:00:00.000Z'},
      {title:'Old Comic',kind:'comic',source:'humble',purchaseKey:'K2',sourceBundle:'Old Bundle',purchasedAt:'2019-01-01T00:00:00.000Z'},...filler],
    purchaseSummaries:[{purchaseKey:'K1',sourceBundle:'Image Comics Bundle',itemCount:2},{purchaseKey:'K2',sourceBundle:'Old Bundle',itemCount:1},{purchaseKey:'K3',sourceBundle:'Filler Bundle',itemCount:120}]};
  await store('replace',baseline);await LibraryBrowser.renderOptions();await settled('Options settles after the historical library is saved');
  const preserved=await chrome.storage.local.get(['libraryItems','purchaseSummaries','historicalLibraryItems','historicalPurchaseSummaries','mediaTypeOverrides','keyReminders','humbleProfileLabel']);
  check(!LibraryBrowser.getGroups().native.present&&!document.querySelector('.library-title-purchases .library-open-humble'),'Options is open before any native records exist');

  // Synthetic Humble Library: UUID purchases and entitlements, DRM-free comics, one gifted copy.
  const parents=new Map([[101,'Image Comics Bundle'],[102,'Indie Comics Bundle'],[103,'Monstress Deluxe Bundle']]);
  let library=[[1,101,'Saga #1'],[2,101,'Monstress #1'],[3,101,'New Comic'],[4,102,'Gift Comic',true],...Array.from({length:8},(_,n)=>[10+n,102,'Indie Story '+(n+1)])];
  const row=([id,parent,title,gifted])=>({id:u(id),type:'download_drm_free',title,userId:'hub-A',productEntitlementId:u(parent),giftStatus:gifted?'gifted':'unassigned'});
  const child=r=>({...r,expired:false,preOrdered:false,outOfStock:false,redeemable:true,directRedeem:false,keyIntegrationId:null,unavailableBefore:null,unavailableAfter:null,redeemedAt:null});
  const frames=components=>components.map((c,i)=>`${(i+1).toString(16)}:I${JSON.stringify([i+1,c.name==='UserLibrary'?['static/chunks/synthetic-library.js']:[],c.name])}`).join('\n')+'\n0:'+JSON.stringify(components.map((c,i)=>['$','$L'+(i+1).toString(16),null,c.props]))+'\n';
  const response=(body,status=200,type='text/x-component')=>({ok:status===200,status,type:'basic',headers:{get:name=>name==='content-type'?type:null},text:async()=>body});
  const html=components=>response('<!doctype html><script>self.__next_f.push('+JSON.stringify([1,frames(components)])+')</script>',200,'text/html');
  const auth={name:'AuthProvider',props:{user:{id:'principal-A'}}};
  const fetcher=async(path,init={})=>{
    if(path==='/_next/static/chunks/synthetic-library.js')return response(`(0,r.createServerReference)("${'a'.repeat(40)}",r.callServer,void 0,r.findSourceMapURL,"filterUserLibrary")`,200,'text/javascript');
    const listed=[...new Set(library.map(r=>r[1]))];
    if(path==='/home/library'&&init.method!=='POST')return html([auth,{name:'UserLibrary',props:{bundleItems:listed.map(p=>({id:'group-'+p,productEntitlementId:u(p),userId:'hub-A',type:'bundle'}))}}]);
    if(path==='/home/library'&&init.method==='POST'){const page=Number(init.body.get('_1_page')),limit=Number(init.body.get('_1_limit'));return response('0:'+JSON.stringify({success:true,results:library.slice((page-1)*limit,page*limit).map(row),pagination:{page,totalPages:Math.max(1,Math.ceil(library.length/limit)),totalDocs:library.length}})+'\n');}
    const parent=[...parents.keys()].find(p=>path==='/home/library/'+u(p));
    if(parent)return html([auth,{name:'ProductKeysDownloads',props:{productEntitlementId:u(parent),userLibraryItem:{id:'detail-'+parent,title:parents.get(parent),preOrder:false,entitlements:{redemptionGroups:[],downloads:library.filter(r=>r[1]===parent).map(r=>child(row(r))),keys:[]}}}}]);
    throw Error('Unexpected fixture request '+path);
  };
  // Every libraryEntitlements notification during a sync, to compare with what was rebuilt.
  let notifications=0;chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.libraryEntitlements)notifications++;});
  // With pause, the sync is paused after its first saved batch and resumed from the saved checkpoint,
  // so progress-only checkpoint writes reach Options as they do when a user pauses and resumes.
  const runSync=async(label,{pause=false}={})=>{
    const sync=E.createSync({fetcher,store,settings:{pageSize:5,batchPages:1,requestSpacingMs:500,batchDelayMs:2000}}),context=await store('entitlementContext');
    sync.start({mode:'full',context,confirmed:true});
    if(pause){
      await until(async()=>((await chrome.storage.local.get('libraryEntitlements')).libraryEntitlements?.scopes?.[0]?.observations?.length??0)>0,'the first batch is saved');
      sync.pause();await until(()=>!sync.active(),'the sync pauses after the current page');
      const cp=E.syncView(await chrome.storage.local.get({libraryEntitlements:{version:1,scopes:[]},humbleAccountId:null})).checkpoint;
      check(cp?.status==='paused','the paused checkpoint is saved');
      sync.start({mode:'full',resume:cp,context,confirmed:true});
    }
    await until(async()=>!sync.active()&&(await chrome.storage.local.get('libraryEntitlements')).libraryEntitlements?.scopes?.[0]?.sync?.status==='completed',label);
  };

  // Titles view: media filter, 50 per page, page 2, one row expanded and the list scrolled.
  await view('titles');
  const media=document.getElementById('library-filter-media');media.value='comic';fire(media,'change');
  const size=document.getElementById('library-page-size');size.value='50';fire(size,'change');
  document.getElementById('library-next').click();await tick(50);
  const firstOnPage=rows()[0],firstKey=firstOnPage.dataset.rowKeys;firstOnPage.querySelector('details').open=true;
  const list=document.getElementById('library-preview');list.scrollTop=60;await tick(50);const scrolled=list.scrollTop;
  const before=stats();notifications=0;
  await runSync('first full sync (paused and resumed) completes while Options stays open',{pause:true});await settled('Options settles after the first sync');
  const after=stats(),state=LibraryBrowser.getState();
  check(LibraryBrowser.getGroups().native.present&&rows()[0]?.isConnected,'the open Options page updated to the synced records without a reload');
  check(state.view==='titles'&&state.page===1&&state.pageSize===50&&state.media==='comic'&&document.getElementById('library-view-titles').checked,'view, media filter, page size and current page are kept');
  check(rows()[0].dataset.rowKeys===firstKey&&rows()[0].querySelector('details').open,'the expanded title on this page stays expanded');
  check(Math.abs(list.scrollTop-scrolled)<=2,'the list keeps its scroll position ('+scrolled+' then '+list.scrollTop+')');
  check(/page 2 of 3/.test(document.getElementById('preview-note').textContent),'the page note reflects the updated library');
  check(after.progressOnly>before.progressOnly&&after.modelBuilds-before.modelBuilds<notifications,'progress-only notifications did not rebuild the model ('+(after.modelBuilds-before.modelBuilds)+' rebuilds for '+notifications+' notifications, '+(after.progressOnly-before.progressOnly)+' progress-only)');
  // Combined purchases and direct links.
  check(LibraryBrowser.getReconciliation()?.stats.matched===1,'the historical order and the synced purchase are combined (presentation only)');
  await search('saga');
  // Collapsed titles are one line, with nothing beside or below the summary.
  check(rows().every(r=>r.children.length===1&&r.getBoundingClientRect().height<=r.querySelector('summary').getBoundingClientRect().height+2),'collapsed title rows are a single line with no link controls');
  const sagaRow=rowFor('Saga #1');sagaRow.querySelector('details').open=true;await tick(50);
  const sagaItems=[...sagaRow.querySelectorAll('.library-provenance-list > li')],saga=sagaRow.querySelector('.library-title-purchases .library-open-humble');
  const sagaStatus=sagaItems[0]?.querySelector('.library-provenance-secondary').textContent??'';
  check(sagaRow.querySelector('summary').textContent==='Saga #1 — 1 purchase'&&sagaRow.querySelectorAll('.library-provenance-list').length===1&&sagaItems.length===1&&/Purchased/.test(sagaStatus)&&!/Likely|match/.test(sagaStatus),'the imported order and its Library copy are one purchase: counted once, one row, shown as Purchased');
  const sagaBox=sagaItems[0].getBoundingClientRect(),buttonBox=saga.getBoundingClientRect();
  check(saga.textContent==='Open on Humble'&&buttonBox.right>sagaBox.right-4&&buttonBox.top<sagaBox.bottom&&buttonBox.bottom>sagaBox.top,'the verified link sits at the right of its purchase row, as in Bundles & Orders');
  saga.click();check(opened.at(-1)===content(1),'Open on Humble opens Saga #1’s own Library item page');
  await search('old comic');check(rowFor('Old Comic')&&!rowFor('Old Comic').querySelector('.library-open-humble'),'a historical-only title has no link');
  await search('gift');check(!rows().some(r=>/Gift Comic/.test(r.textContent)),'a gifted copy is not offered as an owned title');
  await search('new comic');check(rowFor('New Comic')?.querySelector('.library-title-purchases .library-open-humble')&&(rowFor('New Comic').querySelector('.library-title-purchases .library-open-humble').click(),opened.at(-1)===content(3)),'a title only in the Humble Library links to its item');

  // Bundles & Orders, grouped, searching one title, its purchase expanded; a second sync adds another copy.
  await view('groups');await search('monstress');
  const combined=rows().find(r=>/Historical \+ Native · Likely match/.test(r.querySelector('summary').textContent));
  check(rows().length===1&&combined,'Bundles & Orders shows one combined purchase containing the title');
  combined.querySelector('details').open=true;await tick(50);
  const purchaseKey=combined.dataset.rowKeys.split('\n')[0];
  library=[...library,[5,103,'Monstress #1']];
  await runSync('second full sync completes while Options stays open');await settled('Options settles after the second sync');
  check(LibraryBrowser.getState().view==='groups'&&document.getElementById('library-search').value==='monstress'&&rows().length===2,'the second purchase appears in the same search and view');
  const still=rows().find(r=>r.dataset.rowKeys.split('\n')[0]===purchaseKey);
  check(still?.querySelector('details').open&&still.querySelector('.library-group-contents .library-open-humble'),'the expanded purchase stays expanded with its item links');
  await view('titles');await search('monstress');
  const monstress=rowFor('Monstress #1');check(monstress.children.length===1&&monstress.querySelector('summary').textContent==='Monstress #1 — 2 purchases','a title bought twice collapses to one line that counts both purchases');
  monstress.querySelector('details').open=true;await tick(50);
  const copyButtons=[...monstress.querySelectorAll('.library-title-purchases .library-open-humble')],purchaseRows=[...monstress.querySelectorAll('.library-provenance-list > li')];
  check(purchaseRows.length===2&&copyButtons.length===2&&/Monstress Deluxe Bundle/.test(purchaseRows[1].textContent),'the two genuine copies are two purchase rows, each with its own link');
  for(const b of copyButtons)b.click();check(JSON.stringify(opened.slice(-2).sort())===JSON.stringify([content(2),content(5)].sort()),'each copy opens its own Library item');

  // Repeated notifications with unchanged data: no duplicate rows or extra rebuilds.
  const keys=()=>rows().map(r=>r.dataset.rowKeys),shown=JSON.stringify(keys()),builds=stats().modelBuilds;
  const current=await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS);
  for(let n=0;n<3;n++)await store('replace',current);
  await settled('Options settles after repeated notifications');
  check(JSON.stringify(keys())===shown&&new Set(keys()).size===keys().length,'repeated notifications leave one row per title');
  check(stats().modelBuilds-builds<=1,'repeated notifications rebuild at most once ('+(stats().modelBuilds-builds)+')');

  // Switching the active account: the other account’s records disappear, and return on switching back.
  await store('replace',{...current,humbleAccountId:other});await settled('Options settles after an account change');
  check(!LibraryBrowser.getGroups().native.present&&!document.querySelector('.library-title-purchases .library-open-humble'),'after an account change no native records or links of the previous account are shown');
  await store('replace',current);await settled('Options settles after switching back');
  check(LibraryBrowser.getGroups().native.present&&rowFor('Monstress #1')?.querySelector('.library-title-purchases .library-open-humble'),'switching back shows that account’s records again');

  const kept=await chrome.storage.local.get(Object.keys(preserved));
  check(JSON.stringify(kept)===JSON.stringify(preserved),'syncs and live refreshes left historical purchases, history, corrections, reminders and the account name unchanged');

  // Performance at the reported scale: 8,233 native entitlements and 234 historical orders.
  const big=structuredClone(current),scope=big.libraryEntitlements.scopes[0],template=scope.observations[0],orders=234;
  scope.observations=Array.from({length:8233},(_,n)=>({...structuredClone(template),nativeId:u(100000+n),title:'Scale title '+n,parentId:u(200000+n%600),parentTitle:'Scale purchase '+(n%600)}));
  big.libraryItems=[...current.libraryItems,...Array.from({length:2000},(_,n)=>({title:'Scale title '+n,kind:'comic',source:'humble',purchaseKey:'S'+(n%orders),sourceBundle:'Scale purchase '+(n%orders),purchasedAt:'2018-01-01T00:00:00.000Z'}))];
  big.purchaseSummaries=[...current.purchaseSummaries,...Array.from({length:orders},(_,n)=>({purchaseKey:'S'+n,sourceBundle:'Scale purchase '+n,itemCount:Math.ceil(2000/orders)}))];
  await store('replace',big);await settled('Options settles at scale');
  const scale=stats();let signature=0;for(let n=0;n<5;n++){const t=performance.now();HumbleLibraryBrowser.nativeSignature(big.libraryEntitlements,account);signature=Math.max(signature,performance.now()-t);}
  check(LibraryBrowser.getGroups().groups.length>800&&scale.lastModelMs<5000,`measured at scale: model and reconciliation ${scale.lastModelMs.toFixed(0)} ms, whole data render ${scale.lastRenderMs.toFixed(0)} ms, progress check ${signature.toFixed(1)} ms per notification`);
  await store('replace',current);await settled('Options settles after the scale check');
  return {checks};
}
