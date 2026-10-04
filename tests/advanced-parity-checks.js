async function runAdvancedParityChecks(hb,check) {
  await runPanelPresentationChecks(hb,check);
  const prefix=hb?'hcl':'fanatical-library',advanced=document.querySelector('.'+prefix+'-advanced');
  const sections=[...advanced.children].filter(node=>node.tagName==='DETAILS');
  check(!advanced.open&&sections.every(node=>!node.open),'Advanced and all analysis subsections default closed');
  check(sections.map(node=>node.querySelector('summary').textContent.split(' — ')[0]).join('|')==='Bundle contents and overlap'+(!hb&&location.pathname.includes('pick-and-mix')?' (available pool)':'')+'|Wishlist and purchase planning|Series coverage and gaps|Galactic Library details','Common Advanced sections have canonical labels and order');
  check(!advanced.querySelector(hb?'.hcl-diagnostics':'[data-fanatical-library-diagnostics]'),'Diagnostics remains absent unless enabled');
  check(!sections[0].querySelector('li'),'Detailed contents lists are not rendered before disclosure');
  const host=document.createElement('div');document.body.append(host);
  const pager=appendPagedUnits(host,Array.from({length:123},(_,n)=>n+1),number=>{const li=document.createElement('li');li.textContent=number;return li;},'test-paging');
  check(!pager.querySelector('li'),'Large unit lists start unmounted');pager.open=true;await new Promise(done=>setTimeout(done,35));
  check(pager.querySelectorAll('li').length===50&&pager.querySelector('li').textContent==='1','Unit details mount only the first 50 units');
  [...pager.querySelectorAll('button')].find(node=>node.textContent==='Next units').click();
  check(pager.querySelectorAll('li').length===50&&pager.querySelector('li').textContent==='51','Unit paging replaces rows without growing the DOM');
  [...pager.querySelectorAll('button')].find(node=>node.textContent==='Next units').click();
  check(pager.querySelectorAll('li').length===23&&pager.querySelectorAll('button')[1].disabled,'Final unit page is bounded and all units remain accessible');
  host.remove();
  const diagnosticKey=hb?'showDiagnostics':'fanaticalShowDiagnostics',selector=hb?'.hcl-diagnostics':'[data-fanatical-library-diagnostics]';
  const waitFor=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(done=>setTimeout(done,30));}throw Error('Diagnostics did not update');};
  await chrome.storage.local.set({[diagnosticKey]:true});await waitFor(()=>document.querySelector(selector));
  const diagnostic=document.querySelector(selector);
  check(diagnostic.closest('.'+prefix+'-advanced')&&!diagnostic.open&&diagnostic===diagnostic.parentElement.lastElementChild,'Enabled Diagnostics is closed and last in Advanced');
  await chrome.storage.local.set({[diagnosticKey]:false});await waitFor(()=>!document.querySelector(selector));
  check(!document.querySelector(selector),'Disabling Diagnostics immediately removes it from the active summary');
  if(hb){
    const current=document.querySelector('#hcl-summary'),counts=Object.fromEntries(['owned','elsewhere','new','partial','possible','unchecked'].map(key=>[key,0])),titles=Object.fromEntries(Object.keys(counts).map(key=>[key,[]]));
    renderComparisonSummary(counts,new Map(),titles,'book',[],{resolvedItems:[],galactic:createGalacticLookup('')});
    check(!document.querySelector('.hcl-advanced'),'No applicable analysis leaves Advanced absent');document.querySelector('#hcl-summary').replaceWith(current);
  }
}
