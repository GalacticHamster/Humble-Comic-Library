/* Bounded, peer-scoped pull transfers. No external import endpoint. */
(function(root){'use strict';
 const S=root.GalacticPurchaseSnapshot,TTL=10*60*1000;
 function createService({runtime,area,authorize,peer,accounts,snapshot,commit,bind=async()=>{},now=()=>Date.now()}){
 const exports=new Map();let preparing=0,running=false;const prefix='GH_PURCHASE_',key='galacticPurchaseOffer';
 const expired=()=>{for(const [id,value]of exports)if(value.until<=now())exports.delete(id);};
 async function request(id,value){let timer;try{const response=await Promise.race([runtime.sendMessage(id,{...value,protocolVersion:1}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Purchase transfer timed out. Retry; no partial import is applied.')),30000);})]);if(response?.ok!==true||response.protocolVersion!==1)throw Error(response?.error??'Update/link both extensions before transferring purchases.');return response;}finally{clearTimeout(timer);}}
 async function prepare(provider,accountRef,client){expired();if(exports.size+preparing>=2)throw Error('Two outgoing transfers are already prepared. Finish or retry after they expire.');preparing++;try{const data=S.validate(await snapshot(provider,accountRef));if(data.provider!==provider)throw Error('Wrong provider snapshot.');
 const chunks=[];let rows=[],bytes=2;for(const row of data.records){const count=S.size(row)+1;if(count+2>S.CHUNK_BYTES)throw Error('One purchase record exceeds the chunk limit.');if(bytes+count>S.CHUNK_BYTES||rows.length>=250){chunks.push(rows);rows=[];bytes=2;}rows.push(row);bytes+=count;}if(rows.length)chunks.push(rows);
 const token=crypto.randomUUID(),digest=await S.hash(JSON.stringify(data));const header={...data};delete header.records;
 const manifest={header,token,count:data.records.length,chunkCount:chunks.length,bytes:S.size(data),digest,expiresAt:now()+TTL};exports.set(token,{client,provider,chunks,manifest,until:manifest.expiresAt});return manifest;}finally{preparing--;}}
 function validateManifest(m,provider){
 if(!m||!m.header||m.header.provider!==provider||typeof m.token!=='string'||!m.token||m.token.length>100||!Number.isInteger(m.count)||m.count<0||m.count>S.MAX_RECORDS||!Number.isInteger(m.chunkCount)||m.chunkCount<0||m.chunkCount>m.count||m.count>0&&m.chunkCount===0||!Number.isInteger(m.bytes)||m.bytes<0||m.bytes>S.MAX_BYTES||!/^[a-f0-9]{64}$/u.test(m.digest)||!Number.isFinite(m.expiresAt)||m.expiresAt<=now()||m.expiresAt>now()+TTL+10000||S.size(m)>20000)throw Error('Invalid or expired purchase manifest.');
 S.validate({...m.header,records:[]});return m;
 }
 async function external(message,sender){expired();if(message.protocolVersion!==1)throw Error('Unsupported purchase handoff protocol.');if(!await authorize(sender.id,message.provider))throw Error('Purchase handoff peer/provider is not authorized.');
 if(message.type===prefix+'CAPABILITIES')return {maxRecords:S.MAX_RECORDS,maxBytes:S.MAX_BYTES,chunkBytes:S.CHUNK_BYTES};
 if(message.type===prefix+'ACCOUNTS')return {accounts:await accounts(message.provider)};
 if(message.type===prefix+'BEGIN')return {manifest:await prepare(message.provider,message.accountRef,sender.id)};
 if(message.type===prefix+'CHUNK'||message.type===prefix+'ACK'||message.type===prefix+'CANCEL'){
 const pending=exports.get(message.token);if(!pending||pending.client!==sender.id||pending.provider!==message.provider)throw Error('Purchase transfer expired or source worker restarted. Retry from the beginning.');
 if(message.type!==prefix+'CHUNK'){if(message.type===prefix+'ACK'&&message.digest!==pending.manifest.digest)throw Error('Invalid commit acknowledgement.');exports.delete(message.token);return {};}
 if(!Number.isInteger(message.index)||message.index<0||message.index>=pending.chunks.length)throw Error('Invalid purchase chunk order.');const records=pending.chunks[message.index];return {index:message.index,records,digest:await S.hash(JSON.stringify(records))};}
 if(message.type===prefix+'OFFER'){
 const m=validateManifest(message.manifest,message.provider);await area.set({[key]:{peerId:sender.id,provider:message.provider,manifest:m}});await runtime.openOptionsPage();return {offered:true};}
 throw Error('Unsupported purchase handoff operation.');}
 const notify=value=>{try{Promise.resolve(runtime.sendMessage({type:'GH_PURCHASE_PROGRESS',...value})).catch(()=>{});}catch{}};
 async function local(message){if(message.action==='pending'){const offer=(await area.get({[key]:null}))[key];return {offer:offer?.provider===message.provider&&offer.manifest.expiresAt>now()?offer:null};}if(message.action==='state'){const offer=(await area.get({[key]:null}))[key];return {accounts:await accounts(message.provider),offer:offer?.provider===message.provider&&offer.manifest.expiresAt>now()?offer:null};}
 const id=await peer(message.provider,message.peerId);await bind(id,message.provider);
 if(message.action==='remoteAccounts'){await request(id,{type:prefix+'CAPABILITIES',provider:message.provider});return request(id,{type:prefix+'ACCOUNTS',provider:message.provider});}
 if(message.action==='send'){const manifest=await prepare(message.provider,message.accountRef,id);try{await request(id,{type:prefix+'OFFER',provider:message.provider,manifest});return {offered:true,count:manifest.count};}catch(error){exports.delete(manifest.token);throw error;}}
 if(message.action!=='import'||message.confirmed!==true)throw Error('Confirm the source and destination store accounts before importing.');if(running)throw Error('A purchase handoff is already importing. Wait for it to finish.');running=true;let manifest,committed=false;const transferStarted=now();
 try{
 notify({stage:'Preparing purchase records',done:0,total:0});
 if(message.useOffer){const offer=(await area.get({[key]:null}))[key];if(!offer||offer.peerId!==id||offer.provider!==message.provider||offer.manifest.token!==message.offerToken||offer.manifest.expiresAt<=now())throw Error('The purchase offer changed or expired. Refresh and confirm again.');manifest=offer.manifest;}
 else manifest=(await request(id,{type:prefix+'BEGIN',provider:message.provider,accountRef:message.accountRef})).manifest;
 validateManifest(manifest,message.provider);if(manifest.header.accountRef!==message.accountRef)throw Error('Source account changed. Refresh and confirm again.');
 const records=[];let bytes=0;for(let index=0;index<manifest.chunkCount;index++){
 const response=await request(id,{type:prefix+'CHUNK',provider:message.provider,token:manifest.token,index});
 if(response.index!==index||!Array.isArray(response.records)||response.records.length>250||S.size(response.records)>S.CHUNK_BYTES||await S.hash(JSON.stringify(response.records))!==response.digest)throw Error('Corrupt or out-of-order purchase chunk; no import applied.');
 for(const record of response.records)records.push(S.record(record,message.provider));bytes+=S.size(response.records);if(bytes>S.MAX_BYTES||records.length>manifest.count)throw Error('Purchase transfer exceeded its advertised bounds.');notify({stage:'Transferring records',done:records.length,total:manifest.count});}
 notify({stage:'Validating',done:records.length,total:manifest.count});const data=S.validate({...manifest.header,records});if(records.length!==manifest.count||S.size(data)!==manifest.bytes||await S.hash(JSON.stringify(data))!==manifest.digest)throw Error('Incomplete or corrupt purchase snapshot; no import applied.');
 if(!await authorize(id,message.provider)||await peer(message.provider,message.peerId)!==id)throw Error('Purchase sharing permission changed before import; no records imported.');
 const transferMs=now()-transferStarted;notify({stage:'Importing',done:records.length,total:manifest.count});const started=now();const result=await commit(data,message.target);const importMs=now()-started;committed=true;
 let acknowledged=true;try{await request(id,{type:prefix+'ACK',provider:message.provider,token:manifest.token,digest:manifest.digest});}catch{acknowledged=false;}
 let offerCleared=true;if(message.useOffer)try{await area.set({[key]:null});}catch{offerCleared=false;}notify({stage:'Complete',done:records.length,total:manifest.count});return {...result,received:records.length,acknowledged,offerCleared,limitations:data.limitations,transferMs,importMs};
 }catch(error){if(message.useOffer&&!committed)try{const saved=(await area.get({[key]:null}))[key];if(saved?.manifest.token===message.offerToken)await area.set({[key]:null});}catch{}if(manifest&&!committed)try{await request(id,{type:prefix+'CANCEL',provider:message.provider,token:manifest.token});}catch{}throw error;}finally{running=false;}}
 function register(){runtime.onMessageExternal?.addListener((message,sender,respond)=>{if(!message?.type?.startsWith(prefix))return false;external(message,sender).then(value=>respond({ok:true,protocolVersion:1,...value}),error=>respond({ok:false,protocolVersion:1,error:error.message}));return true;});
 runtime.onMessage.addListener((message,sender,respond)=>{if(message?.type!=='GH_PURCHASE_ACTION')return false;if(sender.id!==runtime.id||!sender.url?.startsWith(runtime.getURL(''))){respond({ok:false,error:'Open Extension options for purchase handoff.'});return false;}local(message).then(value=>respond({ok:true,...value}),error=>respond({ok:false,error:error.message}));return true;});}
 return {external,local,register,request,prepare};}
 root.GalacticPurchaseTransfer=Object.freeze({createService,TTL});
})(globalThis);
