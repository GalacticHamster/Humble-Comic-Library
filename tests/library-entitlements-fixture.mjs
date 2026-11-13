import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
export const copy = v => JSON.parse(JSON.stringify(v));
export const accountId = '11111111-1111-4111-8111-111111111111';
export const row = (id, title = 'Synthetic game', type = 'steam') => ({id,title,type,userId:'hub-A',productEntitlementId:'parent-A'});
export const child = (id,title='Synthetic game',type='steam') => ({id,title,type,giftStatus:'unassigned',expired:false,preOrdered:false,outOfStock:false,redeemable:true,directRedeem:false,keyIntegrationId:null,unavailableBefore:null,unavailableAfter:null,redeemedAt:null,
  redemptionData:{keyFormatted:'SYNTHETIC_SECRET_DO_NOT_READ',externalAccountName:'SYNTHETIC_PRIVATE_ACCOUNT'}});
export function frames(components) {
  const modules=components.map((c,i)=>`${(i+1).toString(16)}:I${JSON.stringify([i+1,c.name==='UserLibrary'?['static/chunks/synthetic-library.js']:[],c.name])}`);
  const models=components.map((c,i)=>['$','$L'+(i+1).toString(16),null,c.props]);
  return modules.join('\n')+'\n0:'+JSON.stringify(models)+'\n';
}
export function fixture(options={}) {
  let stored={humbleAccountId:accountId,humbleProfileLabel:'A',libraryItems:[],...copy(options.initial??{})},writeCount=0,envelopes=0,secretReads=0;
  const requests=[],writes=[];
  const area={get:async defaults=>typeof defaults==='string'?{[defaults]:stored[defaults]}:{...copy(defaults),...copy(stored)},set:async patch=>{if(options.writeFailure?.(patch))throw Error('Synthetic storage failure');stored={...stored,...copy(patch)};writes.push(copy(patch));writeCount++;},remove:async keys=>{for(const k of keys)delete stored[k];}};
  const context=vm.createContext({console,URL,TextEncoder,TextDecoder,FormData,AbortSignal,Date,crypto:webcrypto,setTimeout,clearTimeout});
  if(options.poisonSecrets)context.JSON={stringify:JSON.stringify,parse:value=>{const result=JSON.parse(value);const walk=v=>{if(!v||typeof v!=='object')return;for(const k of Object.keys(v)){if(['keyFormatted','externalAccountName','gameKey'].includes(k))Object.defineProperty(v,k,{enumerable:true,get(){secretReads++;throw Error('Forbidden secret access');}});else walk(v[k]);}};walk(result);return result;}};
  context.globalThis=context;
  for(const file of [...(options.accounts?['purchase-sync.js']:[]),'library-entitlements.js','shared.js','collection-mappings.js'])vm.runInContext(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(file==='library-entitlements.js'&&options.enabled===false?'const ENABLED = true;':'__NO_REPLACEMENT__','const ENABLED = false;'),context,{filename:file});
  const E=context.HumbleLibraryEntitlements,H=context.HumbleComicLibrary,writer=H.createSyncStore(area);
  const rows=options.rows??Array.from({length:8},(_,i)=>row('id-'+i,'Synthetic game '+i));
  const children=options.children??rows.map(r=>child(r.id,r.title,r.type));
  const response=(body,status=200,type='text/x-component')=>({ok:status===200,status,headers:{get:()=>type},text:async()=>body});
  const fetcher=async(path,init={})=>{
    requests.push({path,method:init.method??'GET',credentials:init.credentials});
    if(path==='/_next/static/chunks/synthetic-library.js')return response(`(0,r.createServerReference)("${'a'.repeat(40)}",r.callServer,void 0,r.findSourceMapURL,"filterUserLibrary")`,200,'text/javascript');
    if(path==='/home/library'&&init.method!=='POST'){
      envelopes++;const principal=options.changedAccount&&envelopes>1?'principal-B':'principal-A';
      return response(frames([{name:'AuthProvider',props:{user:{id:principal}}},{name:'UserLibrary',props:{bundleItems:(options.groupIds??['parent-A']).map((parent,i)=>({id:'group-'+i,productEntitlementId:parent,userId:'hub-A',type:options.parentType??'bundle'}))}}]));
    }
    if(path==='/home/library'&&init.method==='POST'){
      const page=Number(init.body.get('_1_page')),limit=Number(init.body.get('_1_limit'));
      if(options.failPage===page)return response('unavailable',options.authFailure?401:503);
      const values=options.pages?.[page-1]??rows.slice((page-1)*limit,page*limit);
      let body='0:'+JSON.stringify({success:true,results:values,pagination:{page,totalPages:Math.max(1,Math.ceil(rows.length/limit)),totalDocs:rows.length,...options.pagination?.(page)}})+'\n';
      if(options.truncate===page)body=body.slice(0,-2);
      return response(body);
    }
    if(path.startsWith('/home/library/parent-'))return response(frames([{name:'AuthProvider',props:{user:{id:options.detailForeign?'principal-B':'principal-A'}}},{name:'ProductKeysDownloads',props:{productEntitlementId:decodeURIComponent(path.split('/').at(-1)),userLibraryItem:{id:'detail-A',preOrder:false,entitlements:{keys:children.filter(c=>c.type!=='download_drm_free'),downloads:children.filter(c=>c.type==='download_drm_free'),redemptionGroups:[],...options.entitlements},...options.parent}}}]));
    throw Error('Unexpected synthetic request');
  };
  const store=(op,...args)=>writer.execute(op,op==='entitlementBegin'?[{expectedAccountId:stored.humbleAccountId,expectedProfileLabel:stored.humbleProfileLabel,...args[0]},7]:op==='entitlementCommit'?[...args,7]:op==='entitlementAbort'?[...args,7]:args);
  return {E,H,writer,store,fetcher,context,area,requests,writes,get stored(){return copy(stored)},get secretReads(){return secretReads},get writeCount(){return writeCount},async collect(overrides={}){return E.collect({fetcher,store,confirmed:true,...overrides});}};
}
