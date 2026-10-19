(async()=>{
  const checks=[],check=(ok,message)=>{if(!ok)throw Error(message);checks.push(message);};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async predicate=>{for(let n=0;n<300;n++){if(predicate())return;await pause(20);}throw Error('Lifecycle did not settle');};
  const panel=()=>document.querySelector('#hcl-summary');
  const settled=()=>panel()&&!document.querySelector('#hcl-progress')&&!panel().querySelector('.hcl-galactic-pending');
  const kind=lifecycleBook?'book':'game';
  try{
    await until(()=>window.lifecycleReleaseRead);
    check(!panel(),'Cold read has not manufactured a final analysis');
    await chrome.storage.local.set({libraryItems:[{title:'New story',kind}]});
    lifecycleReleaseRead();
    await until(()=>settled()&&panel().textContent.includes('Owned 1'));
    check(lifecycleWarm||lifecycleReadCount>=2,lifecycleWarm?'Warm bootstrap uses the saved library snapshot':'Storage event during first read invalidates the stale snapshot');
    check(!panel().querySelector('.hcl-summary-counts').textContent.includes('Check incomplete'),'Absent GL leaves local-only results final');
    check(panel().querySelector('#hcl-bundle-plan'),'First settled summary includes applicable purchase planning');
    check(!panel().querySelector('[data-section="series"]')&&!panel().querySelector('[data-section="contents"]'),'Cold summary omits unavailable contents and series analysis');
    panel().querySelector('.hcl-advanced').open=true;
    if(lifecycleBook){
      const card=document.createElement('article');card.className='product';card.innerHTML='<img class="item-image" alt="Hydrated series Vol 7"><h3>Hydrated series Vol 7</h3>';document.querySelector('[data-tier="5"]').append(card);
      await until(()=>settled()&&panel().querySelector('[data-section="series"]'));
      const oldPanel=panel();
      for(const [key,value]of Object.entries({run:'2024',language:'en'}))card.setAttribute('data-'+key,value);
      await until(()=>settled()&&panel()!==oldPanel);
      check(panel().querySelector('[data-section="series"]').textContent.includes('2024'),'Late metadata on an already labelled card recomputes Advanced scope');
      check(panel().querySelector('.hcl-advanced').open,'Metadata refresh preserves the open Advanced disclosure');
      const script=document.createElement('script');script.type='application/json';script.id='webpack-bundle-page-data';document.body.append(script);
      card.removeAttribute('data-run');card.removeAttribute('data-language');
      script.textContent=JSON.stringify({bundleData:{tier_item_data:{hydrated:{human_name:'Hydrated series Vol 7',run:'2025',language:'en'}}}});
      await until(()=>settled()&&panel().querySelector('[data-section="series"]').textContent.includes('2025'));
      check(true,'Late provider JSON updates series scope without reloading');
      // Include text-node hydration, not just replacing a script node.
      script.firstChild.data=JSON.stringify({bundleData:{tier_item_data:{hydrated:{human_name:'Hydrated series Vol 7',run:'2026',language:'en'}}}});
      await until(()=>settled()&&panel().querySelector('[data-section="series"]').textContent.includes('2026'));
      check(true,'Provider JSON text hydration invalidates the metadata analysis');
      card.remove();script.remove();
      await chrome.storage.local.set({libraryItems:[{title:'New story',kind},{title:'Owned collection',kind}],customCollectionMappings:[fixtureMapping('Owned collection',1),fixtureMapping('Offered collection',4),fixtureMapping('Overlapping collection',4)]});
      await until(()=>settled()&&panel().querySelector('[data-section="contents"]')?.textContent.includes('1 covered'));
      check(panel().querySelector('[data-section="series"]'),'Asynchronous local mappings supply correct coverage and series sections');
      check(panel().querySelector('.hcl-advanced').open,'Asynchronous library hydration preserves the existing open Advanced disclosure');
    }
    window.fixtureCentralDelayMs=450;
    const localPanel=panel();
    await chrome.storage.local.set({galacticLibraryExtensionId:'a'.repeat(32)});
    await until(()=>settled()&&panel()!==localPanel&&panel().querySelector('[data-section="galactic"]'));
    check(!lifecycleBook||panel().querySelector('[data-section="contents"]').textContent.includes('3 covered'),'Delayed central evidence updates settled contents counts');
    window.fixtureCentralFailure=true;
    await chrome.storage.local.set({galacticLibraryExtensionId:'b'.repeat(32)});
    await until(()=>settled()&&panel().textContent.includes('check incomplete'));
    check(panel().querySelector('.hcl-summary-counts').textContent.includes('Owned 1'),'Central failure preserves valid local ownership');
    check(!lifecycleBook||panel().querySelector('[data-section="contents"]').textContent.includes('1 covered'),'Central failure preserves valid local unit evidence');
    check(lifecycleBook||!panel().querySelector('[data-section="series"]'),'Game bundle has no meaningless series section');
    window.fixtureCentralFailure=false;window.fixtureCentralDelayMs=0;
    window.dispatchEvent(new Event('hcl-refresh-central'));
    await until(()=>settled()&&!panel().textContent.includes('check incomplete'));
    const warm=panel();window.dispatchEvent(new Event('resize'));
    await until(()=>settled()&&panel()!==warm);
    const stable=panel(),calls=fixtureCalls.length;await pause(350);
    check(panel()===stable&&fixtureCalls.length===calls,'Warm cached comparison settles without self-refresh loops');
    check(performance.getEntriesByType('navigation')[0]===lifecycleNavigation,'All asynchronous applicability updates occurred on one page navigation');
    await runPanelPresentationChecks(true,check);
    await fetch('/test-result',{method:'POST',body:JSON.stringify({checks})});
  }catch(error){await fetch('/test-result',{method:'POST',body:JSON.stringify({checks,error:error.message})});}
})();
