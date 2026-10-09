/* GalacticHamster theme v1. Authoritative source: GalacticLibrary/shared/theme.js.
   Mirrored packages are self-contained. Appearance never reads library data. */
(function(global){
  'use strict';
  const VERSION=1,KEY='galacticHamsterAppearance',MODES=Object.freeze(['dark','light','system']);
  const validMode=value=>MODES.includes(value);
  function preferences(value,legacy='light'){
    return {mode:validMode(value?.mode)?value.mode:legacy,followGl:value?.followGl===true,
      followedMode:validMode(value?.followedMode)?value.followedMode:null,
      followedId:typeof value?.followedId==='string'?value.followedId:''};
  }
  function validatePreferences(value){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['mode','followGl','followedMode','followedId'].includes(key))||!validMode(value.mode)||typeof value.followGl!=='boolean'||!(value.followedMode===null||validMode(value.followedMode))||typeof value.followedId!=='string'||value.followedId.length>255)throw Error('Invalid appearance preference.');
    return {...value};
  }
  const effectiveMode=(prefs,darkSystem=false)=>{const mode=prefs.followGl&&validMode(prefs.followedMode)?prefs.followedMode:prefs.mode;return mode==='system'?(darkSystem?'dark':'light'):mode;};
  function createService({read,save,runtime,resolveId,legacy='light',companion=false,timeoutMs=2000}){
    let tail=Promise.resolve();
    const serialize=task=>{const next=tail.then(task);tail=next.catch(()=>{});return next;};
    async function current(){return preferences(await read(),legacy);}
    async function get(){return {ok:true,apiVersion:1,appearance:await current()};}
    async function install(reason){if(reason!=='install')return;return serialize(async()=>{if(await read()==null)await save(preferences({mode:'system'},legacy));});}
    async function sync(){return serialize(async()=>{
      const prefs=await current();if(!companion||!prefs.followGl)return {...await get(),following:'off'};
      const id=await resolveId();
      if(prefs.followedId!==id){prefs.followedId=id;prefs.followedMode=null;await save(prefs);}
      let timer;
      try{
        const result=await Promise.race([runtime.sendMessage(id,{type:'GET_APPEARANCE',apiVersion:1}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Appearance connection unavailable.')),timeoutMs);})]);
        if(result?.ok!==true||result.apiVersion!==1||!validMode(result.appearance?.mode))throw Error('Appearance not supported.');
        // Only persist an actual change. No polling and no library messages.
        if(prefs.followedMode!==result.appearance.mode){prefs.followedMode=result.appearance.mode;await save(prefs);}
        return {ok:true,apiVersion:1,appearance:prefs,following:'connected'};
      }catch{return {ok:true,apiVersion:1,appearance:prefs,following:prefs.followedMode?'cached':'fallback'};}
      finally{clearTimeout(timer);}
    });}
    async function handle(request,sender){
      if(!['GH_GET_APPEARANCE','GH_SET_APPEARANCE','GH_SYNC_APPEARANCE'].includes(request?.type))return null;
      if(sender?.id!==runtime.id)return {ok:false,error:'Untrusted appearance request.'};
      if(request.type==='GH_GET_APPEARANCE')return get();
      const page=typeof sender.url==='string'&&sender.url.startsWith(runtime.getURL(''));
      if(request.type==='GH_SET_APPEARANCE'){
        if(!page)return {ok:false,error:'Change appearance in Extension options.'};
        return serialize(async()=>{
          if(!validMode(request.mode)||typeof request.followGl!=='boolean'||!companion&&request.followGl)throw Error('Invalid appearance setting.');
          const prefs=await current();prefs.mode=request.mode;prefs.followGl=request.followGl;
          await save(prefs);return get();
        });
      }
      return sync();
    }
    return {get,handle,install,sync};
  }
  function register(service,runtime){
    runtime.onMessage.addListener((request,sender,respond)=>{
      if(!['GH_GET_APPEARANCE','GH_SET_APPEARANCE','GH_SYNC_APPEARANCE'].includes(request?.type))return false;
      service.handle(request,sender).then(respond,error=>respond({ok:false,error:error.message}));return true;
    });
    runtime.onInstalled?.addListener(details=>service.install(details?.reason).catch(()=>{}));
  }
  function mount({runtime=global.chrome?.runtime,storage=global.chrome?.storage,role=document.documentElement.dataset.ghApp,legacy=role==='gl'?'dark':'light'}={}){
    const app=Boolean(document.documentElement.dataset.ghApp),system=global.matchMedia('(prefers-color-scheme: dark)');
    let prefs=preferences(null,legacy),following='off',generation=0,resolved=false,saving=false;
    const selector=role==='gl'?'[id^="galactic-library-"]':role==='hb'?'[class^="hcl-"],[class*=" hcl-"],[id^="hcl-"]':'[class^="fanatical-library-"],[class*=" fanatical-library-"],[id^="fanatical-library-"]';
    const cache='galacticHamsterAppearanceCacheV1';
    if(app)try{prefs=preferences(JSON.parse(localStorage.getItem(cache)),legacy);}catch{}
    function stamp(node){const theme=effectiveMode(prefs,system.matches);if(node.dataset.ghTheme!==theme)node.dataset.ghTheme=theme;}
    function apply(){
      if(app)stamp(document.documentElement);
      else document.querySelectorAll(selector).forEach(stamp);
      const select=document.querySelector('#appearance-mode'),follow=document.querySelector('#appearance-follow-gl'),status=document.querySelector('#appearance-status');
      if(select){select.value=prefs.mode;select.disabled=!resolved||saving||prefs.followGl;}
      if(follow){follow.checked=prefs.followGl;follow.disabled=!resolved||saving;}
      if(status)status.textContent=prefs.followGl?following==='connected'?'Galactic Library controls appearance.':following==='cached'?'Galactic Library is unavailable; using its last saved appearance.':'Following Galactic Library; using local appearance until it connects.':`Appearance: ${prefs.mode==='system'?'System ('+effectiveMode(prefs,system.matches)+')':prefs.mode}.`;
      if(app)try{localStorage.setItem(cache,JSON.stringify(prefs));}catch{}
    }
    apply();system.addEventListener?.('change',apply);
    // Observe only added extension elements, never host-wide restyling or attributes.
    if(!app&&global.MutationObserver)new MutationObserver(changes=>{
      for(const change of changes){if(change.type==='attributes'){if(change.target.matches(selector))stamp(change.target);continue;}
        for(const node of change.addedNodes)if(node.nodeType===1){if(node.matches(selector))stamp(node);node.querySelectorAll(selector).forEach(stamp);}}
    }).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
    async function load(sync=false){
      const token=++generation;
      try{const result=await runtime.sendMessage({type:sync?'GH_SYNC_APPEARANCE':'GH_GET_APPEARANCE'});if(token!==generation||result?.ok!==true||!validMode(result.appearance?.mode))return;
        prefs=preferences(result.appearance,legacy);following=result.following??following;resolved=true;apply();
        if(!sync&&prefs.followGl)void load(true);
      }catch{/* Keep the early cached or backwards-compatible appearance. */}
      finally{if(token===generation){resolved=true;apply();}}
    }
    const ready=load();
    storage?.onChanged?.addListener((changes,area)=>{if(area==='local'&&(changes[KEY]||changes.galacticLibraryUiPreferences||changes.galacticLibraryExtensionId))void load(Boolean(changes.galacticLibraryExtensionId));});
    runtime.onMessage?.addListener(message=>{if(message?.type==='GL_PRIVATE_STORAGE_CHANGED'&&message.keys?.includes('galacticLibraryUiPreferences'))void load();});
    function bind(){
      apply();const select=document.querySelector('#appearance-mode'),follow=document.querySelector('#appearance-follow-gl'),status=document.querySelector('#appearance-status');
      async function change(){
        if(saving||!resolved)return;const token=++generation;let failure=null;saving=true;select.disabled=true;if(follow)follow.disabled=true;
        try{const response=await runtime.sendMessage({type:'GH_SET_APPEARANCE',mode:select.value,followGl:follow?.checked??false});if(response?.ok!==true)throw Error(response?.error??'Could not save appearance.');if(token===generation){prefs=preferences(response.appearance,legacy);apply();}await load(prefs.followGl);}
        catch(error){failure=error.message;}
        finally{saving=false;apply();if(failure&&status)status.textContent=failure;}
      }
      select?.addEventListener('change',change);follow?.addEventListener('change',change);
      document.querySelector('#appearance-sync')?.addEventListener('click',()=>load(true));
    }
    if(app){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();}
    return {ready,load,get preferences(){return {...prefs};}};
  }
  global.GalacticHamsterTheme={VERSION,KEY,MODES,validMode,preferences,validatePreferences,effectiveMode,createService,register,mount};
  if(typeof document!=='undefined'&&global.chrome?.runtime&&(document.documentElement.dataset.ghApp||/^https?:$/u.test(global.location?.protocol??''))){
    const name=global.chrome.runtime.getManifest?.().name??'';
    const role=document.documentElement.dataset.ghApp??(/Humble/i.test(name)?'hb':/Fanatical/i.test(name)?'fan':'gl');
    global.GalacticHamsterTheme.page=mount({role});
  }
})(globalThis);
