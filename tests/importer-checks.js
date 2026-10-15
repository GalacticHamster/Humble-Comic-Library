(async()=>{
  const checks=[],check=(condition,message)=>{if(!condition)throw Error(message);checks.push(message);};
  const wait=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Importer did not update');};
  try{
    await wait(()=>document.querySelector('#hcl-importer output')?.textContent);
    const panel=document.querySelector('#hcl-importer'),profile=panel.querySelector('.library-import-profile'),footer=panel.querySelector('.library-import-footer'),quick=panel.querySelector('[data-import-mode="new"]'),full=panel.querySelector('[data-import-mode="all"]');
    check(panel.children.length===3&&profile.children.length===3,'importer groups description, three account controls and footer into three rows');
    check(getComputedStyle(profile).display==='grid'&&footer.contains(panel.querySelector('output'))&&footer.contains(quick),'account controls and scan status have dedicated layout containers');
    check(quick.textContent==='Import new purchases'&&full.textContent==='Rescan all purchases','import buttons use the shared labels');
    check(panel.querySelector('details').textContent.includes('does not sign you in'),'account nickname help explains local scope');
    const hostReset=document.createElement('style');
    hostReset.textContent='summary { display:block; list-style:none; } summary::marker { content:""; } summary::-webkit-details-marker { display:none; }';
    document.head.append(hostReset);
    for(const details of panel.querySelectorAll('.library-import-description > details')){
      const summary=details.querySelector('summary'),label=summary.textContent;
      const arrowVisible=type=>getComputedStyle(summary).display==='list-item'&&getComputedStyle(summary).listStyleType===type&&getComputedStyle(summary,'::marker').content==='normal';
      check(!details.open&&arrowVisible('disclosure-closed'),label+' shows a closed disclosure arrow despite host page resets');
      summary.click();
      check(details.open&&arrowVisible('disclosure-open'),label+' opens with a downward disclosure arrow');
      summary.click();
      check(!details.open&&arrowVisible('disclosure-closed'),label+' closes with its disclosure arrow restored');
    }
    panel.querySelector('[data-profile-confirm]').checked=true;panel.querySelector('[data-profile-label]').dispatchEvent(new Event('input'));check(!panel.querySelector('[data-profile-confirm]').checked,'editing the account nickname requires fresh signed-in-account confirmation');
    const before=JSON.stringify(fixtureStored);quick.click();await wait(()=>panel.querySelector('output').textContent.startsWith('Import failed:'));
    check(JSON.stringify(fixtureStored)===before,'unconfirmed account cannot start import or replace ownership');
    window.confirm=()=>false;full.click();check(JSON.stringify(fixtureStored)===before,'cancelled full rescan leaves the active snapshot unchanged');
    const controls=[...profile.children];check(controls.every(label=>label.querySelector('input')),'each account control retains its visible associated label');
    const realFetch=window.fetch,detailRequests=[];
    const orders=[{gamekey:'pending'},{gamekey:'unchanged'}];
    window.fetch=async(url,...args)=>{
      if(url==='/api/v1/user/order?all=true')return {ok:true,json:async()=>orders};
      if(String(url).includes('/api/v1/order/')){
        detailRequests.push(url);
        return {ok:true,status:200,text:async()=>JSON.stringify({all_tpks:[{human_name:'Pending game',machine_name:'game',keyindex:0}]})};
      }
      return realFetch(url,...args);
    };
    Object.assign(fixtureStored,{humbleProfileLabel:'fixture',libraryItems:[],purchaseSummaries:orders.map(order=>({purchaseKey:order.gamekey,importVersion:9})),mediaImportVersion:9,
      keyReminders:[{id:'pending',purchaseKey:'pending',title:'Pending game',status:'unrevealed'}],keyReminderScan:{complete:true,purchaseKeys:['pending','unchanged'],baselinePurchaseKeys:['pending','unchanged']},lastImport:null});
    panel.querySelector('[data-profile-label]').value='fixture';panel.querySelector('[data-profile-confirm]').checked=true;
    quick.click();
    await wait(()=>panel.querySelector('output').textContent.startsWith('No new purchases; rechecking key status'));
    check(panel.querySelector('output').textContent.includes('existing purchase'),'in-progress importer identifies existing purchases as key-status rechecks');
    await wait(()=>!quick.disabled);
    check(panel.querySelector('output').textContent.startsWith('No new purchases; rechecked key status in 1 existing purchase; skipped 1 unchanged purchase'),'completed importer distinguishes key refreshes from new purchases');
    check(detailRequests.length===1,'key refresh skips unchanged purchase details');
    fixtureStored.keyReminders=[];detailRequests.length=0;
    quick.click();await wait(()=>!quick.disabled);
    check(detailRequests.length===0&&panel.querySelector('output').textContent.startsWith('No new purchases; no key-status refreshes or failed purchases to check'),'unchanged importer returns immediately without purchase-detail requests');
    fixtureStored.mediaImportVersion=7;for(const purchase of fixtureStored.purchaseSummaries)delete purchase.importVersion;
    window.fetch=async(url,...args)=>{
      if(url==='/api/v1/user/order?all=true')return {ok:true,json:async()=>orders};
      if(String(url).includes('/api/v1/order/')){detailRequests.push(url);return {ok:true,status:200,text:async()=>JSON.stringify({subproducts:[{human_name:'Sample Comic Book',machine_name:'comic',downloads:[{format:'zip'}]}]})};}
      return realFetch(url,...args);
    };
    quick.click();await wait(()=>!quick.disabled);
    check(detailRequests.length===2&&fixtureStored.mediaImportVersion===9&&fixtureStored.purchaseSummaries.every(p=>p.importVersion===9),'version 7 metadata upgrade fetches each old purchase and records successful current-version results');
    check(panel.querySelector('output').textContent.includes('updated saved details for 2 purchases')&&panel.querySelector('output').textContent.includes('one-time update'),'completed metadata backfill is distinguished from a normal incremental import');
    detailRequests.length=0;quick.click();await wait(()=>!quick.disabled);check(detailRequests.length===0,'completed upgrade returns the importer to skipping unchanged purchases');
    check(!panel.querySelector('[data-import-mode="metadata"]')&&!panel.querySelector('[data-metadata-cancel]'),'normal importer has no separate product-ID maintenance controls');
    const old={title:'Old book',kind:'book',source:'humble',purchaseKey:'saved-order',sourceBundle:'Historical bundle',purchasedAt:'2020-01-01T00:00:00Z'};
    Object.assign(fixtureStored,{libraryItems:[old],historicalLibraryItems:[structuredClone(old)],purchaseSummaries:[{purchaseKey:'saved-order'}],historicalPurchaseSummaries:[],mediaImportVersion:1,keyReminders:[],keyReminderScan:null,hclSyncControl:null});
    detailRequests.length=0;
    window.fetch=async(url,...args)=>{
      if(url==='/api/v1/user/order?all=true')return {ok:true,json:async()=>[{gamekey:'saved-order'}]};
      if(String(url).startsWith('/api/v1/order/')){detailRequests.push(url);return {ok:true,status:200,text:async()=>JSON.stringify({subproducts:[{human_name:'Old book',machine_name:'source-book',downloads:[{format:'pdf'}],authors:['Author']}]})};}
      return realFetch(url,...args);
    };
    quick.click();await wait(()=>!quick.disabled);
    check(fixtureStored.libraryItems.length===1&&fixtureStored.libraryItems[0].providerItemId==='saved-order:product:source-book'&&fixtureStored.libraryItems[0].sourceBundle===old.sourceBundle&&fixtureStored.libraryItems[0].purchasedAt===old.purchasedAt,'Import new purchases automatically recovers legacy IDs and preserves original purchase facts');
    check(fixtureStored.historicalLibraryItems[0].providerItemId==='saved-order:product:source-book','the normal import also recovers historical source identities');
    detailRequests.length=0;quick.click();await wait(()=>!quick.disabled);check(detailRequests.length===0,'a migrated legacy library returns to normal incremental imports');
    window.fetch=realFetch;
    await fetch('/test-result',{method:'POST',body:JSON.stringify({checks})});
  }catch(error){await fetch('/test-result',{method:'POST',body:JSON.stringify({checks,error:error.message})});}
})();
