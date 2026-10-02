/* Opening review uses Chrome's trusted options route, not a page-supplied URL. */
if (typeof importScripts === 'function') importScripts('shared.js','collection-mappings.js','entitlement-share.js');
const libraryStore=HumbleComicLibrary.createSyncStore(chrome.storage.local);
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='HCL_STORE')return false;
  const own=sender.id===chrome.runtime.id;
  const extensionPage=own&&typeof sender.url==='string'&&sender.url.startsWith(chrome.runtime.getURL(''));
  let humble=false;try{humble=own&&new URL(sender.url).origin==='https://www.humblebundle.com';}catch{}
  if(!extensionPage&&!humble){respond({ok:false,error:'Untrusted library request.'});return false;}
  if(['replace','remove','shareSnapshot','verifyShareSnapshot'].includes(message.operation)&&!extensionPage&&!(message.operation==='remove'&&JSON.stringify(message.args)==='[["hclPurchaseFocus"]]')){respond({ok:false,error:'Open Extension options to replace or clear the library.'});return false;}
  const args=Array.isArray(message.args)?[...message.args]:[];
  if(message.operation==='begin')args[1]=sender.tab?.id??null;
  if(message.operation==='commit')args[2]=sender.tab?.id??null;
  libraryStore.execute(message.operation,args).then(result=>respond({ok:true,result}),error=>respond({ok:false,error:error.message}));return true;
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!['HCL_SHARE_ENTITLEMENTS','HCL_REMOVE_SHARED_ENTITLEMENTS'].includes(message?.type))return false;
  const ownPage=sender.id===chrome.runtime.id&&typeof sender.url==='string'&&sender.url.startsWith(chrome.runtime.getURL(''));
  if(!ownPage||message.confirmed!==true){respond({ok:false,error:'Open Extension options and confirm the Humble account before sharing.'});return false;}
  (async()=>{
    const stored=await chrome.storage.local.get({galacticLibraryExtensionId:''}),id=stored.galacticLibraryExtensionId;
    if(!HumbleComicLibrary.isExtensionId(id))throw new Error('Configure the Galactic Library link first.');
    if(message.type==='HCL_REMOVE_SHARED_ENTITLEMENTS'){
      const response=await HumbleEntitlements.request(chrome.runtime,id,{type:'REMOVE_ENTITLEMENT_FEED',apiVersion:1});if(!response?.ok||response.apiVersion!==1)throw new Error(response?.error??'Could not remove shared reminders.');return {ok:true,count:0};
    }
    const targetProfile=typeof message.targetProfileLabel==='string'?message.targetProfileLabel.trim():'';if(!targetProfile||targetProfile.length>100)throw new Error('Enter the current GL Humble profile label.');
    const snapshot=await libraryStore.execute('shareSnapshot',[message.profileLabel]);const feed=await HumbleEntitlements.project(snapshot.state,snapshot.scope.salt);
    const result=await HumbleEntitlements.send(chrome.runtime,id,targetProfile,feed,()=>libraryStore.execute('verifyShareSnapshot',[snapshot.scope,id]));return {ok:true,count:result.count,coverage:feed.coverage};
  })().then(respond,()=>respond({ok:false,error:'Reminder request was not confirmed. Check both profile labels, GL permission/version and connection, then check the reminders in Galactic Library.'}));return true;
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'HCL_OPEN_GALACTIC_REVIEW' || sender.id !== chrome.runtime.id) return false;
  (async () => {
    const { galacticLibraryExtensionId: rawId = '' } = await chrome.storage.local.get({ galacticLibraryExtensionId: '' });
    const id = String(rawId).trim();
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
