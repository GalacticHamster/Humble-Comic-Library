// Synthetic provider transport only; the installed background writer and browser storage are real.
let partialFixture;
const setTimeout=callback=>globalThis.setTimeout(callback,0);
const fetch=async (url,...args)=>{
  if(url==='/api/v1/user/order?all=true')return {ok:true,json:async()=>partialFixture.keys.map(gamekey=>({gamekey,product:{human_name:'Fixture bundle'}}))};
  const match=typeof url==='string'&&url.match(/^\/api\/v1\/order\/([^?]+)/u);
  if(!match)return globalThis.fetch(url,...args);
  const key=decodeURIComponent(match[1]);partialFixture.requests.push(key);
  if(partialFixture.auth===key)return {ok:false,status:401};
  if(partialFixture.failed.includes(key))throw Error('Synthetic unavailable order');
  return {ok:true,status:200,text:async()=>JSON.stringify({...(partialFixture.mismatch===key?{gamekey:'wrong-order'}:{}),subproducts:[{human_name:'Book '+key,downloads:[{url:'https://example.invalid/book.pdf'}]}]})};
};
async function installedRuntimeChecks(phase='initial'){
  const H=HumbleComicLibrary,checks=[],check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
  const state=()=>chrome.storage.local.get(H.LIBRARY_STATE_DEFAULTS);
  const fixture=(keys,failed=[])=>partialFixture={keys,failed,requests:[]};
  const scan=(full=true,options={})=>importPurchases(()=>{},{fullRescan:full,profileLabel:'A',confirmed:true,...options});
  const reset=()=>H.storageRequest('replace',{...H.LIBRARY_STATE_DEFAULTS});
  const keys=Array.from({length:500},(_,i)=>'order-'+i);
  let saved;
  if(phase==='initial'){
  await reset();fixture(keys,[keys[499]]);const partial=await scan();saved=await state();
  check(saved.libraryItems.length===499&&saved.purchaseSummaries.length===499,'installed first partial persists 499 purchases');
  check(!saved.lastImport.reconciled&&saved.lastImport.failedPurchaseKeys[0]===keys[499],'partial retains retry without false reconciliation');
  check(purchaseImportScope(partial).includes('Saved 499 purchases')&&!purchaseImportScope(partial).includes('repeat a full'),'partial status offers useful Quick recovery');
  return {checks};
  }
  saved=await state();check(saved.libraryItems.length===499&&saved.lastImport.failedPurchaseKeys[0]===keys[499],'partial purchases and retry state survive actual extension-page reload');
  const item=saved.libraryItems[0],match=classifyLocalBundleItem({title:item.title,lookupTitle:item.title,kind:item.kind},createBundleLibraryMatcher(saved.libraryItems,item.kind),HumbleCollectionMappings.builtIn);
  check(HumbleOwnership.presentation.status(item,match)==='Owned','reloaded partial purchase retains its Owned badge');
  fixture(keys);await scan(false);saved=await state();
  check(partialFixture.requests.length===1&&saved.libraryItems.length===500,'Quick recovers only unresolved order without duplicate purchases');
  fixture(keys);await scan(false);check(!partialFixture.requests.length,'unchanged Quick makes zero detail requests');
  fixture(keys);await scan();check((await state()).lastImport.reconciled,'clean Full after partial establishes normal reconciliation');
  const baseline=await state();fixture(['b-good','b-bad'],['b-bad']);await scan(true,{profileLabel:'B',switchProfile:true});saved=await state();
  check(saved.humbleProfileLabel==='B'&&saved.libraryItems.length===1&&saved.profileArchives[0].backup.items.length===500,'partial B is isolated; A archived in same commit');
  await H.storageRequest('selectProfile',{profileLabel:'A',expectedActiveLabel:'B',confirmed:true});
  check((await state()).libraryItems.length===500,'saved A restored without B purchases');
  const before=JSON.stringify(await state());fixture(['good','auth']);partialFixture.auth='auth';let error='';
  try{await scan();}catch(e){error=e.message;}
  check(error.includes('login has expired')&&JSON.stringify(await state())===before,'explicit authentication rejection preserves complete prior library');
  fixture(['good','wrong']);partialFixture.mismatch='wrong';await scan();saved=await state();
  check(saved.libraryItems.length===501&&saved.lastImport.failedPurchaseKeys[0]==='wrong'&&!saved.libraryItems.some(x=>x.title==='Book wrong'),'mismatched order identity rejected without losing valid order');
  // Restore committed A for the controller's independent page-reload checks.
  await H.storageRequest('replace',baseline);
  return {checks};
}
