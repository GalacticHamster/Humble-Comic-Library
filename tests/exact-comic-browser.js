// Real DOM + shipped extraction/indexing/matching/merge/badge/inspector path.
async function runExactComicPurchaseChecks(check) {
 const pairs=[['AUTUMNLANDS, VOL. 1 TP (Digital)','The Autumnlands Vol. 1'],['AUTUMNLANDS, VOL. 2 TP (Digital)','The Autumnlands Vol. 2'],['FREE AGENTS TP VOL 01 (Digital)','FREE AGENTS, VOL. 1']];
 const section=document.createElement('section');section.dataset.tier='5';
 const offered=pairs.map(([title])=>{const card=document.createElement('article');card.className='product';const image=document.createElement('img');image.className='item-image';image.alt=title;card.append(image);section.append(card);return {title,lookupTitle:title,kind:'book',element:image,container:card,tier:{label:'$5 tier',price:5}};});
 const current=pairs.map(([,title],i)=>({title,kind:'comic',source:'humble',purchaseKey:'purchase-'+i,providerItemId:'product-'+i,entitlement:'direct-download',purchasedAt:'2022-12-25',sourceBundle:'Original Humble bundle '+i}));
 const history=current.map(item=>({...item,kind:'book'})),before=JSON.stringify([current,history]);
 const collect=collectBundleItems;
 try {
  document.body.append(section);collectBundleItems=()=>offered;
  for(const mode of ['current with history','current without history','history only']){
   const records=mode==='history only'?[]:current,archive=mode==='current without history'?[]:history;
   const comparison={job:1,galactic:{enabled:false,resultsByKey:new Map()},wishlistItems:[]};
   await renderBundleComparison(createBundleLibraryMatcher(records,'book',archive),'book',[],[],comparison,1);
   for(let i=0;i<pairs.length;i++){
    const card=offered[i].container,button=card.querySelector('.hcl-status-button');
    check(card.querySelectorAll('.hcl-status-button').length===1,mode+': exactly one current badge per card');
    check(button?.textContent===(mode==='history only'?'Check ownership':'Owned'),mode+': final badge for '+pairs[i][0]);
    check(card.title.includes(pairs[i][1])&&pairs.every((pair,j)=>j===i||!card.title.includes(pair[1])),mode+': tooltip retains only the correct candidate for '+pairs[i][0]);
    button.click();const dialog=document.querySelector('#hcl-match-inspector');
    check(dialog?.open&&dialog.textContent.includes(pairs[i][1]),mode+': per-card evidence opens correct purchase');
    check(mode==='history only'?dialog.textContent.includes('not observed'):!dialog.textContent.includes('Previously recorded'),mode+': current evidence is not replaced by history');
    dialog.querySelector('button').click();
   }
  }
  check(JSON.stringify([current,history])===before,'Comic projection preserves source categories, purchase identifiers and history');
 } finally {
  collectBundleItems=collect;section.remove();
  await renderBundleComparison(createBundleLibraryMatcher(fixtureStored.libraryItems,'book'),'book',[],fixtureStored.customCollectionMappings,{job:1,galactic:createGalacticLookup(fixtureStored.galacticLibraryExtensionId),wishlistItems:fixtureStored.wishlistItems},1);
 }
}
