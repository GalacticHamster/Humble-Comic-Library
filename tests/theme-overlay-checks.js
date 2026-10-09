// Same focused production-overlay fixture in HB and FAN. No real accounts.
(async()=>{
 const checks=[],hb=Boolean(globalThis.HumbleComicLibrary),prefix=hb?'hcl':'fanatical-library';
 const assert=(value,message)=>{if(!value)throw Error(message);};
 const wait=async predicate=>{for(let n=0;n<150;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Theme overlay did not settle');};
 const pause=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
 const css=node=>getComputedStyle(node);
 const color=(root,token)=>{const probe=document.createElement('span');probe.style.setProperty('color','var(--gh-'+token+')','important');root.append(probe);const value=css(probe).color;probe.remove();return value;};
 const contrast=(a,b)=>{const l=value=>{const c=value.match(/\d+/g).slice(0,3).map(v=>{const x=Number(v)/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;};const x=l(a),y=l(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 let error;
 try{
   await wait(()=>document.querySelector('.'+prefix+'-summary')&&globalThis.GalacticHamsterTheme?.page);
   const panel=document.querySelector('.'+prefix+'-summary'),advanced=panel.querySelector('.'+prefix+'-advanced');
   const stored=hb?fixtureStored:values,key=hb?'libraryItems':'fanaticalLibraryItems',before=JSON.stringify(stored[key]);
   const classifiers=()=>[...document.querySelectorAll(hb?'.hcl-status-button':'[data-fanatical-library-for]')].map(node=>[node.textContent,node.className,node.dataset.state]).sort().map(v=>v.join('|')).join('\n');
   const statuses=classifiers(),original=chrome.runtime.sendMessage.bind(chrome.runtime);
   let prefs=GalacticHamsterTheme.preferences({mode:'light'});
   chrome.runtime.sendMessage=async(...args)=>{const request=args[0];if(request?.type==='GH_GET_APPEARANCE'||request?.type==='GH_SYNC_APPEARANCE')return {ok:true,apiVersion:1,appearance:prefs};if(request?.type==='GH_SET_APPEARANCE'){prefs=GalacticHamsterTheme.preferences({mode:request.mode});return {ok:true,apiVersion:1,appearance:prefs};}return original(...args);};
   const native=document.createElement('button');native.id='native-purchase-control';native.textContent='Native purchase button';native.style.cssText='background:rgb(210, 30, 60);color:white;padding:8px';document.body.prepend(native);
   const nativeStyle=()=>[css(native).backgroundColor,css(native).color,css(native).padding,native.getBoundingClientRect().height].join('|'),nativeBefore=nativeStyle();
   const hostile=document.createElement('style');hostile.textContent='body aside button,body aside select{background:pink!important;color:red!important;border:5px solid red} body aside p,body aside summary{font:900 30px serif!important;color:red!important}';document.head.append(hostile);
   const badgeSelector=hb?'.hcl-status-button':'[data-fanatical-library-for]';
   for(const mode of ['dark','light']){
     prefs=GalacticHamsterTheme.preferences({mode});await GalacticHamsterTheme.page.load();await pause();
     assert(panel.dataset.ghTheme===mode,'Panel theme missing');
     assert(css(panel).backgroundColor===color(panel,'surface')&&css(panel).color===color(panel,'text'),'Panel palette differs from shared tokens');
     if(advanced)advanced.open=true;
     for(const control of panel.querySelectorAll('button:not(:disabled)'))assert(contrast(css(control).color,css(control).backgroundColor)>=4.5,'Unreadable overlay button');
     for(const badge of document.querySelectorAll(badgeSelector)){
       assert(contrast(css(badge).color,css(badge).backgroundColor)>=4.5,'Unreadable classification badge');assert(css(badge).position==='absolute','Host CSS moved a badge');
       const rect=badge.getBoundingClientRect(),host=badge.parentElement.getBoundingClientRect();if(host.width&&host.height)assert(rect.left>=host.left-1&&rect.right<=host.right+1&&rect.top>=host.top-1&&rect.bottom<=host.bottom+1,'Clipped badge');
     }
     const planning=panel.querySelector('.library-ui-planning');if(planning){const probe=document.createElement('button');probe.textContent='Themed planning control';planning.append(probe);assert(css(probe).backgroundColor===color(panel,'accent'),'Enabled primary lost purple styling');probe.disabled=true;assert(css(probe).backgroundColor===color(panel,'disabled'),'Disabled primary lost disabled styling');probe.remove();}
     const focus=panel.querySelector('button');focus.focus();assert(parseFloat(css(focus).outlineWidth)>=2,'Missing overlay focus');
     assert(nativeStyle()===nativeBefore,'Theme restyled native purchase control');assert(!document.documentElement.hasAttribute('data-gh-theme'),'Theme leaked to host root');
     assert(classifiers()===statuses,'Theme changed match classifications');assert(JSON.stringify(stored[key])===before,'Theme changed library');
     assert(document.documentElement.scrollWidth<=innerWidth+1,'Overlay causes horizontal overflow');
     checks.push(mode+': scoped readable panels, badges, controls, focus, host isolation and unchanged classifications/data');
   }
   const firstBadge=document.querySelector(badgeSelector);firstBadge.click();await wait(()=>document.querySelector(hb?'#hcl-match-inspector':'#fanatical-library-evidence')?.open);await pause();
   const inspector=document.querySelector(hb?'#hcl-match-inspector':'#fanatical-library-evidence');assert(inspector.dataset.ghTheme==='light'&&contrast(css(inspector).color,css(inspector).backgroundColor)>=4.5,'New inspector did not inherit light theme');checks.push('Dynamically added inspector/tooltip content inherits selected palette without host restyling');
   inspector.close();const minimize=panel.querySelector('.'+prefix+'-summary-minimize');minimize.click();assert(panel.classList.contains(prefix+'-summary-minimized'),'Minimize behavior regressed');panel.querySelector('.'+prefix+'-summary-expand').click();assert(!panel.classList.contains(prefix+'-summary-minimized'),'Expand behavior regressed');checks.push('Existing summary minimize/expand and Basic/Advanced structure remain intact');
   const sample=document.createElement('div');sample.className=prefix+'-summary';document.body.append(sample);
   for(const state of ['owned','new','possible','partial']){const badge=document.createElement('span');badge.className=prefix+'-legend-'+state;badge.textContent=state;sample.append(badge);}await pause();assert(sample.dataset.ghTheme==='light','Late theme root missing');checks.push('Late extension-owned roots receive theme without observing host layout or changing library queries');sample.remove();hostile.remove();
 }catch(value){error=value.stack;}
 if(hb)await fetch('/test-result',{method:'POST',body:JSON.stringify({checks,error})});
 else await fetch('/result?route='+encodeURIComponent(location.pathname),{method:'POST',body:JSON.stringify({ok:!error,checks,error})});
})();
