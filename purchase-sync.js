/* Device-local standing consent; all purchase bytes use purchase-transfer v1. */
(function(root){'use strict';
 const KEY='galacticPurchaseSync',REGISTRY='galacticPurchaseAccountIds',PREFIX='GH_PURCHASE_SYNC_',ALARM='gh-purchase-sync-',providers=['humble','fanatical'];
 const stable=value=>JSON.stringify(sort(value));
 function sort(value){if(Array.isArray(value))return value.map(sort);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,sort(value[k])]));return value;}
 async function fingerprint(raw){const data=root.GalacticPurchaseSnapshot.validate(raw);return root.GalacticPurchaseSnapshot.hash(stable({provider:data.provider,records:data.records.map(stable).sort()}));}
 const accountUuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);
 // Called inside the companion writer queue. One atomic write adopts existing
 // local IDs into their datasets; the old sidecar is then only a migration input.
 async function migrateAccounts(area,role){
  const hb=role==='hb',idKey=hb?'humbleAccountId':'fanaticalAccountId',labelKey=hb?'humbleProfileLabel':'fanaticalProfileLabel',archiveKey=hb?'profileArchives':'fanaticalProfileArchives';
  const state=await area.get({[idKey]:null,[labelKey]:'',[archiveKey]:[],[REGISTRY]:null}),archives=state[archiveKey],old=state[REGISTRY];
  const entries=[{label:state[labelKey],id:state[idKey]},...archives.map(a=>({label:a.profileLabel,id:hb?a.backup?.accountId:a.accountId}))];
  if(new Set(entries.map(a=>a.label)).size!==entries.length)throw Error('Saved accounts have duplicate names. Your purchases were kept; restore a valid backup.');
  const counts=new Map();for(const a of entries)if(accountUuid(a.id)){const k=a.id.toLowerCase();counts.set(k,(counts.get(k)??0)+1);}
  if([...counts.values()].some(n=>n>1))throw Error('Two saved accounts have the same account identity. Your purchases were kept; restore a valid backup.');
  const legacy=old&&typeof old==='object'&&!Array.isArray(old)?old:{},uses=new Map();for(const a of entries){const id=legacy[a.label];if(accountUuid(id))uses.set(id.toLowerCase(),(uses.get(id.toLowerCase())??0)+1);}
  const reserved=new Set(counts.keys());
  for(const a of entries){if(accountUuid(a.id))continue;const id=legacy[a.label];a.id=accountUuid(id)&&uses.get(id.toLowerCase())===1&&!reserved.has(id.toLowerCase())?id:crypto.randomUUID();reserved.add(a.id.toLowerCase());}
  const nextArchives=archives.map((a,i)=>hb?{...a,backup:{...a.backup,accountId:entries[i+1].id}}:{...a,accountId:entries[i+1].id});
  if(state[idKey]!==entries[0].id||stable(archives)!==stable(nextArchives)||old!==null)await area.set({[idKey]:entries[0].id,[archiveKey]:nextArchives,...(old!==null?{[REGISTRY]:null}:{})});
  // Removal is restart-safe: embedded IDs win if the process stops before this.
  if(old!==null&&area.remove)await area.remove([REGISTRY]);
 }
 async function assertCommit(area,provider,target,accountId){if(!target?.autoSync)return;const saved=(await area.get({[KEY]:{}}))[KEY][provider],expected=target.autoSync;if(!saved?.confirmed||!saved.remoteConfirmed||saved.id!==expected.id||saved.peerId!==expected.peerId||saved.localId!==expected.localId||saved.localId!==accountId)throw Error('Automatic synchronization consent or destination account changed before saving.');}
 const validId=id=>typeof id==='string'&&id.length>0&&id.length<=128;
 function mapping(raw){if(!raw||Object.keys(raw).some(k=>!['id','localId','remoteId'].includes(k))||![raw.id,raw.localId,raw.remoteId].every(validId))throw Error('Invalid account relationship.');return raw;}
 function createCoordinator({runtime,area,alarms,service,role,catalog,ensureAccount=async()=>{},busy=async()=>false,now=()=>Date.now(),coalesceMs=750,onActive=async()=>{}}){
  const central=role==='gl',supported=central?providers:[role==='hb'?'humble':'fanatical'];let tail=Promise.resolve(),cycleTail=Promise.resolve(),timer;const jobs=new Map();
  async function read(){return (await area.get({[KEY]:{}}))[KEY];}
  function update(provider,fn){const work=tail.then(async()=>{const all=await read(),previous=all[provider]??null,next=fn(previous);if(stable(previous)!==stable(next))await area.set({[KEY]:{...all,[provider]:next}});return next;});tail=work.catch(()=>{});return work;}
  function checkProvider(provider){if(!supported.includes(provider))throw Error('Wrong synchronization provider.');}
  async function accounts(provider){checkProvider(provider);let rows=await catalog(provider);if(!rows.length){await ensureAccount(provider);rows=await catalog(provider);}return Promise.all(rows.map(async a=>{const data=await service.snapshot(provider,a.accountRef);return {...a,transferCount:data.records.length,excluded:Math.max(0,a.count-(a.eligibleCount??data.records.length)),limitations:[...new Set([...(a.limitations??[]),...data.limitations])].slice(0,20),fingerprint:await fingerprint(data)};}));}
  async function getMapped(provider,state){const a=(await accounts(provider)).find(a=>a.stableId===state.localId);if(!a)throw Error('Mapped account is unavailable or replaced. Confirm a new account relationship.');return a;}
  async function guard(provider,expected,account,checkRemote=false){const current=(await read())[provider];if(!current?.confirmed||!current.remoteConfirmed||current.id!==expected.id||current.peerId!==expected.peerId)throw Error('Automatic synchronization was disconnected or its account relationship changed.');const live=await getMapped(provider,current);if(account&&live.accountRef!==account.accountRef)throw Error('Saved destination account changed. Retry from committed purchases.');if(checkRemote){const value=(await service.request(current.peerId,{type:PREFIX+'CONSENT',provider})).mapping;if(!value?.confirmed||!value.remoteConfirmed||value.id!==current.id||value.localId!==current.remoteId||value.remoteId!==current.localId)throw Error('Automatic synchronization consent changed in the other extension.');}return current;}
  async function consent(provider){const s=(await read())[provider];if(!s)return null;const allowed=await service.authorize(s.peerId,provider),samePeer=central||await service.resolvePeer(provider,s.peerId)===s.peerId;return {...s,confirmed:Boolean(s.confirmed&&allowed&&samePeer)};}
  async function remote(provider,state){return service.request(state.peerId,{type:PREFIX+'ACCOUNTS',provider});}
  async function schedule(provider,state,delay=coalesceMs){if(!state?.confirmed||!state.remoteConfirmed)return;await alarms?.create(ALARM+provider,{when:now()+Math.max(delay,1000)});clearTimeout(timer);timer=setTimeout(()=>{for(const p of supported)run(p).catch(()=>{});},delay);}
  async function mark(provider){checkProvider(provider);const state=await update(provider,s=>s?.confirmed?{...s,pending:true,epoch:(s.epoch??0)+1,attempts:0,status:s.remoteConfirmed?'pending':s.status==='attention'?'attention':'confirmation'}:s);if(!state?.confirmed)return;await schedule(provider,state);}
  async function retry(provider,expected,error){let state=await update(provider,s=>s?.id===expected.id&&s.confirmed?{...s,pending:true,attempts:(s.attempts??0)+1,status:/account.*(unavailable|replaced)|relationship changed|No purchases could/i.test(error.message)?'attention':'waiting',error:String(error.message).slice(0,500)}:s);if(!state?.confirmed)return;if(!state.remoteConfirmed){await update(provider,s=>s?.id===state.id?{...s,status:'attention',error:error.message.slice(0,500)}:s);await alarms?.clear(ALARM+provider);return;}const stopped=state.status==='attention'||state.attempts>5;if(stopped){state=await update(provider,s=>s?.id===state.id?{...s,status:'attention'}:s);await alarms?.clear(ALARM+provider);}else await alarms?.create(ALARM+provider,{when:now()+[60000,300000,900000,3600000,3600000][state.attempts-1]});if(central)try{await service.request(state.peerId,{type:PREFIX+'STATUS',provider,id:state.id,status:state.status,error:state.error});}catch{}}
  const destination=a=>({accountRef:a.accountRef,...(a.stamp?{stamp:a.stamp}:{})});
  async function importFrom(provider,state,source,target){await guard(provider,state);if(await busy(provider))throw Error('A library scan is still saving purchases.');try{return await service.local({action:'import',provider,peerId:state.peerId,confirmed:true,accountRef:source.accountRef,sourceAccountStamp:source.stamp??source.accountRef,target:destination(target)},()=>guard(provider,state,target,true));}catch(error){if(error.message.startsWith('No compatible records can be imported.'))return {skipped:source.transferCount,reviewReason:error.message};throw error;}}
  async function cycle(provider){let state=(await read())[provider];if(!state?.confirmed||!state.remoteConfirmed||!state.pending||state.status==='attention')return {};if(!central){await service.request(state.peerId,{type:PREFIX+'DIRTY',provider,id:state.id});return {};}
   await update(provider,s=>s?.id===state.id?{...s,status:'syncing',error:null}:s);
   for(let pass=0;pass<3;pass++){
    await guard(provider,state);if(await busy(provider))throw Error('A library scan is still saving purchases.');const epoch=((await read())[provider]).epoch;
    let local=await getMapped(provider,state),r=await remote(provider,state),other=r.accounts.find(a=>a.stableId===state.remoteId);
    if(!other||r.mapping?.id!==state.id||!r.mapping.confirmed||r.mapping.localId!==state.remoteId||r.mapping.remoteId!==state.localId)throw Error('Mapped account is unavailable or replaced. Confirm the account relationship.');
    const pair={local:local.fingerprint,remote:other.fingerprint};let skipped=state.skipped??0;
    if(stable(pair)!==stable(state.pair)){
     let pulled,applied;const recovery=state.inFlight;
     // An interrupted commit is uncertain. Inspect the actual destination before
     // replaying a leg whose response/receipt may have been lost.
     if(recovery?.direction==='outgoing'||recovery?.direction==='incoming'&&recovery.source===other.fingerprint){const review=(await service.local({action:'preview',direction:'import',provider,peerId:state.peerId,accountRef:other.accountRef,target:destination(local)})).preview;if(!review.added&&!review.updated)pulled={skipped:review.skipped??0};}
     if(!pulled){state=await update(provider,s=>s?.id===state.id?{...s,inFlight:{direction:'incoming',source:other.fingerprint,target:local.fingerprint}}:s);pulled=await importFrom(provider,state,other,local);}
     skipped=Number(pulled.skipped??0);local=await getMapped(provider,state);
     if(recovery?.direction==='outgoing'&&recovery.source===local.fingerprint){const review=(await service.local({action:'preview',direction:'send',provider,peerId:state.peerId,accountRef:local.accountRef,target:destination(other)})).preview;if(!review.added&&!review.updated)applied={skipped:review.skipped??0,beforeFingerprint:other.fingerprint,afterFingerprint:other.fingerprint,sourceFingerprint:local.fingerprint};}
     if(!applied){state=await update(provider,s=>s?.id===state.id?{...s,inFlight:{direction:'outgoing',source:local.fingerprint,target:other.fingerprint}}:s);applied=await service.request(state.peerId,{type:PREFIX+'APPLY',provider,id:state.id,sourceFingerprint:local.fingerprint});}skipped+=Number(applied.skipped??0);
     await guard(provider,state);const after=await getMapped(provider,state),end=await remote(provider,state),endOther=end.accounts.find(a=>a.stableId===state.remoteId);
     if(!endOther)throw Error('Mapped account is unavailable.');
     if(after.fingerprint!==applied.sourceFingerprint||applied.beforeFingerprint!==other.fingerprint||endOther.fingerprint!==applied.afterFingerprint)continue;
     local=after;other=endOther;
    }
    if(skipped&&(!local.count&&other.count||!other.count&&local.count))throw Error('No purchases could be synchronized into the empty library. Some saved purchase information is unsupported or incomplete; review Advanced.');
    const finalPair={local:local.fingerprint,remote:other.fingerprint};state=await update(provider,s=>s?.id===state.id&&s.confirmed&&s.remoteConfirmed?{...s,inFlight:null,pair:finalPair,pending:(s.epoch??0)!==epoch,status:(s.epoch??0)!==epoch?'pending':'synced',attempts:0,error:null,skipped,review:{excludedHere:local.excluded??0,excludedThere:other.excluded??0,limitations:[...new Set([...(local.limitations??[]),...(other.limitations??[])])].slice(0,20)},lastSuccess:stable(finalPair)!==stable(s.pair)?now():s.lastSuccess}:s);
    if(!state?.confirmed)return {};await service.request(state.peerId,{type:PREFIX+'COMPLETE',provider,id:state.id,pair:{local:finalPair.remote,remote:finalPair.local},skipped,review:state.review,lastSuccess:state.lastSuccess});
    state=(await read())[provider];if(!state?.confirmed||!state.pending)return {state};
   }
   throw Error('Saved purchases changed during synchronization. A fresh committed-state check is pending.');
  }
  function run(provider){if(jobs.has(provider))return jobs.get(provider);let expected;const job=cycleTail.then(async()=>{expected=(await read())[provider]?.id;return cycle(provider);}).catch(async error=>{const s=(await read())[provider];if(s?.confirmed&&s.id===expected)await retry(provider,s,error);return {error:error.message};}).finally(()=>jobs.delete(provider));cycleTail=job.catch(()=>{});jobs.set(provider,job);return job;}
  async function external(message,sender){checkProvider(message.provider);const p=message.provider;
   if(message.type===PREFIX+'ACCOUNTS')return {accounts:await accounts(p),mapping:await consent(p)};
   if(message.type===PREFIX+'CONSENT')return {mapping:await consent(p)};
   if(message.type===PREFIX+'ACCEPT'){
    const proposal=mapping(message.mapping),peer=await service.request(sender.id,{type:PREFIX+'ACCOUNTS',provider:p}),proof=peer.mapping;
    if(!proof?.confirmed||proof.id!==proposal.id||proof.peerId!==runtime.id||proof.localId!==proposal.remoteId||proof.remoteId!==proposal.localId)throw Error('No verified local setup confirmation in the initiating extension.');
    const existing=(await read())[p];
    if(existing?.confirmed&&existing.id===proposal.id&&existing.peerId===sender.id&&existing.localId===proposal.localId&&existing.remoteId===proposal.remoteId&&proof.remoteConfirmed)return {mapping:existing};
    if(!proof.setup?.ticket||proof.setup.ticket!==message.ticket)throw Error('Setup confirmation expired or was not requested locally.');
    const ours=(await accounts(p)).find(a=>a.stableId===proposal.localId),theirs=peer.accounts.find(a=>a.stableId===proposal.remoteId);
    if(!ours||!theirs||ours.fingerprint!==proof.setup.remoteFingerprint||theirs.fingerprint!==proof.setup.localFingerprint)throw Error('Saved accounts changed during setup. Connect again to review them.');
    if(ours.count&&theirs.count&&!proof.setup.sameAccount)throw Error('Confirm these are the same store account before combining saved purchases.');
    const saved=await update(p,v=>{if(v&&(v.peerId!==sender.id||v.id!==proposal.id||v.localId!==proposal.localId||v.remoteId!==proposal.remoteId))throw Error('Disconnect the existing relationship before changing accounts.');return {...v,...proposal,peerId:sender.id,confirmed:true,remoteConfirmed:true,pending:true,status:'pending',epoch:(v?.epoch??0)+1,attempts:0,setup:null};});
    await onActive(p);await schedule(p,saved);return {mapping:saved};
   }

   if(message.type===PREFIX+'PROPOSE'){const proposal=mapping(message.mapping),rows=await accounts(p);if(!rows.some(a=>a.stableId===proposal.localId))throw Error('Proposed account is unavailable.');const saved=await update(p,s=>{if(s?.confirmed&&s.id!==proposal.id)throw Error('Disconnect the existing account relationship before changing it.');return s?.id===proposal.id?s:{...proposal,peerId:sender.id,confirmed:false,remoteConfirmed:true,status:'confirmation',pending:false};});return {mapping:saved};}
   const s=(await read())[p];if(!s||s.peerId!==sender.id||s.id!==message.id)throw Error('Unknown automatic synchronization relationship.');
   if(message.type===PREFIX+'DISCONNECT'){await update(p,current=>current?.id===s.id?null:current);await alarms?.clear(ALARM+p);return {};}
   if(message.type===PREFIX+'SUSPEND'){if(!central)throw Error('Wrong suspension direction.');await update(p,current=>current?.id===s.id?{...current,remoteConfirmed:false,pending:true,status:'attention',error:'The companion connection changed. Restore its connection or choose a new account relationship.',epoch:(current.epoch??0)+1}:current);await alarms?.clear(ALARM+p);return {};}
   if(message.type===PREFIX+'CONFIRM'){const peer=await remote(p,s);if(peer.mapping?.id!==s.id||!peer.mapping.confirmed||peer.mapping.localId!==s.remoteId||peer.mapping.remoteId!==s.localId)throw Error('The other extension has not confirmed this account relationship.');await update(p,current=>current?.id===s.id?{...current,remoteConfirmed:true}:current);await onActive(p);await mark(p);return {};}
   if(!s.confirmed||!s.remoteConfirmed)throw Error('Confirm automatic synchronization in both extensions first.');
   if(message.type===PREFIX+'DIRTY'){if(!central)throw Error('Only Galactic Library coordinates synchronization.');await update(p,current=>current?.id===s.id?{...current,pending:true,epoch:(current.epoch??0)+1}:current);await schedule(p,s);return {};}
   if(message.type===PREFIX+'STATUS'){if(central||!['waiting','attention'].includes(message.status)||typeof message.error!=='string')throw Error('Invalid synchronization status.');await update(p,current=>current?.id===s.id&&current.confirmed?{...current,pending:true,status:message.status,error:message.error.slice(0,500)}:current);return {};}
   if(message.type===PREFIX+'APPLY'){if(central)throw Error('Wrong synchronization direction.');const target=await getMapped(p,s),r=await remote(p,s),source=r.accounts.find(a=>a.stableId===s.remoteId);if(!source||source.fingerprint!==message.sourceFingerprint)throw Error('Saved source purchases changed.');const result=await importFrom(p,s,source,target),after=await getMapped(p,s);return {...result,beforeFingerprint:target.fingerprint,afterFingerprint:after.fingerprint,sourceFingerprint:source.fingerprint};}
   if(message.type===PREFIX+'COMPLETE'){if(central||!message.pair||!['local','remote'].every(k=>/^[a-f0-9]{64}$/.test(message.pair[k])))throw Error('Invalid synchronization completion.');const local=await getMapped(p,s);await update(p,current=>current?.id===s.id&&current.confirmed?{...current,pair:message.pair,pending:local.fingerprint!==message.pair.local,status:local.fingerprint!==message.pair.local?'pending':'synced',lastSuccess:message.lastSuccess,review:{excludedHere:Number(message.review?.excludedThere??0),excludedThere:Number(message.review?.excludedHere??0),limitations:Array.isArray(message.review?.limitations)?message.review.limitations.filter(v=>typeof v==='string').slice(0,20).map(v=>v.slice(0,500)):[]},skipped:Number(message.skipped??0),attempts:0,error:null}:current);if((await read())[p]?.pending)await mark(p);else await alarms?.clear(ALARM+p);return {};}
   throw Error('Unsupported synchronization operation.');
  }
  async function local(message){const p=message.provider;checkProvider(p);
   if(message.action==='syncState')return {state:(await read())[p]??null,accounts:await catalog(p)};
   if(message.action==='syncCreateAccount'){if(message.confirmed!==true)throw Error('Confirm creating a separate saved account.');const choices=await service.accounts(p),active=choices.find(a=>a.active);const data={protocolVersion:1,provider:p,snapshotId:crypto.randomUUID(),accountRef:crypto.randomUUID(),accountLabel:'',capturedAt:new Date(now()).toISOString(),scope:'historical',completeness:'partial',limitations:[],records:[]};await service.commit(data,{newLabel:message.newLabel,expectedActiveLabel:active?.label??'',expectedActiveId:active?.accountRef??null});return {accounts:await catalog(p)};}
   if(message.action==='syncChoices'){const linked=await service.local({action:'connection',provider:p,peerId:message.peerId}),peerId=linked.peerId,r=await service.request(peerId,{type:PREFIX+'ACCOUNTS',provider:p});return {peerId,accounts:await accounts(p),remoteAccounts:r.accounts,state:(await read())[p]??null};}
   if(message.action==='syncDisconnect'){const s=(await read())[p];await update(p,()=>null);await alarms?.clear(ALARM+p);if(s)try{await service.request(s.peerId,{type:PREFIX+'DISCONNECT',provider:p,id:s.id});}catch{}return {};}
   if(message.action==='syncConnect'){
    if(message.confirmed!==true)throw Error('Confirm connecting and ongoing synchronization first.');
    const linked=await service.local({action:'connection',provider:p,peerId:message.peerId}),peerId=linked.peerId,rows=await accounts(p),r=await service.request(peerId,{type:PREFIX+'ACCOUNTS',provider:p});
    const localId=message.localId??(rows.length===1?rows[0].stableId:null),remoteId=message.remoteId??(r.accounts.length===1?r.accounts[0].stableId:null),ours=rows.find(a=>a.stableId===localId),theirs=r.accounts.find(a=>a.stableId===remoteId);
    if(!ours||!theirs)throw Error('Multiple saved accounts need an explicit choice in Advanced.');
    const current=(await read())[p];if(current&&(current.peerId!==peerId||current.localId!==localId||current.remoteId!==remoteId))throw Error('Disconnect the previous relationship before choosing different accounts.');
    const verified=current?.confirmed&&current.remoteConfirmed&&r.mapping?.confirmed&&r.mapping.id===current.id;
    if(!verified&&ours.count&&theirs.count&&message.sameAccount!==true)throw Error('Confirm these are the same store account before combining saved purchases.');
    const setup={ticket:crypto.randomUUID(),localFingerprint:ours.fingerprint,remoteFingerprint:theirs.fingerprint,sameAccount:message.sameAccount===true};
    let state=await update(p,v=>({...v,id:v?.id??crypto.randomUUID(),peerId,localId,remoteId,confirmed:true,remoteConfirmed:false,pending:true,status:'pending',epoch:(v?.epoch??0)+1,attempts:0,setup}));
    let accepted;try{accepted=await service.request(peerId,{type:PREFIX+'ACCEPT',provider:p,mapping:{id:state.id,localId:state.remoteId,remoteId:state.localId},ticket:setup.ticket});}catch(error){await update(p,v=>v?.id===state.id?{...v,status:'attention',error:'Connection setup did not complete: '+error.message}:v);throw error;}
    if(!accepted.mapping?.confirmed||accepted.mapping.id!==state.id)throw Error('Connection was not approved. Update both extensions and try again.');
    state=await update(p,v=>{if(!v?.confirmed||v.id!==state.id||v.setup?.ticket!==setup.ticket)throw Error('Setup was cancelled or replaced.');return {...v,remoteConfirmed:true,setup:null};});
    await onActive(p);await schedule(p,state);return {state};
   }
   if(message.action==='syncNow'){await reconnect(p);await mark(p);if(central)return run(p);return {state:(await read())[p]};}
   throw Error('Unsupported synchronization action.');
  }
  async function reconnect(p){let s=(await read())[p];if(!s?.confirmed)return;if(!central&&await service.resolvePeer(p,s.peerId)!==s.peerId)throw Error('The companion connection relationship changed. Restore the mapped connection or disconnect.');const r=await remote(p,s);if(r.mapping?.id===s.id&&r.mapping.confirmed&&r.mapping.localId===s.remoteId&&r.mapping.remoteId===s.localId){s=await update(p,v=>v?.id===s.id?{...v,remoteConfirmed:true,setup:null}:v);await service.request(s.peerId,{type:PREFIX+'CONFIRM',provider:p,id:s.id});}else if(!r.mapping&&s.setup){await service.request(s.peerId,{type:PREFIX+'ACCEPT',provider:p,mapping:{id:s.id,localId:s.remoteId,remoteId:s.localId},ticket:s.setup.ticket});await update(p,v=>v?.id===s.id?{...v,remoteConfirmed:true,setup:null}:v);}else if(!r.mapping){await service.request(s.peerId,{type:PREFIX+'PROPOSE',provider:p,mapping:{id:s.id,localId:s.remoteId,remoteId:s.localId}});}}
  async function configurationChanged(p){const s=(await read())[p];if(!s?.confirmed)return;await update(p,v=>v?.id===s.id?{...v,remoteConfirmed:false,pending:true,status:'attention',error:'The Galactic Library connection changed. Restore its connection or choose a new account relationship.',epoch:(v.epoch??0)+1}:v);await alarms?.clear(ALARM+p);try{await service.request(s.peerId,{type:PREFIX+'SUSPEND',provider:p,id:s.id});}catch{}if(await service.resolvePeer(p,s.peerId)===s.peerId)await startup();}
  async function startup(){for(const p of supported){let s=(await read())[p];if(!s?.confirmed)continue;try{await reconnect(p);s=(await read())[p];if(s?.remoteConfirmed){await onActive(p);await update(p,v=>({...v,pending:true,status:'pending'}));await mark(p);}}catch(error){await retry(p,s,error);}}}
  function register(){service.setSync({external,local});alarms?.onAlarm?.addListener(alarm=>{if(alarm.name.startsWith(ALARM)){const p=alarm.name.slice(ALARM.length);if(supported.includes(p))run(p).catch(()=>{});}});runtime.onStartup?.addListener(()=>startup().catch(()=>{}));runtime.onInstalled?.addListener(()=>startup().catch(()=>{}));startup().catch(()=>{});}
  return {register,mark,run,local,external,accounts,startup,configurationChanged,dispose(){clearTimeout(timer);}};
 }
 // Compare committed purchase data, excluding bookkeeping and display labels.
 function meaningful(value){if(Array.isArray(value))return value.map(meaningful);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['observedAt','updatedAt','importedAt','archivedAt','lastSync','profileLabel','nickname','localScanState'].includes(k)).map(([k,v])=>[k,meaningful(v)]));return value;}
 function observeCompanion(chrome,coordinator,provider,keys,control){let deferred=false;chrome.storage.onChanged?.addListener((changes,area)=>{if(area!=='local')return;if(changes.galacticLibraryExtensionId&&changes.galacticLibraryExtensionId.oldValue!==changes.galacticLibraryExtensionId.newValue)coordinator.configurationChanged?.(provider).catch(()=>{});const changed=keys.some(k=>changes[k]&&stable(meaningful(changes[k].oldValue))!==stable(meaningful(changes[k].newValue)));if(!changed&&!(deferred&&changes[control]&&!changes[control].newValue))return;chrome.storage.local.get({[control]:null}).then(state=>{if(state[control]){deferred=true;return;}deferred=false;return coordinator.mark(provider);}).catch(()=>{});});}
 root.GalacticPurchaseSync=Object.freeze({KEY,REGISTRY,PREFIX,ALARM,stable,fingerprint,accountUuid,migrateAccounts,assertCommit,meaningful,observeCompanion,createCoordinator});
})(globalThis);
