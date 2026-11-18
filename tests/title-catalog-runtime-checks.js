/* Installed Options checks; synthetic libraries in disposable profiles only. */
async function installedRuntimeChecks(phase) {
  const H=HumbleComicLibrary,E=HumbleLibraryEntitlements,checks=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const store=(...args)=>H.storageRequest(...args),u=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const account='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
  const page=window.wrappedJSObject??window;
  const originalURL=page.URL.createObjectURL,originalClick=page.HTMLAnchorElement.prototype.click;
  let exported;
  const expose=fn=>typeof exportFunction==='function'?exportFunction(fn,page):fn;
  page.URL.createObjectURL=expose(blob=>{exported=blob.text();return originalURL.call(page.URL,blob);});
  page.HTMLAnchorElement.prototype.click=expose(()=>{});
  const catalog=async(csv=false)=>{
    exported=null;document.getElementById(csv?'export-catalog-csv':'export-catalog').click();
    const end=Date.now()+10000;while(!exported&&Date.now()<end)await new Promise(r=>setTimeout(r,20));
    if(!exported)throw Error('Title catalog export did not produce a Blob.');
    return csv?exported:JSON.parse(await exported);
  };
  const render=async()=>{await LibraryBrowser.renderOptions();LibraryBrowser.setState({view:'titles',search:'',scope:'title',media:'',metadata:'',sort:'title-asc',page:0,pageSize:50});};
  const counts=()=>document.getElementById('library-count').textContent;
  const snapshot=async()=>JSON.stringify(await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS));
  try {
    if(phase==='reload'){
      await render();check((await catalog()).items.length===600&&/600 unique items/.test(counts()),'reloaded Options and restarted extension retain the same 600-title projection');
      return {checks};
    }
    const observation=(n,{foreign=false,gifted=false,title}={})=>E.observation({
      scope:{principalId:foreign?'principal-B':'principal-A',userId:foreign?'hub-B':'hub-A'},
      nativeId:u(n),parentId:u(900000+Math.floor(n/10)),title:title??'Saved catalog title '+n,source:'authenticated-humble-library',observedAt:'2026-11-15T00:00:00.000Z',namespace:n<300?'steam':'download_drm_free',
      eligibility:{expired:false,preOrdered:false,outOfStock:false,redeemable:true,directRedeem:false,parentPreOrder:false,revoked:null,temporaryAccess:null,giftStatus:gifted?'gifted':'unassigned',parentType:'bundle',integration:'none',redemptionGroups:'none',unavailableBefore:{state:'none',value:null},unavailableAfter:{state:'none',value:null},redeemedAt:{state:'none',value:null}}
    });
    const scope=(id,foreign,observations)=>({localAccountId:id,principalId:foreign?'principal-B':'principal-A',userId:foreign?'hub-B':'hub-A',profileLabel:foreign?'Other':'Main',observations,lastScan:null});
    const records=Array.from({length:600},(_,i)=>observation(i));
    const baseline={...H.LIBRARY_STATE_DEFAULTS,humbleAccountId:account,humbleProfileLabel:'Main',mediaTypeOverrides:{'saved-correction':'comic'},
      historicalLibraryItems:[{title:'Archived title',kind:'book',source:'humble',purchaseKey:'archive'}],historicalPurchaseSummaries:[{purchaseKey:'archive',itemCount:1}],
      libraryEntitlements:{version:1,scopes:[scope(account,false,[...records,observation(700000,{title:records[0].title}),observation(700001,{gifted:true})]),scope(other,true,[observation(800000,{foreign:true,title:'Other account only'})])]}};
    await store('replace',baseline);await render();const before=await snapshot();
    check(/of 600 items/.test(document.getElementById('preview-note').textContent),'Titles displays 600 unique native titles with no legacy title collection');
    const nativeCatalog=await catalog();
    check(nativeCatalog.items.length===600,'catalog includes the 600 visible native titles instead of an empty legacy-only export');
    const csv=await catalog(true),csvRows=csv.replace(/^﻿/u,'').trim().split('\r\n');
    check(csvRows.length===601&&csvRows[0]==='"Title","Media type","Purchase status","First purchased","Last purchased","Purchase count","Purchase count confidence","Source","Bundle / purchase name","Purchase dates"'&&csvRows.slice(1).every(r=>/^"[^"]*","[^"]*","Purchased","[^"]*","[^"]*","\d+","Exact","Humble Library",/u.test(r))&&!/activation/iu.test(csv),'installed CSV lists the same 600 native titles as Purchased from the Humble Library, with a numeric exact purchase count and no activation wording');
    check(/600 unique items/.test(counts())&&/300 games/.test(counts())&&/300 unclassified/.test(counts()),'summary counts the same known and unclassified native titles');
    check(/0 historical purchase records/.test(counts())&&/61 synced Humble Library purchase groups/.test(counts()),'summary distinguishes historical orders from synced native purchase groups');
    check(nativeCatalog.items.filter(i=>i.mediaType==='unclassified').length===300&&new Set(nativeCatalog.items.map(i=>i.title)).size===600,'unclassified titles survive export and separate purchase copies do not duplicate catalog titles');
    check(nativeCatalog.items.every(i=>Object.keys(i).every(k=>['title','mediaType'].includes(k))),'catalog includes no account, purchase, key or native identifiers');
    const groups=document.getElementById('library-view-groups');groups.checked=true;groups.dispatchEvent(new Event('change',{bubbles:true}));
    check(/61 purchase groups/.test(document.getElementById('preview-note').textContent),'Bundles & Orders retains separate purchases and excluded copies');
    check(await snapshot()===before,'browsing, summary and export do not write purchases, archives, observations or corrections');
    const backup=H.createLibraryBackup(await chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS));
    await store('replace',H.restoreBackupState(backup));await render();
    check((await catalog()).items.length===600&&await snapshot()===before,'backup restore preserves the native title projection and all saved evidence');
    await store('replace',{...baseline,humbleAccountId:other,humbleProfileLabel:'Other'});await render();
    const foreign=await catalog();check(foreign.items.length===1&&foreign.items[0].title==='Other account only','account changes never mix native title catalogs');
    const oldItems=Array.from({length:600},(_,i)=>({title:'Historical title '+i,kind:i%2?'unclassified':'comic',source:'humble',purchaseKey:'order-'+Math.floor(i/10),sourceBundle:'Old bundle '+Math.floor(i/10)}));
    const legacyBackup={version:5,items:[...oldItems,{...oldItems[0],purchaseKey:'repeat-order'}],purchases:[{purchaseKey:'order-0',sourceBundle:'Old bundle 0',itemCount:10}]};
    const restored=H.restoreBackupState(legacyBackup);await store('replace',restored);await render();const oldBefore=await snapshot();
    check((await catalog()).items.length===600&&/600 unique items/.test(counts()),'older published backup without native records retains 600 unique historical titles');
    check(await snapshot()===oldBefore,'old-format upgrade and catalog projection preserve historical records and their duplicate purchase evidence');
    await store('replace',{...H.LIBRARY_STATE_DEFAULTS,purchaseSummaries:Array.from({length:600},(_,i)=>({purchaseKey:'summary-'+i,sourceBundle:'Order '+i,itemCount:10}))});await render();
    check((await catalog()).items.length===0&&/0 unique items/.test(counts()),'600 order summaries without contained title records correctly export an empty catalog');
    check((await catalog(true)).split('\r\n').length===2,'installed empty CSV retains a header row');
    await store('replace',baseline);await render();
    return {checks};
  } finally {
    page.URL.createObjectURL=originalURL;page.HTMLAnchorElement.prototype.click=originalClick;
  }
}
