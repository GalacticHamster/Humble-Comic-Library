/* Device-local sharing preferences and account relationships; transfer v1. */
(function(root){'use strict';
 const KEY='galacticPurchaseSync',REGISTRY='galacticPurchaseAccountIds',PREFIX='GH_PURCHASE_SYNC_',ALARM='gh-purchase-sync-',providers=['humble','fanatical'];
 const PREFERENCE='galacticPurchaseSharing';
 // Legacy disconnected/false settings did not record an explicit opt-out.
 // Only this versioned preference records the new product decision. Keep it
 // separate from account mappings, imports, library clears and backup restore.
 const preferenceWrites=new WeakMap();
 function sharingUpdate(area,change){const work=(preferenceWrites.get(area)??Promise.resolve()).then(async()=>{const value=await readSharing(area);const next=change?change(value):value;if(stable(value)!==stable(next))await area.set({[PREFERENCE]:next});return next;});preferenceWrites.set(area,work.catch(()=>{}));return work;}
 async function readSharing(area){
  const value=(await area.get({[PREFERENCE]:null}))[PREFERENCE];
  if(value===null){const initial={version:1,humble:true,fanatical:true};await area.set({[PREFERENCE]:initial});return initial;}
  if(!value||!Number.isInteger(value.version)||value.version<1||providers.some(p=>typeof value[p]!=='boolean'))throw Error('Automatic sharing settings are unreadable. Your purchases were kept. Review sharing in Extension options.');
  return value;
 }
 const sharingPreferences=area=>sharingUpdate(area);
 async function sharingAllowed(area,provider){if(!providers.includes(provider))return false;return (await sharingPreferences(area))[provider];}
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
 async function restoredAccounts(role,value){
  // Generate missing lineage in the replacement transaction, never borrowing
  // identity or consent from the dataset being replaced.
  const state={...value,[REGISTRY]:null};
  await migrateAccounts({get:async defaults=>({...defaults,...state}),set:async patch=>Object.assign(state,patch)},role);
  delete state[REGISTRY];return state;
 }
 async function assertCommit(area,provider,target,accountId){if(!target?.autoSync)return;if(!await sharingAllowed(area,provider))throw Error('Automatic sharing is disabled.');const saved=(await area.get({[KEY]:{}}))[KEY][provider],expected=target.autoSync;if(!saved?.confirmed||!saved.remoteConfirmed||saved.id!==expected.id||saved.peerId!==expected.peerId||saved.localId!==expected.localId||saved.localId!==accountId)throw Error('Automatic synchronization consent or destination account changed before saving.');}
 const validId=id=>typeof id==='string'&&id.length>0&&id.length<=128;
 function failureKind(error){
  if(error?.code)return error.code;const text=String(error?.message??error??'');
  if(/Automatic sharing is disabled/i.test(text))return 'sharing-disabled';
  if(/Mapped account|Proposed account|account.*(?:unavailable|replaced)|duplicate.*identity/i.test(text))return 'missing-account';
  if(/consent|permission|not confirmed|not authorized|not allowed|Confirm automatic synchronization|Unknown automatic synchronization/i.test(text))return 'consent-required';
  if(/relationship changed|different relationship|conflicting|Disconnect the existing|connection changed/i.test(text))return 'mapping-conflict';
  if(/Saved (?:source|destination) account changed|Saved source purchases|purchases changed/i.test(text))return 'source-busy';
  if(/destination account changed|source account changed/i.test(text))return 'identity-changed';
  if(/Response (?:lost|interrupted)|timed out|worker restarted/i.test(text))return 'transport';
  if(/setup|ticket|acceptance/i.test(text))return 'setup-incomplete';
  if(/still saving|scan to finish|purchases changed|Saved source purchases|changed during synchronization/i.test(text))return 'source-busy';
  if(/unavailable|timed out|timeout|Receiving end|connection|network|offline|Response (?:lost|interrupted)|worker restarted|expired/i.test(text))return 'transport';
  return 'operation-failed';
 }
 const retryable=code=>['transport','transport-exhausted','source-busy'].includes(code);
 const needsRepair=s=>Boolean(s?.status==='attention'&&!retryable(s.errorCode??failureKind(s.error)));
 async function retirementPatch(area,{provider=null,localId=null}={}){
  const saved=(await area.get({[KEY]:{}}))[KEY],next=provider?{...saved}:{},retired=[];
  for(const p of providers){const s=saved[p];if(provider&&p!==provider||localId&&s?.localId!==localId)continue;
   delete next[p];if(s?.id&&s.peerId)retired.push({provider:p,id:s.id,peerId:s.peerId});
  }
  return {patch:{[KEY]:next},retired};
 }
 async function restorationPatch(area,identities){
  const saved=(await area.get({[KEY]:{}}))[KEY],next={},retired=[];
  for(const p of providers){const s=saved[p];if(!s)continue;
   if(s.confirmed===true&&(s.remoteConfirmed===true||s.previouslyConfirmed===true)&&[s.id,s.peerId,s.localId,s.remoteId].every(validId)&&(identities[p]??[]).includes(s.localId)){
    // Revoke every old in-flight ticket before replacement. Keep only the
    // previously verified dataset relationship as a recovery hint; reconnect
    // must validate both live IDs and obtain a new reverse-verified ticket.
    next[p]={...s,id:crypto.randomUUID(),confirmed:false,remoteConfirmed:false,recovery:true,previouslyConfirmed:true,pair:null,inFlight:null,setup:null,pending:true,status:'pending',error:null,errorCode:null,epoch:(s.epoch??0)+1};
   }else if(s.id&&s.peerId)retired.push({provider:p,id:s.id,peerId:s.peerId});
  }
  return {patch:{[KEY]:next},retired};
 }
 function mapping(raw){if(!raw||Object.keys(raw).some(k=>!['id','localId','remoteId'].includes(k))||![raw.id,raw.localId,raw.remoteId].every(validId))throw Error('Invalid account relationship.');return raw;}
 function createCoordinator({runtime,area,alarms,service,role,catalog,ensureAccount=async()=>{},busy=async()=>false,now=()=>Date.now(),coalesceMs=750,onActive=async()=>{},onSynced=async()=>{}}){
  const central=role==='gl',supported=central?providers:[role==='hb'?'humble':'fanatical'];let tail=Promise.resolve(),cycleTail=Promise.resolve(),timer,disposed=false;const jobs=new Map(),discoveryJobs=new Map(),availability=new Map(),discoveryErrors=new Map(),wakeTimers=new Map(),pendingDiscovery=new Map();
  const allowed=p=>sharingAllowed(area,p);
  async function read(){return (await area.get({[KEY]:{}}))[KEY];}
  function update(provider,fn){const work=tail.then(async()=>{const all=await read(),previous=all[provider]??null,next=fn(previous);if(stable(previous)!==stable(next))await area.set({[KEY]:{...all,[provider]:next}});return next;});tail=work.catch(()=>{});return work;}
  function checkProvider(provider){if(!supported.includes(provider))throw Error('Wrong synchronization provider.');}
  async function accounts(provider){checkProvider(provider);let rows=await catalog(provider);if(!rows.length){await ensureAccount(provider);rows=await catalog(provider);}return Promise.all(rows.map(async a=>{const data=await service.snapshot(provider,a.accountRef);return {...a,transferCount:data.records.length,excluded:Math.max(0,a.count-(a.eligibleCount??data.records.length)),limitations:[...new Set([...(a.limitations??[]),...data.limitations])].slice(0,20),fingerprint:await fingerprint(data)};}));}
  async function getMapped(provider,state){const a=(await accounts(provider)).find(a=>a.stableId===state.localId);if(!a)throw Error('Mapped account is unavailable or replaced. Confirm a new account relationship.');return a;}
  async function guard(provider,expected,account,checkRemote=false){if(!await allowed(provider))throw Error('Automatic sharing is disabled.');const current=(await read())[provider];if(!current?.confirmed||!current.remoteConfirmed||current.id!==expected.id||current.peerId!==expected.peerId)throw Error('Automatic synchronization was disconnected or its account relationship changed.');const live=await getMapped(provider,current);if(account&&live.accountRef!==account.accountRef)throw Error('Saved destination account changed. Retry from committed purchases.');if(checkRemote){const value=(await service.request(current.peerId,{type:PREFIX+'CONSENT',provider})).mapping;if(!value?.confirmed||!value.remoteConfirmed||value.id!==current.id||value.localId!==current.remoteId||value.remoteId!==current.localId)throw Error('Automatic synchronization consent changed in the other extension.');}return current;}
  async function consent(provider){const s=(await read())[provider];if(!s)return null;const authorized=await service.authorize(s.peerId,provider),samePeer=central||await service.resolvePeer(provider,s.peerId)===s.peerId;return {...s,confirmed:Boolean(s.confirmed&&authorized&&samePeer&&await allowed(provider))};}
  async function remote(provider,state){return service.request(state.peerId,{type:PREFIX+'ACCOUNTS',provider});}
  async function schedule(provider,state,delay=coalesceMs){if(disposed)return;if(!state?.confirmed||!state.remoteConfirmed)return;await alarms?.create(ALARM+provider,{when:now()+Math.max(delay,1000)});clearTimeout(timer);timer=setTimeout(()=>{for(const p of supported)run(p).catch(()=>{});},delay);}
  async function mark(provider){checkProvider(provider);if(!await allowed(provider))return;const state=await update(provider,s=>s?.confirmed&&!needsRepair(s)?{...s,pending:true,epoch:(s.epoch??0)+1,attempts:0,errorCode:null,error:null,status:s.remoteConfirmed?'pending':'confirmation'}:s);if(!state?.confirmed){await discover(provider,undefined,true);return;}if(needsRepair(state))return;await schedule(provider,state);}
  async function retry(provider,expected,error){
   const code=failureKind(error);let state=await update(provider,s=>{
    if(s?.id!==expected.id||!s.confirmed)return s;
    const attempts=(s.attempts??0)+1,canRetry=retryable(code)&&s.remoteConfirmed&&attempts<=5;
    return {...s,pending:true,attempts,status:canRetry?'waiting':'attention',errorCode:code==='transport'&&!canRetry?'transport-exhausted':code,error:String(error.message).slice(0,500),peerVerified:false,previouslyConfirmed:s.previouslyConfirmed??s.remoteConfirmed,...(!retryable(code)?{remoteConfirmed:false}:{})};
   });
   if(!state?.confirmed)return;
   if(state.status==='attention')await alarms?.clear(ALARM+provider);
   else await alarms?.create(ALARM+provider,{when:now()+[60000,300000,900000,3600000,3600000][state.attempts-1]});
   if(central)try{await service.request(state.peerId,{type:PREFIX+'STATUS',provider,id:state.id,status:state.status,error:state.error,errorCode:state.errorCode});}catch{}
  }
  const destination=a=>({accountRef:a.accountRef,...(a.stamp?{stamp:a.stamp}:{})});
  async function importFrom(provider,state,source,target){await guard(provider,state);if(await busy(provider))throw Error('A library scan is still saving purchases.');try{return await service.local({action:'import',provider,peerId:state.peerId,confirmed:true,accountRef:source.accountRef,sourceAccountStamp:source.stamp??source.accountRef,target:destination(target)},()=>guard(provider,state,target,true));}catch(error){if(error.message.startsWith('No compatible records can be imported.'))return {skipped:source.transferCount,reviewReason:error.message};throw error;}}
  async function syncedExtras(provider){const state=(await read())[provider];if(!state?.confirmed||state.pending||!await allowed(provider))return;try{const result=await onSynced({provider,state,account:await getMapped(provider,state),verify:()=>guard(provider,state,null,true)});await update(provider,s=>s?.id===state.id?{...s,reminderError:null,...(/^[a-f0-9]{64}$/.test(result?.fingerprint??'')?{reminderFingerprint:result.fingerprint}:{})}:s);}catch(error){await update(provider,s=>s?.id===state.id?{...s,reminderError:String(error.message).slice(0,500)}:s);}}
  async function cycle(provider){if(!await allowed(provider))return {};let state=(await read())[provider];if(!state?.confirmed||!state.remoteConfirmed||!state.pending||state.status==='attention')return {};if(!central){const response=await service.request(state.peerId,{type:PREFIX+'DIRTY',provider,id:state.id});if(response.repairRequired)throw Object.assign(Error('The purchase-sync relationship needs repair.'),{code:response.errorCode??'mapping-conflict'});return {};}
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
  function run(provider){if(jobs.has(provider))return jobs.get(provider);let expected;const job=cycleTail.then(async()=>{expected=(await read())[provider]?.id;return cycle(provider);}).catch(async error=>{const s=(await read())[provider];if(s?.confirmed&&s.id===expected)await retry(provider,s,error);return {error:error.message};}).finally(async()=>{jobs.delete(provider);const current=(await read())[provider];if(current?.confirmed&&current.pending&&current.id!==expected)await schedule(provider,current);});cycleTail=job.catch(()=>{});jobs.set(provider,job);return job;}
  async function external(message,sender){checkProvider(message.provider);const p=message.provider;
   if(message.type===PREFIX+'DISCOVER'){
    const enabled=await allowed(p);
    // A companion's startup/install event wakes GL. Only GL initiates new-model
    // relationships, avoiding simultaneous reciprocal setup tickets.
    const saved=(await read())[p];
    if(central&&enabled&&(!saved?.confirmed||saved.errorCode==='sharing-disabled'||saved.setup||message.relationshipId&&message.relationshipId!==saved.id)){
     wakeDiscovery(p,sender.id);
    }
    return {sharingModel:1,enabled,busy:await busy(p),accounts:enabled?await accounts(p):[],mapping:enabled?await consent(p):null};
   }
   if(!await allowed(p)&&!['DIAGNOSTICS','ACCOUNTS','CONSENT','DISCONNECT'].some(s=>message.type===PREFIX+s))throw Error('Automatic sharing is disabled.');
   if(message.type===PREFIX+'DIAGNOSTICS')return {sharing:await allowed(p),accounts:await allowed(p)?await catalog(p):[],mapping:await consent(p)};
   if(message.type===PREFIX+'ACCOUNTS')return {accounts:await allowed(p)?await accounts(p):[],mapping:await consent(p)};
   if(message.type===PREFIX+'CONSENT')return {mapping:await consent(p)};
   if(message.type===PREFIX+'ACCEPT'){
    if(await busy(p))throw Error('A library scan is still saving purchases.');
    const proposal=mapping(message.mapping),peer=await service.request(sender.id,{type:PREFIX+'ACCOUNTS',provider:p}),proof=peer.mapping;
    if(!proof?.confirmed||proof.id!==proposal.id||proof.peerId!==runtime.id||proof.localId!==proposal.remoteId||proof.remoteId!==proposal.localId)throw Error('No verified local setup confirmation in the initiating extension.');
    const existing=(await read())[p];
    if(existing?.confirmed&&existing.id===proposal.id&&existing.peerId===sender.id&&existing.localId===proposal.localId&&existing.remoteId===proposal.remoteId&&proof.remoteConfirmed)return {mapping:existing};
    if(!proof.setup?.ticket||proof.setup.ticket!==message.ticket)throw Error('Setup confirmation expired or was not requested locally.');
    const localAccounts=await accounts(p),ours=localAccounts.find(a=>a.stableId===proposal.localId),theirs=peer.accounts.find(a=>a.stableId===proposal.remoteId);
    if(!ours||!theirs||ours.fingerprint!==proof.setup.remoteFingerprint||theirs.fingerprint!==proof.setup.localFingerprint)throw Error('Saved accounts changed during setup. Connect again to review them.');
    if(ours.count&&theirs.count&&!proof.setup.sameAccount)throw Error('Confirm these are the same store account before combining saved purchases.');
    if(proof.setup.singleAccount&&(localAccounts.length!==1||peer.accounts.length!==1))throw Error('Saved account choices changed during setup. Review the account relationship.');
    const saved=await update(p,v=>{const replacement=proof.setup?.repair===true&&(v?.id??null)===proof.setup.replaceId&&(!v||v.peerId===sender.id);if(v&&(v.peerId!==sender.id||v.id!==proposal.id||v.localId!==proposal.localId||v.remoteId!==proposal.remoteId)&&!replacement)throw Error('The purchase-sync account relationship changed. Review repair again.');return {...v,...proposal,peerId:sender.id,confirmed:true,remoteConfirmed:true,pending:true,status:'pending',epoch:(v?.epoch??0)+1,attempts:0,setup:null,recovery:false};});
    await onActive(p);await schedule(p,saved);return {mapping:saved};
   }

   if(message.type===PREFIX+'PROPOSE'){const proposal=mapping(message.mapping),rows=await accounts(p);if(!rows.some(a=>a.stableId===proposal.localId))throw Error('Proposed account is unavailable.');const saved=await update(p,s=>{if(s?.confirmed&&s.id!==proposal.id)throw Error('Disconnect the existing account relationship before changing it.');return s?.id===proposal.id?s:{...proposal,peerId:sender.id,confirmed:false,remoteConfirmed:true,status:'confirmation',pending:false};});return {mapping:saved};}
   const s=(await read())[p];if(!s||s.peerId!==sender.id||s.id!==message.id)throw Error('Unknown automatic synchronization relationship.');
   if(message.type===PREFIX+'DISCONNECT'){await update(p,current=>current?.id===s.id?null:current);await alarms?.clear(ALARM+p);return {};}
   if(message.type===PREFIX+'SUSPEND'){if(!central)throw Error('Wrong suspension direction.');await update(p,current=>current?.id===s.id?{...current,remoteConfirmed:false,pending:true,status:'attention',errorCode:message.sharingDisabled===true?'sharing-disabled':'mapping-conflict',error:message.sharingDisabled===true?'Automatic sharing is disabled in the companion.':'The companion connection changed. Restore its connection or choose a new account relationship.',epoch:(current.epoch??0)+1}:current);await alarms?.clear(ALARM+p);return {};}
   if(message.type===PREFIX+'CONFIRM'){const peer=await remote(p,s);if(peer.mapping?.id!==s.id||!peer.mapping.confirmed||peer.mapping.localId!==s.remoteId||peer.mapping.remoteId!==s.localId)throw Error('The other extension has not confirmed this account relationship.');await update(p,current=>current?.id===s.id?{...current,remoteConfirmed:true,peerVerified:true,error:null,errorCode:null,status:'pending'}:current);await onActive(p);await mark(p);return {};}
   if(!s.confirmed||!s.remoteConfirmed)throw Error('Confirm automatic synchronization in both extensions first.');
   if(message.type===PREFIX+'DIRTY'&&needsRepair(s))return {repairRequired:true,errorCode:s.errorCode??failureKind(s.error)};
   if(message.type===PREFIX+'DIRTY'){if(!central)throw Error('Only Galactic Library coordinates synchronization.');await update(p,current=>current?.id===s.id?{...current,pending:true,status:'pending',errorCode:null,error:null,attempts:0,epoch:(current.epoch??0)+1}:current);await schedule(p,s);return {};}
   if(message.type===PREFIX+'STATUS'){if(central||!['waiting','attention'].includes(message.status)||typeof message.error!=='string')throw Error('Invalid synchronization status.');await update(p,current=>current?.id===s.id&&current.confirmed?{...current,pending:true,status:message.status,error:message.error.slice(0,500),errorCode:failureKind({code:message.errorCode,message:message.error}),peerVerified:false,...(!retryable(failureKind({code:message.errorCode,message:message.error}))?{remoteConfirmed:false}:{})}:current);return {};}
   if(message.type===PREFIX+'APPLY'){if(central)throw Error('Wrong synchronization direction.');const target=await getMapped(p,s),r=await remote(p,s),source=r.accounts.find(a=>a.stableId===s.remoteId);if(!source||source.fingerprint!==message.sourceFingerprint)throw Error('Saved source purchases changed.');const result=await importFrom(p,s,source,target),after=await getMapped(p,s);return {...result,beforeFingerprint:target.fingerprint,afterFingerprint:after.fingerprint,sourceFingerprint:source.fingerprint};}
   if(message.type===PREFIX+'COMPLETE'){if(central||!message.pair||!['local','remote'].every(k=>/^[a-f0-9]{64}$/.test(message.pair[k])))throw Error('Invalid synchronization completion.');const local=await getMapped(p,s);await update(p,current=>current?.id===s.id&&current.confirmed?{...current,pair:message.pair,pending:local.fingerprint!==message.pair.local,status:local.fingerprint!==message.pair.local?'pending':'synced',lastSuccess:message.lastSuccess,review:{excludedHere:Number(message.review?.excludedThere??0),excludedThere:Number(message.review?.excludedHere??0),limitations:Array.isArray(message.review?.limitations)?message.review.limitations.filter(v=>typeof v==='string').slice(0,20).map(v=>v.slice(0,500)):[]},skipped:Number(message.skipped??0),attempts:0,error:null}:current);if((await read())[p]?.pending)await mark(p);else {await alarms?.clear(ALARM+p);await syncedExtras(p);}return {};}
   throw Error('Unsupported synchronization operation.');
  }
  async function local(message){const p=message.provider;checkProvider(p);
   if(message.action==='syncSetSharing'){
    if(typeof message.enabled!=='boolean')throw Error('Choose whether automatic sharing is enabled.');
    await sharingUpdate(area,value=>({...value,[p]:message.enabled}));
    await alarms?.clear(ALARM+p);await alarms?.clear(ALARM+'discovery-'+p);
    if(message.enabled)await discover(p,undefined,true);
    else {const s=(await read())[p];if(s)try{await service.request(s.peerId,{type:PREFIX+'SUSPEND',provider:p,id:s.id,sharingDisabled:true});}catch{}}
    return {enabled:message.enabled};
   }
   if(message.action==='syncRetry'){if(!await allowed(p))throw Error('Automatic sharing is disabled.');await discover(p,undefined,true);return {state:(await read())[p]??null};}
   if(message.action==='syncDiagnostics'){
    const state=(await read())[p]??null,ours=await catalog(p),enabled=await allowed(p);let linked=false,other=null,problem=null;
    try{const peer=await service.resolvePeer(p,state?.peerId);await service.request(peer,{type:'GH_PURCHASE_CAPABILITIES',provider:p});linked=true;other=await service.request(peer,{type:PREFIX+'DIAGNOSTICS',provider:p});}catch(error){problem=failureKind(error);}
    const localAccountPresent=Boolean(state&&ours.some(a=>a.stableId===state.localId)),remoteAccountPresent=Boolean(state&&other?.accounts?.some(a=>a.stableId===state.remoteId));
    const verified=Boolean(enabled&&state?.confirmed&&other?.mapping?.confirmed&&other.mapping.id===state.id&&other.mapping.localId===state.remoteId&&other.mapping.remoteId===state.localId&&localAccountPresent&&remoteAccountPresent);
    return {report:{format:1,provider:p,checkedAt:new Date(now()).toISOString(),pairingAvailable:linked,automaticSharing:enabled,reminderSharingFailure:Boolean(state?.reminderError),localPurchasePermission:Boolean(state?.confirmed&&enabled),remotePurchasePermission:Boolean(state&&other?.mapping?.confirmed&&other.mapping.id===state.id&&other.mapping.localId===state.remoteId&&other.mapping.remoteId===state.localId),localAccountPresent,remoteAccountPresent,verifiedPeerConfirmation:verified,localAccountCount:ours.length,remoteAccountCount:other?.accounts?.length??null,lastSuccess:state?.lastSuccess??null,pending:Boolean(state?.pending),discoveryFailure:discoveryErrors.get(p)?.code??null,failureCode:!enabled||other?.sharing===false?'sharing-disabled':problem??discoveryErrors.get(p)?.code??(state&&(!localAccountPresent||!remoteAccountPresent)?'missing-account':state&&!verified?'consent-required':state?.errorCode??(state?.error?failureKind(state.error):null)),recoveryAction:!enabled?'enable-sharing':other?.sharing===false?'enable-sharing-in-companion':!state?'connect':verified?'sync':linked?'repair':'check-pairing'}};
   }
   if(message.action==='syncState')return {state:(await read())[p]??null,accounts:await catalog(p),sharing:await allowed(p),availability:availability.get(p)??null,discoveryError:discoveryErrors.get(p)??null};
   if(message.action==='syncCreateAccount'){if(message.confirmed!==true)throw Error('Confirm creating a separate saved account.');const choices=await service.accounts(p),active=choices.find(a=>a.active);const data={protocolVersion:1,provider:p,snapshotId:crypto.randomUUID(),accountRef:crypto.randomUUID(),accountLabel:'',capturedAt:new Date(now()).toISOString(),scope:'historical',completeness:'partial',limitations:[],records:[]};await service.commit(data,{newLabel:message.newLabel,expectedActiveLabel:active?.label??'',expectedActiveId:active?.accountRef??null});return {accounts:await catalog(p)};}
   if(message.action==='syncChoices'){const linked=await service.local({action:'connection',provider:p,peerId:message.peerId}),peerId=linked.peerId,r=await service.request(peerId,{type:PREFIX+'ACCOUNTS',provider:p});return {peerId,accounts:await accounts(p),remoteAccounts:r.accounts,remoteRelationshipId:r.mapping?.id??null,state:(await read())[p]??null};}
   if(message.action==='syncDisconnect'){const s=(await read())[p];await update(p,()=>null);await alarms?.clear(ALARM+p);if(s)try{await service.request(s.peerId,{type:PREFIX+'DISCONNECT',provider:p,id:s.id});}catch{}return {};}
   if(message.action==='syncConnect'||message.action==='syncRepair'){
    if(!await allowed(p))throw Error('Automatic sharing is disabled. Turn it on before choosing an account relationship.');
    const repairing=message.action==='syncRepair';
    if(message.confirmed!==true)throw Error('Confirm connecting and ongoing synchronization first.');
    if(await busy(p))throw Error('A library scan is still saving purchases.');
    const linked=await service.local({action:'connection',provider:p,peerId:message.peerId}),peerId=linked.peerId,rows=await accounts(p),r=await service.request(peerId,{type:PREFIX+'ACCOUNTS',provider:p});
    const localId=message.localId??(rows.length===1?rows[0].stableId:null),remoteId=message.remoteId??(r.accounts.length===1?r.accounts[0].stableId:null),ours=rows.find(a=>a.stableId===localId),theirs=r.accounts.find(a=>a.stableId===remoteId);
    if(!ours||!theirs)throw Error('Multiple saved accounts need an explicit choice in Advanced.');
    const current=(await read())[p];
    if(repairing&&((current?.id??null)!==message.expectedId||(r.mapping?.id??null)!==message.expectedRemoteId||ours.fingerprint!==message.localFingerprint||theirs.fingerprint!==message.remoteFingerprint))throw Error('The accounts or connection changed. Review repair again.');
    if(!repairing&&current&&(current.peerId!==peerId||current.localId!==localId||current.remoteId!==remoteId))throw Error('Repair the connection before choosing different accounts.');
    const verified=current?.confirmed&&current.remoteConfirmed&&r.mapping?.confirmed&&r.mapping.id===current.id;
    const singleAccount=message.automatic===true&&rows.length===1&&r.accounts.length===1;
    if((repairing||!verified)&&ours.count&&theirs.count&&message.sameAccount!==true&&!singleAccount)throw Error('Confirm these are the same store account before combining saved purchases.');
    const setup={ticket:crypto.randomUUID(),automatic:message.automatic===true,localFingerprint:ours.fingerprint,remoteFingerprint:theirs.fingerprint,sameAccount:message.sameAccount===true||singleAccount,...(singleAccount?{singleAccount:true}:{}),...(repairing?{repair:true,replaceId:r.mapping?.id??null}:{})};
    let state=await update(p,v=>{if(repairing&&(v?.id??null)!==message.expectedId)throw Error('The connection changed. Review repair again.');return {...v,id:repairing?crypto.randomUUID():v?.id??crypto.randomUUID(),peerId,localId,remoteId,confirmed:true,remoteConfirmed:false,peerVerified:false,pending:true,status:'pending',epoch:(v?.epoch??0)+1,attempts:0,error:null,errorCode:null,inFlight:null,recovery:false,pair:repairing?null:v?.pair,setup};});
    let accepted;try{accepted=await service.request(peerId,{type:PREFIX+'ACCEPT',provider:p,mapping:{id:state.id,localId:state.remoteId,remoteId:state.localId},ticket:setup.ticket});}catch(error){await update(p,v=>v?.id===state.id?{...v,status:'attention',error:'Connection setup did not complete: '+error.message}:v);throw error;}
    if(!accepted.mapping?.confirmed||accepted.mapping.id!==state.id)throw Error('Connection was not approved. Update both extensions and try again.');
    const currentLocalRows=await accounts(p),currentRemoteRows=(await service.request(peerId,{type:PREFIX+'ACCOUNTS',provider:p})).accounts,currentLocal=currentLocalRows.find(a=>a.stableId===localId),currentPeer=currentRemoteRows.find(a=>a.stableId===remoteId);
    if(setup.singleAccount&&(currentLocalRows.length!==1||currentRemoteRows.length!==1))throw Error('Saved account choices changed during setup. Review the account relationship.');
    if(!currentLocal||!currentPeer||currentLocal.fingerprint!==ours.fingerprint||currentPeer.fingerprint!==theirs.fingerprint||(currentLocal.stamp??currentLocal.accountRef)!==(ours.stamp??ours.accountRef)||(currentPeer.stamp??currentPeer.accountRef)!==(theirs.stamp??theirs.accountRef))throw Error('Saved accounts changed during setup. Review the account relationship.');
    state=await update(p,v=>{if(!v?.confirmed||v.id!==state.id||v.setup?.ticket!==setup.ticket)throw Error('Setup was cancelled or replaced.');return {...v,remoteConfirmed:true,peerVerified:true,previouslyConfirmed:true,setup:null};});
    await onActive(p);await schedule(p,state);return {state};
   }
   if(message.action==='syncNow'){if(!await allowed(p))throw Error('Automatic sharing is disabled.');try{await reconnect(p);}catch(error){const state=(await read())[p];if(state?.confirmed)await retry(p,state,error);throw error;}await mark(p);if(central)return run(p);return {state:(await read())[p]};}
   throw Error('Unsupported synchronization action.');
  }
  async function reconnect(p){
   let s=(await read())[p];if(!s?.confirmed)return;
   if(!central&&await service.resolvePeer(p,s.peerId)!==s.peerId)throw Error('The companion connection relationship changed. Repair the connection.');
   const r=await remote(p,s);
   if(!(await accounts(p)).some(a=>a.stableId===s.localId)||!r.accounts.some(a=>a.stableId===s.remoteId))throw Error('Mapped account is unavailable or replaced. Repair the connection.');
   if(r.mapping?.id===s.id&&r.mapping.confirmed&&r.mapping.localId===s.remoteId&&r.mapping.remoteId===s.localId){
    s=await update(p,v=>v?.id===s.id?{...v,remoteConfirmed:true,peerVerified:true,previouslyConfirmed:true,setup:null}:v);
    await service.request(s.peerId,{type:PREFIX+'CONFIRM',provider:p,id:s.id});
   }else if(!r.mapping&&s.setup){await service.request(s.peerId,{type:PREFIX+'ACCEPT',provider:p,mapping:{id:s.id,localId:s.remoteId,remoteId:s.localId},ticket:s.setup.ticket});await update(p,v=>v?.id===s.id?{...v,remoteConfirmed:true,peerVerified:true,setup:null}:v);}
   else if(!r.mapping||!r.mapping.confirmed)throw Error('Purchase-sync consent is missing in the other extension. Repair the connection.');
   else throw Error('The purchase-sync account relationship changed. Repair the connection.');
  }
  async function configurationChanged(p){const s=(await read())[p];if(!s?.confirmed){await discover(p,undefined,true);return;}await update(p,v=>v?.id===s.id?{...v,remoteConfirmed:false,pending:true,status:'attention',error:'The Galactic Library connection changed. Restore its connection or choose a new account relationship.',epoch:(v.epoch??0)+1}:v);await alarms?.clear(ALARM+p);try{await service.request(s.peerId,{type:PREFIX+'SUSPEND',provider:p,id:s.id});}catch{}if(await service.resolvePeer(p,s.peerId)===s.peerId){await update(p,v=>v?.id===s.id?{...v,status:'pending',error:null,errorCode:null}:v);await startup();}}
  function wakeDiscovery(p,explicit){clearTimeout(wakeTimers.get(p));wakeTimers.set(p,setTimeout(()=>{wakeTimers.delete(p);if(!disposed)discover(p,explicit,true).catch(()=>{});},0));}
  function discover(p,explicit,force=false){
   if(disposed)return Promise.resolve();
   if(discoveryJobs.has(p)){if(force||explicit)pendingDiscovery.set(p,explicit);return discoveryJobs.get(p);}
   const work=discoverOnce(p,explicit,force).finally(()=>{discoveryJobs.delete(p);if(pendingDiscovery.has(p)){const next=pendingDiscovery.get(p);pendingDiscovery.delete(p);if(!disposed)wakeDiscovery(p,next);}});discoveryJobs.set(p,work);return work;
  }
  async function discoverOnce(p,explicit,force){
   if(!await allowed(p)){availability.set(p,'disabled');return;}
   try{
    if(await busy(p))throw Error('A library scan is still saving purchases.');
    const saved=(await read())[p],cooldownKey='galacticPurchaseDiscoveryAfter:'+p;
    if(!saved?.confirmed&&!explicit&&!force){if((await area.get({[cooldownKey]:0}))[cooldownKey]>now())return;await area.set({[cooldownKey]:now()+60000});}
    const peerId=await service.resolvePeer(p,explicit??saved?.peerId);
    await service.local({action:'connection',provider:p,peerId});
    let other;try{other=await service.request(peerId,{type:PREFIX+'DISCOVER',provider:p,relationshipId:saved?.id??null});}
    catch{
     // Older peers expose the same account inventory without DISCOVER.
     other=await service.request(peerId,{type:PREFIX+'ACCOUNTS',provider:p});
    }
    if(other.sharingModel!==undefined&&(other.sharingModel!==1||typeof other.enabled!=='boolean'))throw Error('Incompatible automatic sharing model. Update both extensions.');
    if(other.sharingModel===1&&!other.enabled){availability.set(p,'disabled-by-peer');if(saved?.confirmed)await update(p,s=>s?.id===saved.id?{...s,remoteConfirmed:false,pending:true,status:'attention',errorCode:'sharing-disabled',error:'Automatic sharing is disabled in the other extension.'}:s);return;}
    if(other.busy===true)throw Error('A library scan is still saving purchases.');
    availability.set(p,'connected');discoveryErrors.delete(p);await alarms?.clear(ALARM+'discovery-'+p);await area.set({['galacticPurchaseDiscoveryAttempts:'+p]:0});
    const ours=await accounts(p),theirs=other.accounts;
    if(!Array.isArray(theirs))throw Error('Incompatible companion account response.');
    if(saved?.confirmed){
     // Restore an interrupted/lost peer mapping only from a previously verified
     // relationship whose exact embedded dataset IDs still exist. A changed ID
     // or conflicting live relationship never receives this recovery authority.
     const localAccount=ours.find(a=>a.stableId===saved.localId),remoteAccount=theirs.find(a=>a.stableId===saved.remoteId);
     if((!other.mapping||!other.mapping.confirmed&&other.mapping.localId===saved.remoteId&&other.mapping.remoteId===saved.localId)&&(saved.previouslyConfirmed||saved.remoteConfirmed)&&saved.peerId===peerId&&localAccount&&remoteAccount){
      await local({action:'syncRepair',provider:p,peerId,localId:localAccount.stableId,remoteId:remoteAccount.stableId,confirmed:true,automatic:true,sameAccount:true,expectedId:saved.id,expectedRemoteId:other.mapping?.id??null,localFingerprint:localAccount.fingerprint,remoteFingerprint:remoteAccount.fingerprint});return;
     }
     if(saved.setup&&!saved.previouslyConfirmed&&localAccount&&remoteAccount&&(!other.mapping||!other.mapping.confirmed)&&ours.length===1&&theirs.length===1){await local({action:'syncRepair',provider:p,peerId,localId:localAccount.stableId,remoteId:remoteAccount.stableId,confirmed:true,automatic:true,expectedId:saved.id,expectedRemoteId:other.mapping?.id??null,localFingerprint:localAccount.fingerprint,remoteFingerprint:remoteAccount.fingerprint});return;}
     await reconnect(p);await onActive(p);await update(p,s=>({...s,pending:true,status:'pending',attempts:0,error:null,errorCode:null}));await schedule(p,(await read())[p]);return;
    }
    // A new companion wakes the central coordinator but does not race it.
    if(!central&&other.sharingModel===1)return;
    const known=other.mapping;
    if(saved?.recovery&&saved.previouslyConfirmed&&saved.peerId===peerId&&(!known||known.localId===saved.remoteId&&known.remoteId===saved.localId)){
     const localAccount=ours.find(a=>a.stableId===saved.localId),remoteAccount=theirs.find(a=>a.stableId===saved.remoteId);
     if(localAccount&&remoteAccount){await local({action:'syncRepair',provider:p,peerId,localId:localAccount.stableId,remoteId:remoteAccount.stableId,confirmed:true,automatic:true,sameAccount:true,expectedId:saved.id,expectedRemoteId:known?.id??null,localFingerprint:localAccount.fingerprint,remoteFingerprint:remoteAccount.fingerprint});return;}
    }
    if(known?.confirmed&&known.peerId===runtime.id&&(!saved||saved.localId===known.remoteId&&saved.remoteId===known.localId)){
     const localAccount=ours.find(a=>a.stableId===known.remoteId),remoteAccount=theirs.find(a=>a.stableId===known.localId);
     if(localAccount&&remoteAccount){await local({action:'syncRepair',provider:p,peerId,localId:localAccount.stableId,remoteId:remoteAccount.stableId,confirmed:true,automatic:true,sameAccount:true,expectedId:saved?.id??null,expectedRemoteId:known.id,localFingerprint:localAccount.fingerprint,remoteFingerprint:remoteAccount.fingerprint});return;}
    }
    // Product policy: the sole saved account in each extension is the default
    // relationship, including populated/history-only datasets. Never replace
    // a conflicting confirmed relationship merely because only one row remains.
    if(saved?.confirmed||other.mapping?.confirmed)throw Error('A conflicting saved account relationship needs review in Advanced.');
    if(ours.length!==1||theirs.length!==1){availability.set(p,'account-resolution-required');return;}
    const repairing=Boolean(saved||other.mapping);
    await local({action:repairing?'syncRepair':'syncConnect',provider:p,peerId,localId:ours[0].stableId,remoteId:theirs[0].stableId,confirmed:true,automatic:true,...(repairing?{expectedId:saved?.id??null,expectedRemoteId:other.mapping?.id??null,localFingerprint:ours[0].fingerprint,remoteFingerprint:theirs[0].fingerprint}:{})});
   }catch(error){
    const code=failureKind(error);discoveryErrors.set(p,{code,message:code==='transport'?'The other extension could not be reached.':code==='source-busy'?'An import is still saving.':code==='mapping-conflict'?'A saved account relationship conflicts. Review accounts in Advanced.':'Saved purchase information could not be checked. Use Check sync connection in Advanced and export the connection report.'});availability.set(p,code==='source-busy'?'waiting':code==='transport'?'unavailable':/Incompatible|Unsupported|Update both/i.test(error.message)?'incompatible':['missing-account','mapping-conflict','identity-changed','consent-required','setup-incomplete'].includes(code)?'account-resolution-required':'validation-failed');
    const saved=(await read())[p];if(saved?.confirmed)await retry(p,saved,error);
    // Retry absent peers a bounded number of times. New-model peer startup also
    // sends DISCOVER, so later installation does not depend on polling forever.
    if(code==='transport'||code==='source-busy'){
     const key=ALARM+'discovery-'+p,attemptKey='galacticPurchaseDiscoveryAttempts:'+p,attempt=(await area.get({[attemptKey]:0}))[attemptKey]+1;
     if(attempt<=5){await area.set({[attemptKey]:attempt});await alarms?.create(key,{when:now()+[60000,300000,900000,3600000,3600000][attempt-1]});}
    }
   }
  }
  async function startup(){await sharingPreferences(area);for(const p of supported){const s=(await read())[p];if(needsRepair(s)&&!['sharing-disabled','operation-failed'].includes(s.errorCode))continue;await discover(p);}}
  function register(){service.setSync({external,local,allowed});alarms?.onAlarm?.addListener(alarm=>{if(alarm.name.startsWith(ALARM+'discovery-')){const p=alarm.name.slice((ALARM+'discovery-').length);if(supported.includes(p))discover(p).catch(()=>{});}else if(alarm.name.startsWith(ALARM)){const p=alarm.name.slice(ALARM.length);if(supported.includes(p))run(p).catch(()=>{});}});runtime.onStartup?.addListener(()=>startup().catch(()=>{}));runtime.onInstalled?.addListener(()=>startup().catch(()=>{}));startup().catch(()=>{});}
  async function notifyInvalidated(events){for(const event of events)try{await service.request(event.peerId,{type:PREFIX+'DISCONNECT',provider:event.provider,id:event.id});}catch{}}
  return {register,mark,run,local,external,allowed,discover,accounts,startup,configurationChanged,notifyInvalidated,dispose(){disposed=true;clearTimeout(timer);for(const t of wakeTimers.values())clearTimeout(t);}};
 }
 // Compare committed purchase data, excluding bookkeeping and display labels.
 function meaningful(value){if(Array.isArray(value))return value.map(meaningful);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['observedAt','updatedAt','importedAt','archivedAt','lastSync','profileLabel','nickname','localScanState'].includes(k)).map(([k,v])=>[k,meaningful(v)]));return value;}
 function observeCompanion(chrome,coordinator,provider,keys,control){let deferred=false;chrome.storage.onChanged?.addListener((changes,area)=>{if(area!=='local')return;const restored=changes.galacticPurchaseSync?.newValue?.[provider];if(restored?.recovery&&!restored.confirmed&&restored.id!==changes.galacticPurchaseSync?.oldValue?.[provider]?.id)coordinator.discover?.(provider,undefined,true).catch(()=>{});if(changes.galacticLibraryExtensionId&&changes.galacticLibraryExtensionId.oldValue!==changes.galacticLibraryExtensionId.newValue)coordinator.configurationChanged?.(provider).catch(()=>{});const changed=keys.some(k=>changes[k]&&stable(meaningful(changes[k].oldValue))!==stable(meaningful(changes[k].newValue)));if(!changed&&!(deferred&&changes[control]&&!changes[control].newValue))return;chrome.storage.local.get({[control]:null}).then(state=>{if(state[control]){deferred=true;return;}deferred=false;return coordinator.mark(provider);}).catch(()=>{});});}
 root.GalacticPurchaseSync=Object.freeze({KEY,REGISTRY,PREFERENCE,PREFIX,ALARM,sharingPreferences,sharingAllowed,stable,fingerprint,accountUuid,migrateAccounts,restoredAccounts,failureKind,retryable,needsRepair,retirementPatch,restorationPatch,assertCommit,meaningful,observeCompanion,createCoordinator});
})(globalThis);
