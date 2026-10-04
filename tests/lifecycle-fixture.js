// Cold startup: no imported library, mappings, linked GL, or final analysis.
window.lifecycleBook = !location.pathname.startsWith('/games/');
window.lifecycleNavigation = performance.getEntriesByType('navigation')[0];
window.lifecycleReadCount = 0;
fixtureStored.libraryItems=window.lifecycleWarm?[{title:'New story',kind:lifecycleBook?'book':'game'}]:[];
fixtureStored.customCollectionMappings=[];
fixtureStored.galacticLibraryExtensionId='';
fixtureStored.wishlistItems=[];
fixtureStored.bundleSummaryPreferences={};
const lifecycleOriginalGet=chrome.storage.local.get;
window.lifecycleBlockRead = true;
chrome.storage.local.get=async defaults=>{
  lifecycleReadCount++;
  const snapshot=await lifecycleOriginalGet(defaults);
  if(window.lifecycleBlockRead){window.lifecycleBlockRead=false;await new Promise(resolve=>{window.lifecycleReleaseRead=resolve;});}
  return snapshot;
};
