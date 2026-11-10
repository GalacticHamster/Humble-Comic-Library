/* Narrow outbound entitlement evidence; never send provider/purchase IDs or keys. */
(function(global){
  'use strict';
  const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
  const iso=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|$)/u.test(value)&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;
  async function opaqueRef(salt,identity){
    const bytes=await global.crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([salt,identity])));
    const hex=Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
  }
  async function project(state,salt,representedIds=null){
    if(!uuid.test(salt)||!state.humbleProfileLabel&&!uuid.test(state.humbleAccountId))throw new Error('Import a confirmed Humble profile before sharing reminders.');
    const records=new Map(),purchaseTitles=new Set();
    for(const item of state.libraryItems??[]){
      if(item.source!=='humble')continue;
      const origins=item.provenance?.length?item.provenance:[item];
      for(const origin of origins){
        if(origin.entitlement!=='third-party-key')continue;
        const checkedAt=iso(origin.keyCheckedAt??item.keyCheckedAt);if(!checkedAt)continue;
        const identity=JSON.stringify([origin.purchaseKey??item.purchaseKey??'',origin.entitlementId??item.entitlementId??'',item.kind??'unknown',item.title]);
        purchaseTitles.add(JSON.stringify([origin.purchaseKey??item.purchaseKey??'',item.title]));
        const shareKind = item.kind === 'comic' ? 'book' : ['game','software','book','audiobook'].includes(item.kind) ? item.kind : 'unknown';
        // The purchase channel already carries dated key evidence for supported
        // native records. Share only additional reminders in the automatic feed,
        // using exact native identity rather than title-based cross-app matching.
        const nativeId=origin.providerItemId??item.providerItemId??(origin.entitlementId?(origin.purchaseKey+':entitlement:'+origin.entitlementId):null);
        if(!representedIds?.has(nativeId))records.set(identity,{title:item.title,mediaType:shareKind,keyStatus:origin.keyStatus??'unknown',expiresAt:iso(origin.expiresAt),checkedAt});
      }
    }
    for(const reminder of state.keyReminders??[]){
      const checkedAt=iso(reminder.checkedAt);if(!checkedAt)continue;
      // Reminder-only entitlements may be courses or another unclassified media.
      if(purchaseTitles.has(JSON.stringify([reminder.purchaseKey??'',reminder.title])))continue;
      records.set(JSON.stringify([reminder.purchaseKey??'',reminder.id??'', 'unknown',reminder.title]),{title:reminder.title,mediaType:'unknown',keyStatus:reminder.isExpired?'expired':reminder.status==='unrevealed'?'unrevealed':'unknown',expiresAt:iso(reminder.expiresAt),checkedAt});
    }
    if(records.size>100000)throw new Error('Too many entitlements to share. No reminders were sent.');
    const entries=[];
    for(const [identity,entry]of records){
      if(typeof entry.title!=='string'||!entry.title.trim()||entry.title.length>500||!['game','software','book','audiobook','unknown'].includes(entry.mediaType)||!['unknown','unrevealed','revealed','expired','unavailable'].includes(entry.keyStatus))throw new Error('Invalid local entitlement evidence. Rescan before sharing.');
      entries.push({itemRef:await opaqueRef(salt,identity),...entry,purchaseEvidence:'confirmed',activationStatus:'unknown'});
    }
    return {entries,coverage:state.keyReminderScan?.complete?'complete':'partial',sentAt:new Date().toISOString()};
  }
  async function request(runtime,id,value){
    let timeout;try{return await Promise.race([runtime.sendMessage(id,value),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Galactic Library did not respond in time.')),10000);})]);}finally{clearTimeout(timeout);}
  }
  async function send(runtime,id,profileLabel,feed,verify=async()=>{},relationship=null){
    const call=async value=>{const response=await request(runtime,id,{apiVersion:1,...value});if(!response?.ok||response.apiVersion!==1)throw new Error(response?.error??'Incompatible Galactic Library reminder response.');return response;};
    const status=await call({type:'GET_STATUS'});if(status.capabilities?.entitlementFeed!==true)throw new Error('Update Galactic Library to a version that accepts companion entitlement reminders.');
    await verify();const begin=await call({type:'BEGIN_ENTITLEMENT_FEED',profileLabel,count:feed.entries.length,coverage:feed.coverage,sentAt:feed.sentAt,...(relationship?{relationship}:{})});
    if(!uuid.test(begin.uploadToken))throw new Error('Invalid central reminder upload token.');
    for(let offset=0;offset<feed.entries.length;offset+=200){await verify();await call({type:'APPEND_ENTITLEMENT_FEED',uploadToken:begin.uploadToken,offset,entries:feed.entries.slice(offset,offset+200)});}
    await verify();
    return call({type:'COMMIT_ENTITLEMENT_FEED',uploadToken:begin.uploadToken});
  }
  global.HumbleEntitlements={project,send,request};
})(globalThis);
