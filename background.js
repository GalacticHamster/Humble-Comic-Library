/* Opening review uses Chrome's trusted options route, not a page-supplied URL. */
if (typeof importScripts === 'function') importScripts('shared.js','collection-mappings.js');
const libraryStore=HumbleComicLibrary.createSyncStore(chrome.storage.local);
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type!=='HCL_STORE')return false;
  const own=sender.id===chrome.runtime.id;
  const extensionPage=own&&typeof sender.url==='string'&&sender.url.startsWith(chrome.runtime.getURL(''));
  let humble=false;try{humble=own&&new URL(sender.url).origin==='https://www.humblebundle.com';}catch{}
  if(!extensionPage&&!humble){respond({ok:false,error:'Untrusted library request.'});return false;}
  if(['replace','remove'].includes(message.operation)&&!extensionPage&&!(message.operation==='remove'&&JSON.stringify(message.args)==='[["hclPurchaseFocus"]]')){respond({ok:false,error:'Open Extension options to replace or clear the library.'});return false;}
  const args=Array.isArray(message.args)?[...message.args]:[];
  if(message.operation==='begin')args[1]=sender.tab?.id??null;
  if(message.operation==='commit')args[2]=sender.tab?.id??null;
  libraryStore.execute(message.operation,args).then(result=>respond({ok:true,result}),error=>respond({ok:false,error:error.message}));return true;
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'HCL_OPEN_GALACTIC_REVIEW' || sender.id !== chrome.runtime.id) return false;
  (async () => {
    const { galacticLibraryExtensionId: rawId = '' } = await chrome.storage.local.get({ galacticLibraryExtensionId: '' });
    const id = String(rawId).trim();
    if (!HumbleComicLibrary.isExtensionId(id)) return { ok: false, error: 'Configure the Galactic Library link in Extension options first.' };
    // Firefox's stable add-on ID does not reveal its per-profile moz-extension
    // UUID. The current GL API does not expose an options URL or review action.
    if (!/^[a-p]{32}$/u.test(id)) return { ok: false, error: 'In Firefox, open Galactic Library from its toolbar menu, then use the ownership inspector or series coverage. Its stable add-on ID cannot provide a direct review URL.' };
    // Chromium's extensions manager owns this options route. Navigating to a
    // different extension's private HTML directly can fail the resource checks.
    await chrome.tabs.create({ url: `chrome://extensions/?options=${id}` });
    return { ok: true };
  })().then(respond, error => respond({ ok: false, error: String(error.message || error) }));
  return true;
});
