(async()=>{
 const checks=[],check=(value,label)=>{if(!value)throw Error(label);checks.push(label);};
 const wait=async condition=>{for(let n=0;n<200;n++){if(condition())return;await new Promise(r=>setTimeout(r,25));}throw Error('Ownership border lifecycle did not settle');};
 const color=value=>{const probe=document.createElement('span');probe.style.color=value;document.body.append(probe);const result=getComputedStyle(probe).color;probe.remove();return result;};
 const states=['new','unchecked','possible','partial','elsewhere','owned'];
 const tokens={new:'--gh-new-border',unchecked:'--gh-neutral-fill',possible:'--gh-possible-border',partial:'--gh-partial-border',elsewhere:'--gh-elsewhere-border',owned:'--gh-owned-border'};
 function verify(card,state,label){
  const li=card.closest('li'),style=getComputedStyle(li),expected=color(getComputedStyle(li).getPropertyValue(tokens[state]).trim());
  check(['Top','Right','Bottom','Left'].every(edge=>style['border'+edge+'Width']==='2px'&&style['border'+edge+'Style']==='solid'&&style['border'+edge+'Color']===expected),label+' complete card has four computed 2px '+state+' borders');
  check(style.boxSizing==='border-box',label+' border stays within card width');
 }
 try{
  await wait(()=>document.querySelectorAll('.hcl-status-button').length===4);
  await wait(()=>document.querySelector('.hcl-status-button[data-state="partial"]'));
  // Check genuine matcher outputs before the presentation-only state matrix.
  for(const state of ['owned','new','possible','partial'])verify(document.querySelector('.hcl-status-button[data-state="'+state+'"]').closest('li').querySelector('[data-testid="bundle-item-card"]'),state,'Production match');
  const item=collectBundleItems()[0],li=item.element.closest('li'),card=li.querySelector('[data-testid="bundle-item-card"]'),native=card.parentElement;
  const originalNodes=[...li.childNodes].filter(n=>n!==li.querySelector('.hcl-status-button'));
  // Humble clips cover outlines and provides its own native-button focus ring.
  card.style.overflow='hidden';card.style.borderRadius='8px';card.style.width='220px';
  item.element.parentElement.style.overflow='hidden';
  const nativeStyle=document.createElement('style');nativeStyle.textContent='[data-testid="bundle-item-card"] { border:0 solid transparent; } button[aria-haspopup="dialog"]:focus, button.native-test-focus { outline:3px solid rgb(255,255,255);outline-offset:3px; }';document.head.append(nativeStyle);
  for(const theme of ['light','dark'])for(const state of states){
   clearBundleAnnotations();annotateBundleItem(item,{state,offered:item,range:{owned:1,total:2}});
   for(const node of [li,...li.querySelectorAll('[data-gh-theme]')])node.dataset.ghTheme=theme;
   verify(card,state,theme);
   const text=li.querySelector('.hcl-title-colored');check(!!text&&getComputedStyle(text).color===color(getComputedStyle(text).getPropertyValue(tokens[state]).trim()),theme+' '+state+' exact title coloring retained');
  }
  // Explicit precedence stays aligned with annotateBundleItem's ternary chain.
  clearBundleAnnotations();
  for(let i=0;i<states.length;i++){li.classList.add('hcl-card-'+states[i]);verify(card,states[i],'Conflicting stale classes');}
  clearBundleAnnotations();check(getComputedStyle(li).borderTopWidth==='0px','clearing annotations removes the ownership border');
  annotateBundleItem(item,{state:'owned',offered:item});verify(card,'owned','Reannotation');
  check(getComputedStyle(li).opacity==='0.62','owned-card fading retained');
  let nativeClicks=0;native.addEventListener('click',()=>nativeClicks++);native.click();check(nativeClicks===1,'native card click is not intercepted');
  native.focus();check(document.activeElement===native,'native card remains keyboard focusable');
  // Firefox's headless document can lack window focus despite activeElement.
  // Simulate the native focus selector to test style coexistence independently
  // of that window state; installed live tests exercise actual native controls.
  native.classList.add('native-test-focus');
  check(getComputedStyle(native).outlineWidth==='3px'&&getComputedStyle(native).outlineColor==='rgb(255, 255, 255)','computed native focus outline remains independent of ownership border: '+JSON.stringify({width:getComputedStyle(native).outlineWidth,color:getComputedStyle(native).outlineColor,focus:native.matches(':focus'),visible:native.matches(':focus-visible')}));
  native.classList.remove('native-test-focus');
  const badge=li.querySelector('.hcl-status-button');badge.click();check(!!document.querySelector('#hcl-match-inspector[open]'),'ownership explanation dialog still opens');document.querySelector('#hcl-match-inspector').close();
  const height=card.getBoundingClientRect().height,extra=document.createElement('div');extra.textContent='Extra native details\n'.repeat(8);card.append(extra);verify(card,'owned','Taller card');check(card.getBoundingClientRect().height>=height,'variable-height cards keep their border');
  item.element.dispatchEvent(new Event('load'));verify(card,'owned','Lazy image load');
  check(originalNodes.filter(n=>n!==badge).every(n=>n.parentNode===li),'annotation keeps original native nodes attached');
  check(!document.querySelector('button button'),'ownership controls do not nest inside the native button');
  window.borderResult={checks};
 }catch(error){window.borderResult={checks,error:String(error)+'\n'+(error.stack??'')};}
 await fetch('/test-result',{method:'POST',body:JSON.stringify(window.borderResult)});
})();
