// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
/* Opening review uses Chrome's trusted options route, not a page-supplied URL. */
if (typeof importScripts === 'function') importScripts('purchase-snapshot.js','purchase-transfer.js','purchase-sync.js','purchase-adapters.js','theme.js','shared.js','collection-mappings.js','entitlement-share.js');
const libraryStore=HumbleComicLibrary.createSyncStore(chrome.storage.local,{onInvalidated:events=>purchaseSync.notifyInvalidated(events)});
const appearanceService=GalacticHamsterTheme.createService({runtime:chrome.runtime,companion:true,
  read:async()=>{const value=await chrome.storage.local.get({galacticHamsterAppearance:null});return value.galacticHamsterAppearance;},
  save:prefs=>libraryStore.execute('patch',[{galacticHamsterAppearance:prefs}]),
  resolveId:async()=>{const value=await chrome.storage.local.get({galacticLibraryExtensionId:''});return HumbleComicLibrary.resolveGalacticId(value.galacticLibraryExtensionId,chrome.runtime);}});
GalacticHamsterTheme.register(appearanceService,chrome.runtime);
chrome.runtime.onMessageExternal?.addListener((message,sender,respond)=>{
  if(!['PING','GET_STATUS','OPEN_REVIEW','GET_IMPORTER_STATUS'].includes(message?.type))return false;
  (async()=>{
    const {galacticLibraryExtensionId:id=''}=await chrome.storage.local.get({galacticLibraryExtensionId:''});
    if(!HumbleComicLibrary.trustedGalacticSender(sender.id,id,chrome.runtime))return {ok:false,error:'Companion is not allowed.'};
    if(message.apiVersion!==1&&!(message.apiVersion===undefined&&['PING','GET_STATUS'].includes(message.type)))return {ok:false,error:'Unsupported companion API version.'};
    if(message.type==='GET_IMPORTER_STATUS'){if(!Number.isInteger(message.tabId))return {ok:false};try{const r=await chrome.tabs.sendMessage(message.tabId,{type:'GH_IMPORTER_PAGE_STATUS'});return {ok:true,present:r?.present===true};}catch{return {ok:true,present:false};}}
    if(message.type!=='OPEN_REVIEW')return {ok:true,apiVersion:1,appVersion:chrome.runtime.getManifest?.().version??'1.0.2',ready:true,purchaseProvider:'humble',capabilities:{centralReview:true,providerImporter:1,importerPageStatus:1}};
    await chrome.runtime.openOptionsPage();return {ok:true,apiVersion:1};
  })().then(respond,()=>respond({ok:false,error:'Could not open source review.'}));return true;
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='HCL_STORE')return false;
  const own=sender.id===chrome.runtime.id;
  const extensionPage=own&&typeof sender.url==='string'&&sender.url.startsWith(chrome.runtime.getURL(''));
  let humble=false;try{humble=own&&new URL(sender.url).origin==='https://www.humblebundle.com';}catch{}
  if(!extensionPage&&!humble){respond({ok:false,error:'Untrusted library request.'});return false;}
  if(['replace','remove','shareSnapshot','verifyShareSnapshot','handoffAccounts','handoffSnapshot','handoffImport','handoffInventory','handoffPreview'].includes(message.operation)&&!extensionPage&&!(message.operation==='remove'&&JSON.stringify(message.args)==='[["hclPurchaseFocus"]]')){respond({ok:false,error:'Open Extension options to replace or clear the library.'});return false;}
  if(['selectProfile','renameProfile'].includes(message.operation)&&!extensionPage&&!(humble&&new URL(sender.url).pathname.startsWith('/home/purchases'))){respond({ok:false,error:'Manage saved accounts in Extension options or the purchase importer.'});return false;}
  const args=Array.isArray(message.args)?[...message.args]:[];
  if(message.operation==='begin')args[1]=sender.tab?.id??null;
  if(message.operation==='commit')args[2]=sender.tab?.id??null;
  if(message.operation==='abort')args[1]=sender.tab?.id??null;
  libraryStore.execute(message.operation,args).then(result=>respond({ok:true,result}),error=>respond({ok:false,error:error.message}));return true;
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!['HCL_SHARE_ENTITLEMENTS','HCL_REMOVE_SHARED_ENTITLEMENTS'].includes(message?.type))return false;
  const ownPage=sender.id===chrome.runtime.id&&typeof sender.url==='string'&&sender.url.startsWith(chrome.runtime.getURL(''));
  if(!ownPage||message.confirmed!==true){respond({ok:false,error:'Open Extension options and confirm the Humble account before sharing.'});return false;}
  (async()=>{
    const stored=await chrome.storage.local.get({galacticLibraryExtensionId:''}),id=HumbleComicLibrary.resolveGalacticId(stored.galacticLibraryExtensionId,chrome.runtime);
    if(!HumbleComicLibrary.isExtensionId(id))throw new Error('Configure the Galactic Library link first.');
    if(message.type==='HCL_REMOVE_SHARED_ENTITLEMENTS'){
      const response=await HumbleEntitlements.request(chrome.runtime,id,{type:'REMOVE_ENTITLEMENT_FEED',apiVersion:1});if(!response?.ok||response.apiVersion!==1)throw new Error(response?.error??'Could not remove shared reminders.');return {ok:true,count:0};
    }
    if(!await GalacticPurchaseSync.sharingAllowed(chrome.storage.local,'humble'))throw Error('Automatic sharing is disabled. Turn it on before sending reminders.');
    const targetProfile=typeof message.targetProfileLabel==='string'?message.targetProfileLabel.trim():'';if(!targetProfile||targetProfile.length>100)throw new Error('Enter the current GL Humble profile label.');
    const snapshot=await libraryStore.execute('shareSnapshot',[message.profileLabel]);const feed=await HumbleEntitlements.project(snapshot.state,snapshot.scope.salt);
    const result=await HumbleEntitlements.send(chrome.runtime,id,targetProfile,feed,async()=>{if(!await GalacticPurchaseSync.sharingAllowed(chrome.storage.local,'humble'))throw Error('Automatic sharing is disabled.');return libraryStore.execute('verifyShareSnapshot',[snapshot.scope,id]);});return {ok:true,count:result.count,coverage:feed.coverage};
  })().then(respond,()=>respond({ok:false,error:'Reminder request was not confirmed. Check both profile labels, GL permission/version and connection, then check the reminders in Galactic Library.'}));return true;
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'HCL_OPEN_GALACTIC_REVIEW' || sender.id !== chrome.runtime.id) return false;
  (async () => {
    const { galacticLibraryExtensionId: rawId = '' } = await chrome.storage.local.get({ galacticLibraryExtensionId: '' });
    const id = HumbleComicLibrary.resolveGalacticId(rawId,chrome.runtime);
    if (!HumbleComicLibrary.isExtensionId(id)) return { ok: false, error: 'Configure the Galactic Library link in Extension options first.' };
    if (!/^[a-p]{32}$/u.test(id)) {
      try{const response=await HumbleEntitlements.request(chrome.runtime,id,{type:'OPEN_REVIEW',apiVersion:1});if(response?.ok&&response.apiVersion===1)return {ok:true};}catch{}
      return {ok:false,error:'In Firefox, open Galactic Library from its toolbar menu. Check the pairing and update Galactic Library to enable central review.'};
    }
    // Chromium's extensions manager owns this options route. Navigating to a
    // different extension's private HTML directly can fail the resource checks.
    await chrome.tabs.create({ url: `chrome://extensions/?options=${id}` });
    return { ok: true };
  })().then(respond, error => respond({ ok: false, error: String(error.message || error) }));
  return true;
});

const purchaseHandoff=GalacticPurchaseTransfer.createService({runtime:chrome.runtime,area:chrome.storage.local,
 authorize:async(id,provider)=>provider==='humble'&&HumbleComicLibrary.trustedGalacticSender(id,(await chrome.storage.local.get({galacticLibraryExtensionId:''})).galacticLibraryExtensionId,chrome.runtime),
 peer:async provider=>{if(provider!=='humble')throw Error('Wrong provider.');return HumbleComicLibrary.resolveGalacticId((await chrome.storage.local.get({galacticLibraryExtensionId:''})).galacticLibraryExtensionId,chrome.runtime);},
 accounts:()=>libraryStore.execute('handoffAccounts'),snapshot:(_,ref)=>libraryStore.execute('handoffSnapshot',[ref]),inventory:(_,ref)=>libraryStore.execute('handoffInventory',[ref]),preview:(data,target)=>libraryStore.execute('handoffPreview',[data,target]),commit:(data,target)=>libraryStore.execute('handoffImport',[data,target])});
purchaseHandoff.register();

async function shareMappedReminders({state,account,verify}){
 const current=await libraryStore.execute('syncAccounts');if(!current.some(a=>a.active&&a.stableId===state.localId))return;
 const remote=await purchaseHandoff.request(state.peerId,{type:'GH_PURCHASE_SYNC_ACCOUNTS',provider:'humble'}),target=remote.accounts.find(a=>a.stableId===state.remoteId);
 if(!target?.active)return; // The legacy feed is explicitly bound to GL's active profile.
 const snapshot=await libraryStore.execute('shareSnapshot',[account.label,state.localId]);
 const purchases=await purchaseHandoff.snapshot('humble',account.accountRef);
 let records=purchases.records.filter(r=>r.providerItemId);
 // With skips, only exact native identities actually present at the mapped
 // destination may suppress an additional reminder. Never deduplicate by title.
 if(state.skipped){const saved=await purchaseHandoff.readSnapshot(state.peerId,'humble',target.accountRef);records=records.filter(r=>saved.records.some(s=>s.metadata.purchaseId===r.metadata.purchaseId&&s.metadata.entitlement==='third-party-key'&&(s.providerItemId===r.providerItemId||s.providerItemId===GalacticPurchaseAdapters.humbleEntitlementAlias(r.providerItemId,r.metadata.purchaseId))));}
 const represented=new Set(records.map(r=>r.providerItemId));
 const feed=await HumbleEntitlements.project(snapshot.state,snapshot.scope.salt,represented);
 const fingerprint=await GalacticPurchaseSnapshot.hash(GalacticPurchaseSync.stable({id:state.id,entries:feed.entries,coverage:feed.coverage}));
 if(fingerprint===state.reminderFingerprint)return {fingerprint};
 const check=async()=>{await verify();await libraryStore.execute('verifyShareSnapshot',[snapshot.scope,state.peerId]);};
 await HumbleEntitlements.send(chrome.runtime,state.peerId,target.label,feed,check,{id:state.id,sourceAccountId:state.localId});
 return {fingerprint};
}
const purchaseSync=GalacticPurchaseSync.createCoordinator({runtime:chrome.runtime,area:chrome.storage.local,alarms:chrome.alarms,service:purchaseHandoff,role:'hb',catalog:()=>libraryStore.execute('syncAccounts'),busy:async()=>Boolean((await chrome.storage.local.get({hclSyncControl:null})).hclSyncControl),onSynced:shareMappedReminders});
purchaseSync.register();
GalacticPurchaseSync.observeCompanion(chrome,purchaseSync,'humble',['libraryItems','profileArchives','keyReminders'], 'hclSyncControl');
