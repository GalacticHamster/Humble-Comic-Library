// Public storefront adapter: actual class names, reusable tier views, native
// inline flex order and full-width expanded-info sibling from the IGN bundle.
const tierProducts=['The Elder Scrolls Online - Elsweyr','REMNANT II','BlazBlue Entropy Effect','Ravenswatch','Subnautica','Thronebreaker: The Witcher Tales','Sonic Adventure 2'];
const tierCards=new Map(tierProducts.map(title=>{
  const card=document.createElement('div');card.className='tier-item-view';
  const link=document.createElement('a');link.className='item-details';
  const image=document.createElement('img');image.className='item-image';image.alt=title;
  const heading=document.createElement('h3');heading.textContent=title;link.append(image,heading);card.append(link);
  return [title,card];
}));
const tierGrid=document.querySelector('.desktop-tier-collection-view');
const expandedInfo=document.createElement('div');expandedInfo.className='expanded-info-view';expandedInfo.style.order='999';
expandedInfo.innerHTML='<div class="slick-slide"><div class="tier-item-details-view"><h2>Sonic Adventure 2</h2><span class="tier-price">Pay at least $5 to get this item</span><img class="item-image" alt="Sonic Adventure 2 preview"></div></div>';
tierGrid.append(expandedInfo);
fixtureStored.libraryItems=['Subnautica','Thronebreaker: The Witcher Tales'].map(title=>({title,kind:'game'}));
fixtureStored.customCollectionMappings=[];fixtureStored.galacticLibraryExtensionId='';fixtureStored.wishlistItems=[];
fixtureStored.bundleSummaryPreferences={minimized:true,position:'bottom-right'};
window.finishNativeTier=number=>{
  const titles=number===7?tierProducts:number===4?tierProducts.slice(3):tierProducts.slice(5);
  for(const card of tierCards.values())card.remove();
  titles.forEach((title,index)=>{const card=tierCards.get(title);card.style.order=String(Math.floor(index/3)*2);card.classList.remove('flipping');tierGrid.append(card);});
  for(const card of tierCards.values())card.classList.remove('flipping');
  document.querySelector('section').dataset.tier=String(number===7?15:number===4?10:5);
  document.querySelector('.js-tier-header').textContent=`Pay at least $${number===7?15:number===4?10:5} for these ${number} items`;
};
finishNativeTier(7);
window.beginNativeTier=number=>{
  for(const card of tierGrid.querySelectorAll(':scope > .tier-item-view'))card.classList.add('flipping');
  window.completeNativeTier=()=>finishNativeTier(number);
};
document.addEventListener('click',event=>{
  const control=event.target.closest('.js-tier-filter');if(!control)return;
  event.preventDefault();beginNativeTier(Number(control.dataset.tier));
});
