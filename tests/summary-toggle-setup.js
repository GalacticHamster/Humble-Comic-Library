// Synthetic GL boundary; scans and matching still execute the production code.
const toggleSend = chrome.runtime.sendMessage;
let releaseToggleLookup;
let toggleLookupStarted = false;
let toggleHold = false;
let toggleGLRequests = 0;
chrome.runtime.sendMessage = async (id, request) => {
  if(typeof id==='string')toggleGLRequests++;
  if (request?.type === 'MATCH_ITEMS' && toggleHold) {
    toggleLookupStarted = true;
    await new Promise(resolve => { releaseToggleLookup = resolve; });
  }
  const response = await toggleSend(id, request);
  if (request?.type === 'MATCH_ITEMS' && response?.results) {
    for (const item of request.items) if (item.title === 'Elsewhere book') {
      const row = response.results.find(row => row.requestId === item.requestId);
      row.matches = [{provider:'kindle',title:item.title,ownership:'owned',relationship:'same-edition'}];
    }
  }
  return response;
};
const toggleCard = document.querySelector('[data-testid="bundle-item-card"]').closest('li').cloneNode(true);
toggleCard.querySelector('img').alt = 'Elsewhere book';
toggleCard.querySelector('[data-testid="bundle-item-card"] > div:last-child').textContent = 'Elsewhere book';
document.querySelector('[data-bundle-section] ul').append(toggleCard);
function updateToggleOffer() {
  const bundlePage={slug:'test',tiers:[{price:{amount:10,currencyCode:'USD'},bundleItems:[...document.querySelectorAll('[data-testid="bundle-item-card"] img')].map(img=>({title:img.alt}))}]};
  document.querySelector('script[type="application/json"]:not([src])').textContent='self.__next_f.push('+JSON.stringify([1,'e:'+JSON.stringify(['$','Component',null,{bundlePage}])])+')';
}
updateToggleOffer();
