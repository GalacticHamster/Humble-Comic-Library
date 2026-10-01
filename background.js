/* Opening review uses Chrome's trusted options route, not a page-supplied URL. */
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
    // Chromium's extensions manager owns this options route. Navigating to a
    // different extension's private HTML directly can fail the resource checks.
    await chrome.tabs.create({ url: `chrome://extensions/?options=${id}` });
    return { ok: true };
  })().then(respond, error => respond({ ok: false, error: String(error.message || error) }));
  return true;
});
