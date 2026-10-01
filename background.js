/* Opening review uses an extension-origin tab, not an untrusted page URL. */
if (typeof importScripts === 'function') importScripts('shared.js');
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'HCL_OPEN_GALACTIC_REVIEW' || sender.id !== chrome.runtime.id) return false;
  (async () => {
    const { galacticLibraryExtensionId: rawId = '' } = await chrome.storage.local.get({ galacticLibraryExtensionId: '' });
    const id = String(rawId).trim();
    if (!HumbleComicLibrary.isExtensionId(id)) return { ok: false, error: 'Configure the Galactic Library link in Extension options first.' };
    // Firefox's stable add-on ID does not reveal its per-profile moz-extension
    // UUID. The current GL API does not expose an options URL or review action.
    if (!/^[a-p]{32}$/u.test(id)) return { ok: false, error: 'In Firefox, open Galactic Library from its toolbar menu, then use the ownership inspector or series coverage. Its stable add-on ID cannot provide a direct review URL.' };
    await chrome.tabs.create({ url: `chrome-extension://${id}/options.html` });
    return { ok: true };
  })().then(respond, error => respond({ ok: false, error: String(error.message || error) }));
  return true;
});
