(async () => {
  const checks = [], check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async predicate => { for (let n=0;n<250;n++) { if (predicate()) return; await pause(20); } throw Error('Toggle lifecycle did not settle'); };
  const activity = {scans:0,matches:0,lookups:0};
  const scan = renderBundleComparison, match = classifyLocalBundleItem, lookup = queryGalacticLibrary;
  renderBundleComparison = function (...args) { activity.scans++; return scan.apply(this,args); };
  classifyLocalBundleItem = function (...args) { activity.matches++; return match.apply(this,args); };
  queryGalacticLibrary = function (...args) { activity.lookups++; return lookup.apply(this,args); };
  const snapshot = () => JSON.stringify({...activity,requests:toggleGLRequests});
  const badges = () => [...document.querySelectorAll('.hcl-status-button')];
  const states = () => JSON.stringify(badges().map(b=>[b.dataset.state,b.textContent,b.closest('li')?.getAttribute('title')]));
  const settled = () => badges().length===5 && !document.querySelector('.hcl-galactic-pending');
  const cycle = async () => {
    for (let n=0;n<10;n++) {
      document.querySelector('.hcl-summary-minimize').click();
      await pause(25);
      check(document.querySelector('#hcl-summary').classList.contains('hcl-summary-minimized'),'minimize applies immediately '+n);
      document.querySelector('.hcl-summary-expand').click();
      await pause(25);
      check(!document.querySelector('#hcl-summary').classList.contains('hcl-summary-minimized'),'expand applies immediately '+n);
    }
    // Let any incorrectly scheduled comparison run; this is an observation
    // window, not synchronization or a production cooldown.
    await pause(350);
  };
  try {
    await wait(settled);
    check(activity.scans>0&&activity.matches>=5&&activity.lookups>0&&fixtureCalls.length>0,'instrumentation observes actual initial scan, matching and GL requests');
    for (const state of ['owned','new','possible','partial','elsewhere']) check(badges().some(b=>b.dataset.state===state),state+' is present');
    const unfilteredScans=activity.scans;
    document.querySelector('.hcl-bundle-filter input').click();
    await wait(()=>activity.scans>unfilteredScans&&settled());
    const panel=document.querySelector('#hcl-summary'), nodes=badges(), before=states(), counts=snapshot();
    panel.querySelector('details.hcl-advanced').open=true;
    const cards=[...document.querySelector('[data-bundle-section] ul').children],order=cards.map(card=>card.style.order),filtered=cards.map(card=>card.classList.contains('hcl-bundle-filtered'));
    const position=panel.querySelector('select[aria-label="Bundle summary position"]');position.value='top-left';position.dispatchEvent(new Event('change'));
    let badgeMutations=0;
    const observer=new MutationObserver(records=>{for(const r of records)for(const node of [...r.addedNodes,...r.removedNodes])if(node.nodeType===1&&(node.matches('.hcl-status-button')||node.querySelector('.hcl-status-button')))badgeMutations++;});
    observer.observe(document.body,{subtree:true,childList:true});
    await cycle();
    check(snapshot()===counts,'ten minimize/expand cycles and position changes perform zero scans, matches, lookups or GL requests');
    check(panel===document.querySelector('#hcl-summary')&&nodes.every((node,i)=>node===badges()[i])&&badgeMutations===0,'summary and badges retain exact nodes without flicker');
    check(states()===before&&panel.dataset.position==='top-left','results, candidate explanations and panel position stay unchanged');
    const saved=await chrome.storage.local.get({bundleSummaryPreferences:{}});
    check(saved.bundleSummaryPreferences.minimized===false&&saved.bundleSummaryPreferences.position==='top-left','panel preference writes succeed and persist through the real storage path');
    check(panel.querySelector('.hcl-bundle-filter input').checked&&panel.querySelector('details.hcl-advanced').open&&cards.every((card,i)=>card.isConnected&&card.style.order===order[i]&&card.classList.contains('hcl-bundle-filtered')===filtered[i]),'filter, expanded sections, native cards and visual order are preserved');
    observer.disconnect();
    // Cross-tab preference events are presentation-only too.
    await chrome.storage.local.set({bundleSummaryPreferences:{minimized:true,position:'bottom-left'}});
    await wait(()=>panel.classList.contains('hcl-summary-minimized')&&panel.dataset.position==='bottom-left');
    await chrome.storage.local.set({bundleSummaryPreferences:{minimized:false,position:'top-left'}});
    await pause(250);check(snapshot()===counts,'external preference changes do not invalidate ownership');
    toggleHold=true;window.dispatchEvent(new Event('hcl-refresh-central'));
    await wait(()=>toggleLookupStarted);
    const pendingCounts=snapshot(), pendingNodes=badges();
    await cycle();
    check(snapshot()===pendingCounts&&pendingNodes.every((node,i)=>node===badges()[i]),'toggling during an in-flight check neither restarts nor cancels work or removes local badges');
    toggleHold=false;releaseToggleLookup();await wait(settled);
    check(activity.scans===JSON.parse(pendingCounts).scans,'original pending check finishes without a duplicate scan');
    const previous=activity.scans;
    document.querySelector('img[alt="Brand new book"]').alt='A genuinely changed book';
    updateToggleOffer();
    await wait(()=>activity.scans>previous&&settled());check(true,'a genuine card title change still refreshes');
    const updated=activity.scans;
    await chrome.storage.local.set({libraryItems:[{title:'A genuinely changed book',kind:'book'}]});
    await wait(()=>activity.scans>updated&&settled());check(true,'changed ownership data still refreshes');
    const beforeAccount=activity.scans;
    await chrome.storage.local.set({humbleProfileLabel:'Changed synthetic account',libraryItems:[],bundleSummaryPreferences:{minimized:false,position:'top-right'}});
    await wait(()=>activity.scans>beforeAccount&&settled());check(true,'account and preference changes in the same event still refresh ownership');
    const beforeLink=activity.scans;
    await chrome.storage.local.set({galacticLibraryExtensionId:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'});
    await wait(()=>activity.scans>beforeLink&&settled());check(true,'changed GL link still refreshes');
    const grid=document.querySelector('[data-bundle-section] ul'), newCard=grid.lastElementChild.cloneNode(true);
    newCard.querySelector('img').alt='Delayed native card';grid.append(newCard);
    updateToggleOffer();
    await wait(()=>badges().length===6&&!document.querySelector('.hcl-galactic-pending'));check(true,'late native card rendering still refreshes');
    newCard.remove();updateToggleOffer();await wait(settled);
    history.pushState({},'', '/store/unsupported');document.querySelector('h1').textContent='Store';
    await wait(()=>!document.querySelector('#hcl-summary')&&badges().length===0);check(true,'SPA navigation clears obsolete ownership');
    history.back();await wait(settled);check(true,'Back navigation rescans the active bundle');
    history.forward();await wait(()=>!document.querySelector('#hcl-summary'));history.back();await wait(settled);check(true,'Forward and Back keep legitimate routing refreshes');
    await fetch('/test-result',{method:'POST',body:JSON.stringify({checks,activity})});
  } catch(error) { await fetch('/test-result',{method:'POST',body:JSON.stringify({checks,activity,error:error.message+' '+JSON.stringify({activity,badges:badges().map(b=>b.dataset.state),pending:!!document.querySelector('.hcl-galactic-pending'),text:document.querySelector('#hcl-progress')?.textContent})})}); }
})();
