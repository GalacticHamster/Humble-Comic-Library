import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const prefix=existsSync(new URL('shared/theme.js',root))?'shared/':existsSync(new URL('theme.js',root))?'':'src/';
const context={setTimeout,clearTimeout};context.globalThis=context;vm.createContext(context);
vm.runInContext(readFileSync(new URL(prefix+'theme.js',root),'utf8'),context);
const T=context.GalacticHamsterTheme,plain=value=>JSON.parse(JSON.stringify(value));
function service({legacy='light',initial=null,result={ok:true,apiVersion:1,appearance:{mode:'dark'}}}={}){
 let state=initial,id='gl@galactichamster.com',calls=[],writes=[];
 const runtime={id:'own',getURL:()=> 'moz-extension://own/',sendMessage:async(target,message)=>{calls.push({target,message});if(result instanceof Error)throw result;return result;}};
 const api=T.createService({legacy,companion:true,runtime,timeoutMs:5,read:async()=>state,save:async value=>{state=plain(value);writes.push(state);},resolveId:async()=>id});
 return {api,calls,writes,runtime,get state(){return state;},set id(value){id=value;}};
}
function luminance(hex){const rgb=hex.slice(1).match(/../g).map(value=>{const n=parseInt(value,16)/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
function contrast(a,b){const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (values[0]+.05)/(values[1]+.05);}
export const themeCoreTests=[
 ['Appearance validates only Dark/Light/System and preserves the legacy fallback',()=>{
   assert.deepEqual(Array.from(T.MODES),['dark','light','system']);
   assert.equal(T.preferences(null,'dark').mode,'dark');assert.equal(T.preferences(null,'light').mode,'light');
   assert.equal(T.preferences({mode:'bad'},'dark').mode,'dark');assert.throws(()=>T.validatePreferences({mode:'bad',followGl:false,followedMode:null,followedId:''}));
   assert.throws(()=>T.validatePreferences({...T.preferences(null),library:{}}));
   for(const mode of T.MODES)assert.equal(T.validatePreferences(T.preferences({mode})).mode,mode);
 }],
 ['System is reevaluated locally and linked System remains System',()=>{
   const prefs=T.preferences({mode:'system'});assert.equal(T.effectiveMode(prefs,true),'dark');assert.equal(T.effectiveMode(prefs,false),'light');
   const linked=T.preferences({mode:'dark',followGl:true,followedMode:'system'});assert.equal(T.effectiveMode(linked,false),'light');assert.equal(T.effectiveMode(linked,true),'dark');
 }],
 ['Only a confirmed fresh installation seeds System; updates preserve old appearance',async()=>{
   for(const legacy of ['dark','light']){const s=service({legacy});await s.api.install('update');assert.equal(s.state,null);assert.equal((await s.api.get()).appearance.mode,legacy);await s.api.install('install');assert.equal(s.state.mode,'system');}
   const existing=service({initial:T.preferences({mode:'light'})});await existing.api.install('install');assert.equal(existing.writes.length,0);assert.equal(existing.state.mode,'light');
 }],
 ['Appearance actions are sender-scoped and mutable selection requires an extension page',async()=>{
   const s=service();assert.equal((await s.api.handle({type:'GH_GET_APPEARANCE'},{id:'other'})).ok,false);
   assert.equal((await s.api.handle({type:'GH_SET_APPEARANCE',mode:'dark',followGl:false},{id:'own',url:'https://store.test/'})).ok,false);
   const response=await s.api.handle({type:'GH_SET_APPEARANCE',mode:'dark',followGl:false},{id:'own',url:'moz-extension://own/options.html'});assert.equal(response.appearance.mode,'dark');
   assert.equal(s.writes.length,1);assert.equal(s.calls.length,0);
 }],
 ['Follow GL sends only a small versioned settings message and avoids identical writes',async()=>{
   const s=service({initial:T.preferences({mode:'light',followGl:true})});const result=await s.api.sync();assert.equal(result.following,'connected');assert.equal(result.appearance.followedMode,'dark');
   const writes=s.writes.length;await s.api.sync();assert.equal(s.writes.length,writes);
   assert.deepEqual(plain(s.calls[0]),{target:'gl@galactichamster.com',message:{type:'GET_APPEARANCE',apiVersion:1}});
   assert.equal(s.state.mode,'light','Following overwrote independent selection');
 }],
 ['Unavailable GL keeps its cached mode; different pairing discards another GL cache',async()=>{
   const initial=T.preferences({mode:'light',followGl:true,followedMode:'dark',followedId:'gl@galactichamster.com'}),s=service({initial,result:Error('missing')});
   const cached=await s.api.sync();assert.equal(cached.following,'cached');assert.equal(T.effectiveMode(cached.appearance,false),'dark');assert.equal(s.writes.length,0);
   s.id='new@galactichamster.com';const changed=await s.api.sync();assert.equal(changed.following,'fallback');assert.equal(changed.appearance.followedMode,null);assert.equal(T.effectiveMode(changed.appearance,true),'light');
 }],
 ['Disabling following uses local choice without any outbound request; unsupported replies cannot supply a theme',async()=>{
   const local=service();await local.api.sync();assert.equal(local.calls.length,0);
   const bad=service({initial:T.preferences({mode:'light',followGl:true}),result:{ok:true,apiVersion:1,appearance:{mode:'evil'}}});assert.equal((await bad.api.sync()).following,'fallback');assert.equal(bad.state.followedMode,null);
 }],
 ['Theme selection and synchronization serialize without overwriting a newer explicit choice',async()=>{
   const s=service({initial:T.preferences({mode:'light',followGl:true})});await Promise.all([s.api.sync(),s.api.handle({type:'GH_SET_APPEARANCE',mode:'system',followGl:false},{id:'own',url:'moz-extension://own/options.html'})]);assert.equal(s.state.mode,'system');assert.equal(s.state.followGl,false);
 }],
 ['Both palettes keep normal text, muted text, purple controls and all classification labels readable',()=>{
   const css=readFileSync(new URL(prefix+'theme.css',root),'utf8');
   const shared=css.slice(0,css.indexOf('[data-gh-theme="dark"]'));
   const tokens=source=>Object.fromEntries([...source.matchAll(/--gh-([\w-]+):\s*(#[a-f0-9]{6})/g)].map(match=>[match[1],match[2]]));
   const common=tokens(shared);
   for(const mode of ['dark','light']){
     const source=css.match(new RegExp('\\[data-gh-theme="'+mode+'"\\] \\{([^}]+)'))[1],palette={...common,...tokens(source)};
     for(const bg of ['bg','surface','surface-raised'])for(const text of ['text','text-muted','link','focus'])assert(contrast(palette[text],palette[bg])>=4.5,mode+' '+text+'/'+bg);
     for(const fill of ['accent','accent-hover','accent-pressed','owned','elsewhere','new','possible','partial','danger-fill','neutral-fill'])assert(contrast('#ffffff',palette[fill])>=4.5,mode+' white/'+fill);
     assert(contrast(palette['input-border'],palette.input)>=3,mode+' input boundary');
   }
 }],
 ['Theme sheets scope application controls and overlay styles rather than native site controls',()=>{
   const css=readFileSync(new URL(prefix+'theme-overlays.css',root),'utf8');
   assert(!/(^|\n)\s*(?:body|html|:root|button|input|select|a)\s*[{,]/m.test(css));assert(css.includes('.hcl-summary'));assert(css.includes('.fanatical-library-summary'));assert(!/https?:\/\//.test(css));
   const htmlPath=prefix==='shared/'?'options.html':prefix+'options.html';const html=readFileSync(new URL(htmlPath,root),'utf8');assert(html.indexOf('theme.js')<html.indexOf('ui.css'));assert(html.includes('id="appearance-mode" disabled'));
 }]
];
