(async()=>{
 const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
 const pause=ms=>new Promise(done=>setTimeout(done,ms));
 const until=async predicate=>{for(let n=0;n<150;n++){if(predicate())return;await pause(20);}throw Error('Tier comparison did not settle');};
 const panel=()=>document.querySelector('#hcl-summary');
 const cards=()=>[...tierGrid.querySelectorAll(':scope > .tier-item-view')];
 const rowCounts=()=>{const rows=new Map();for(const card of cards()){const y=Math.round(card.getBoundingClientRect().top);rows.set(y,(rows.get(y)||0)+1);}return [...rows].sort((a,b)=>a[0]-b[0]).map(([,count])=>count);};
 const titles=()=>cards().map(card=>card.querySelector('img').alt);
 const navigation=performance.getEntriesByType('navigation')[0];
 try{
  await until(()=>panel()&&!document.querySelector('#hcl-progress'));
  check(!expandedInfo.querySelector('.hcl-status-button')&&!expandedInfo.classList.contains('hcl-card-new'),'Expanded details preview is never annotated as a product card');
  check(panel().querySelector('.hcl-summary-counts').textContent.includes('Owned 2')&&panel().querySelector('.hcl-summary-counts').textContent.includes('New 5'),'Initial summary counts seven offered games and excludes the preview');
  check(JSON.stringify(rowCounts())==='[3,3,1]','Seven-item grid keeps its normal three-column layout');
  for(const number of [4,2,4,7,4]){
   const before=titles().join('|'),oldPanel=panel();
   document.querySelector(`.js-tier-filter[data-tier="${number}"]`).click();
   await until(()=>document.querySelector('#hcl-progress')?.textContent.includes('Waiting for tier changes'));
   check(titles().join('|')===before,'Sorting waits for native tier animation completion before moving cards: '+number);
   completeNativeTier();
   await until(()=>panel()!==oldPanel&&!document.querySelector('#hcl-progress')&&cards().length===number);
   check(JSON.stringify(rowCounts())===JSON.stringify(number===7?[3,3,1]:number===4?[3,1]:[2]),'Tier '+number+' fills the first row, including reused cards');
   check(titles().join('|')===[...titles()].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})).join('|'),'Tier '+number+' retains alphabetical sorting');
   check(expandedInfo.style.order==='999'&&!expandedInfo.dataset.hclSortOrder,'Tier '+number+' leaves the native full-width details panel out of sorting');
   const owned=number===2?1:2;
   check(panel().querySelector('.hcl-summary-counts').textContent.includes('Owned '+owned)&&panel().querySelector('.hcl-summary-counts').textContent.includes('New '+(number-owned)),'Tier '+number+' updates ownership counts without counting detached views');
  }
  const stable=panel();expandedInfo.querySelector('img').alt='Another game preview';expandedInfo.querySelector('h2').textContent='Another game';await pause(350);
  check(panel()===stable,'Preview carousel changes do not restart ownership checks or sorting');
  // Reused annotated views can return asynchronously without a control click.
  beginNativeTier(2);completeNativeTier();await until(()=>cards().length===2&&!document.querySelector('#hcl-progress')&&panel().querySelector('.hcl-summary-counts').textContent.includes('New 1'));
  beginNativeTier(4);completeNativeTier();await until(()=>cards().length===4&&!document.querySelector('#hcl-progress')&&panel().querySelector('.hcl-summary-counts').textContent.includes('New 2'));
  check(JSON.stringify(rowCounts())==='[3,1]','Async return of already annotated cards refreshes analysis without a click or page reload');
  check(performance.getEntriesByType('navigation')[0]===navigation,'All tier transitions complete on the original page navigation');
  for(const card of cards())card.remove();
  check(collectBundleItems(bundleMediaContext('game')).length===0,'An expanded preview alone cannot become a fallback offered item');
  await fetch('/test-result',{method:'POST',body:JSON.stringify({checks})});
 }catch(error){await fetch('/test-result',{method:'POST',body:JSON.stringify({checks,error:error.message})});}
})();
