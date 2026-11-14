(async()=>{
 const checks=[],check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
 const wait=async(condition,label='Game bundle did not settle')=>{for(let n=0;n<400;n++){if(condition())return;await new Promise(r=>setTimeout(r,25));}throw Error(label);};
 const titles=['Synthetic Owned Game','Synthetic Saga Remastered','Synthetic Saga 2 Remastered','Synthetic Strategy','Synthetic Shooter'];
 const summary=()=>document.querySelector('#hcl-summary')?.textContent.replace(/\s+/g,' ')??'';
 const controls=/Select your bundle|Bundle Details|Adjust Donation/;
 const state=title=>[...document.querySelectorAll('[data-testid="bundle-item-card"]')].find(card=>card.querySelector('img').alt===title)?.closest('li').querySelector('.hcl-status-button')?.dataset.state;
 try{
  // Before Humble renders the cards only page controls exist; they must never be reported as products.
  check(!document.querySelector('[data-testid="bundle-item-card"]'),'cards render after the page shell');
  check(collectBundleItems(bundleMediaContext('game')).length===0,'page headings in utility-class containers are not products');
  check(!controls.test(summary()),'no summary lists page controls before the cards render');
  await wait(()=>document.querySelectorAll('.hcl-status-button').length===5,'game cards did not receive badges');
  const items=collectBundleItems(bundleMediaContext('game'));
  check(JSON.stringify(items.map(i=>i.title).sort())===JSON.stringify([...titles].sort()),'every game card is extracted from its product-thumbnail cover');
  check(items.every(i=>i.kind==='game')&&!items.some(i=>controls.test(i.title)),'only game products are extracted; page controls are excluded');
  const tiers=Object.fromEntries(items.map(i=>[i.title,i.tier.price]));
  check(tiers['Synthetic Owned Game']===10&&tiers['Synthetic Saga Remastered']===10&&tiers['Synthetic Saga 2 Remastered']===20&&tiers['Synthetic Strategy']===20&&tiers['Synthetic Shooter']===30,'each game is in the lowest tier that offers it, including referenced tier items');
  await wait(()=>/Possible 1/.test(summary()));
  check(state('Synthetic Owned Game')==='owned','a saved game is Owned');
  check(state('Synthetic Saga Remastered')==='possible','a related saved title makes a remaster Possible, not Owned');
  check(['Synthetic Saga 2 Remastered','Synthetic Strategy','Synthetic Shooter'].every(t=>state(t)==='new'),'unmatched games are New');
  check(/Owned 1 · Owned elsewhere 0 · New 3 · Partial 0 · Possible 1/.test(summary()),'summary totals count the five games');
  check(/\$10\.00 tier: 0 new \/ 2/.test(summary())&&/\$20\.00 tier: 2 new \/ 4/.test(summary())&&/\$30\.00 tier: 3 new \/ 5/.test(summary()),'tier summaries are cumulative');
  check(!controls.test(summary()),'the summary never lists page controls');
  check(gameNativeNodes.every((n,i)=>n===document.querySelector('#game-cards').children[i]),'sorting preserves React keyed card nodes');
  // A card whose title cannot be read stops the comparison instead of reporting a partial or guessed list.
  const list=document.querySelector('#game-cards'),broken=list.firstElementChild.cloneNode(true);
  broken.querySelectorAll('.hcl-status-button, .hcl-related-titles').forEach(n=>n.remove());broken.querySelector('img').alt='';list.append(broken);
  window.dispatchEvent(new PopStateEvent('popstate'));
  await wait(()=>/Couldn’t read one of this bundle’s items, so ownership isn’t shown/.test(document.querySelector('#hcl-progress')?.textContent??''),'an unreadable card did not fail visibly');
  check(!document.querySelector('#hcl-summary')&&!document.querySelector('.hcl-status-button'),'an unreadable card removes the summary and badges');
  broken.remove();window.dispatchEvent(new PopStateEvent('popstate'));
  await wait(()=>document.querySelectorAll('.hcl-status-button').length===5&&/Possible 1/.test(summary()),'the comparison did not recover');
  check(true,'removing the unreadable card restores the comparison');
  window.redesignResult={checks};
 }catch(error){window.redesignResult={checks,error:error.stack??String(error)};}
 await fetch('/test-result',{method:'POST',body:JSON.stringify(window.redesignResult)});
})();
