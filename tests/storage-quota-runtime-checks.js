/* Synthetic data only, inside a disposable installed extension page. */
async function installedQuotaChecks(limited) {
  const H = HumbleComicLibrary, checks = [];
  for(let n=0;n<100&&!document.querySelector('#library-count')?.textContent.includes('Storage usage:');n++)await new Promise(resolve=>setTimeout(resolve,20));
  const check = (condition, label) => { if (!condition) throw Error(label); checks.push(label); };
  const manual = {title:'Manual correction retained',kind:'comic',automaticKind:'book',source:'manual',providerItemId:'manual-fixture'};
  const baseline = {...H.LIBRARY_STATE_DEFAULTS, libraryItems:[manual], humbleProfileLabel:'Quota fixture', humbleAccountId:crypto.randomUUID(),
    purchaseSummaries:[{purchaseKey:'previous-order',sourceBundle:'Previous purchase',itemCount:1}],
    historicalLibraryItems:[{title:'Historical purchase',kind:'book',source:'humble',purchaseKey:'old-order'}],
    historicalPurchaseSummaries:[{purchaseKey:'old-order',sourceBundle:'Earlier bundle',itemCount:1}],
    mediaTypeOverrides:{'manual-fixture':'comic'}};
  check(document.querySelector('#library-count').textContent.includes('Storage usage:')&&!document.querySelector('#library-count').textContent.includes('10 MB quota'),'storage usage UI does not advertise an obsolete fixed quota');
  await chrome.storage.local.set(baseline);
  const granted = await chrome.permissions.contains({permissions:['unlimitedStorage']});
  check(granted === !limited, 'installed permission matches the large-storage test target');
  const titleTail = 'Synthetic bibliographic description '.repeat(10), bundle = 'Synthetic purchase bundle '.repeat(16);
  const large = Array.from({length:6500}, (_,i) => {
    const title = `Book ${i} ${titleTail}`, purchaseKey = `quota-order-${i}`, providerItemId = `${purchaseKey}:product:item-${i}`;
    const origin = {title,sourceBundle:bundle,purchaseKey,providerItemId,formats:['.epub','.pdf']};
    return {...origin,kind:'book',source:'humble',provenance:[origin,{...origin,purchaseKey:`second-${i}`,providerItemId:`second-${i}:product:item-${i}`} ]};
  });
  const purchases = large.map(item=>({purchaseKey:item.purchaseKey,sourceBundle:item.sourceBundle,itemCount:1}));
  const before = await chrome.storage.local.get(Object.keys(H.LIBRARY_STATE_DEFAULTS));
  const scan = await H.storageRequest('begin',{profileLabel:'Quota fixture',confirmed:true,fullRescan:true});
  const updates = {...scan.state,libraryItems:[manual,...large],purchaseSummaries:[...baseline.purchaseSummaries,...purchases],lastImport:{reconciled:true}};
  const payloadBytes = new Blob([JSON.stringify(updates)]).size;
  check(payloadBytes > 15.68 * 1024 * 1024, 'validated import payload exceeds the reported 15.68 MiB failure');
  if (limited) {
    let message = '';
    try { await H.storageRequest('commit',scan.token,updates); } catch(error) { message = error.message; }
    check(/Storage quota exceeded/.test(message), 'Chrome without unlimitedStorage reproduces the real browser quota rejection');
    const after = await chrome.storage.local.get(Object.keys(H.LIBRARY_STATE_DEFAULTS));
    const changed = Object.keys(before).filter(key=>JSON.stringify(before[key])!==JSON.stringify(after[key]));
    check(!changed.length, 'real rejected save preserves library, history and corrections'+(changed.length?'; changed fields: '+changed.join(','):''));
    check((await chrome.storage.local.get('hclSyncControl')).hclSyncControl === null,'rejected save releases the scan lock');
    return {checks};
  }
  await H.storageRequest('commit',scan.token,updates);
  const savedBytes = await chrome.storage.local.getBytesInUse();
  check(savedBytes > 15.68 * 1024 * 1024, `browser local storage holds ${savedBytes} bytes after the import (over 15.68 MiB)`);
  const next = await H.storageRequest('begin',{profileLabel:'Quota fixture',confirmed:true,fullRescan:false});
  await H.storageRequest('commit',next.token,{...next.state,libraryItems:[...next.state.libraryItems,{title:'Incremental purchase',kind:'book',source:'humble',purchaseKey:'incremental-order'}],
    purchaseSummaries:[...next.state.purchaseSummaries,{purchaseKey:'incremental-order',itemCount:1}],lastImport:{reconciled:false}});
  const saved = await chrome.storage.local.get(Object.keys(H.LIBRARY_STATE_DEFAULTS));
  check(saved.libraryItems.length === 6502 && saved.purchaseSummaries.length === 6502,'incremental update succeeds above the former quota');
  check(saved.libraryItems.some(item=>item.title===manual.title&&item.kind==='comic') && saved.mediaTypeOverrides['manual-fixture']==='comic', 'large writes preserve manual media corrections');
  check(saved.historicalLibraryItems[0].purchaseKey==='old-order' && saved.historicalPurchaseSummaries[0].purchaseKey==='old-order', 'large writes preserve historical purchase evidence');
  return {checks};
}
