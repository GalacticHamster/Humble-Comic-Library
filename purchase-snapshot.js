/* GalacticHamster purchase snapshot v1. Local assets; no acquisition. */
(function(root){'use strict';
 const VERSION=1,MAX_RECORDS=50000,MAX_BYTES=32*1024*1024,CHUNK_BYTES=96*1024;
 const media=new Set(['book','audiobook','game','software','audio','elearning','other']);
 const fields=['authors','contributors','series','isbn','isbns','publisher','language','edition','volume','issue','unitType','run','seriesYear','publicationDate','format','collects','contentsStatement','detailUrl','imageUrl','steamAppId','asin','workId','editionId','seriesId','runId','platforms','sourceBundle','purchaseId','entitlement','keyType','keyStatus','keyCheckedAt','expiresAt','slug','bundleId','bundleTitle','bundleSlug','drm','formats'];
 function fail(message){throw Error(message||'Invalid purchase snapshot.');}
 function text(value,max=500){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))fail();return value;}
 const date=value=>{if(value==null)return null;if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))fail();return new Date(value).toISOString();};
 const plain=value=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
 const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const size=value=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).length;
 function metadata(value={},provider){if(!plain(value))fail();const out={};for(const [key,entry]of Object.entries(value)){
   if(!fields.includes(key))fail('Unsupported purchase metadata: '+key);
   if(['detailUrl','imageUrl'].includes(key)){const url=new URL(text(entry,2000));if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!((host=>url.hostname===host||url.hostname.endsWith('.'+host))(provider==='humble'?'humblebundle.com':'fanatical.com')))fail('Unsafe store link.');out[key]=url.href;}
   else if(key==='contributors'){if(!Array.isArray(entry)||entry.length>50)fail();out[key]=entry.map(v=>{if(!plain(v)||Object.keys(v).some(k=>!['name','role'].includes(k)))fail();return {name:text(v.name),role:text(v.role??'',80)};});}
   else if(entry===null&&key==='expiresAt')out[key]=null;
   else if(Array.isArray(entry)){if(entry.length>50)fail();out[key]=entry.map(v=>text(v,500));}
   else out[key]=text(entry,['collects','contentsStatement'].includes(key)?10000:500);
 }
 if(out.keyCheckedAt!==undefined){if(!['humble','fanatical'].includes(provider)||!(provider==='humble'?['unknown','unrevealed','revealed','expired','unavailable']:['unknown','unrevealed']).includes(out.keyStatus)||!date(out.keyCheckedAt))fail('Invalid key observation.');out.keyCheckedAt=date(out.keyCheckedAt);}
 if(out.entitlement&&!['direct-download','third-party-key'].includes(out.entitlement)||out.keyStatus&&!['unknown','unrevealed','revealed','expired','unavailable'].includes(out.keyStatus))fail('Invalid entitlement evidence.');
 return out;}
 const reviewDate=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v));
 function keyReview(value){if(value===undefined)return undefined;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['action','basis','until','updatedAt'].includes(k))||!['active','dismissed','snoozed'].includes(value.action)||!['unknown','unrevealed'].includes(value.basis)||!reviewDate(value.updatedAt)||value.action==='snoozed'&&!reviewDate(value.until)||value.action!=='snoozed'&&value.until!=null)fail('Invalid key reminder review.');
 return {action:value.action,basis:value.basis,until:value.action==='snoozed'?date(value.until):null,updatedAt:date(value.updatedAt)};}
 function mergeKeyReview(a,b){const left=keyReview(a),right=keyReview(b);if(!left)return right;if(!right)return left;return left.updatedAt>right.updatedAt||left.updatedAt===right.updatedAt&&JSON.stringify(left)>JSON.stringify(right)?left:right;}
 function keyReviewHidden(origin,now=Date.now()){const r=keyReview(origin.keyReview);return Boolean(r&&r.basis===origin.keyStatus&&(r.action==='dismissed'||r.action==='snoozed'&&Date.parse(r.until)>now));}
 function record(value,provider){if(!plain(value)||Object.keys(value).some(key=>!['providerItemId','title','mediaType','metadata','purchasedAt','origins'].includes(key)))fail();
 const id=value.providerItemId==null?null:text(value.providerItemId,500);if(id!==null&&!id.trim()||!text(value.title).trim()||!media.has(value.mediaType))fail();
 if(provider==='fanatical'&&(id===null||!/^[a-zA-Z0-9_-]{6,128}$/u.test(id)))fail('Fanatical product identity is missing.');
 const meta=metadata(value.metadata,provider);
 if(provider==='humble'&&(!meta.purchaseId||meta.purchaseId.length>256))fail('Humble purchase identity is missing.');
 const origins=value.origins??[];if(!Array.isArray(origins)||origins.length>500)fail();
 const clean=origins.map(origin=>{if(!plain(origin)||Object.keys(origin).some(key=>!['orderRef','bundleId','bundleTitle','bundleSlug','purchasedAt','quantity','occurrenceRefs','keyStatus','keyCheckedAt','keyReview'].includes(key))||!/^[a-f0-9]{64}$/u.test(origin.orderRef)||!Number.isInteger(origin.quantity)||origin.quantity<1||origin.quantity>500)fail('Invalid purchase occurrence.');
 if(origin.keyReview!==undefined&&(provider!=='fanatical'||!origin.keyCheckedAt))fail('Invalid key reminder review scope.');
 const refs=origin.occurrenceRefs??[];if(!Array.isArray(refs)||refs.length>500||refs.some(ref=>!/^[a-f0-9]{64}$/u.test(ref))||new Set(refs).size!==refs.length||refs.length&&refs.length!==origin.quantity)fail('Invalid occurrence identifiers.');
 if(origin.keyStatus!==undefined||origin.keyCheckedAt!==undefined){if(provider!=='fanatical'||!['unknown','unrevealed'].includes(origin.keyStatus)||!date(origin.keyCheckedAt))fail('Invalid key observation.');}
 return {...(origin.keyReview!==undefined?{keyReview:keyReview(origin.keyReview)}:{}),...(origin.keyStatus!==undefined?{keyStatus:origin.keyStatus,keyCheckedAt:date(origin.keyCheckedAt)}:{}),orderRef:origin.orderRef,bundleId:text(origin.bundleId??'',128),bundleTitle:text(origin.bundleTitle??''),bundleSlug:text(origin.bundleSlug??'',300),purchasedAt:date(origin.purchasedAt),quantity:origin.quantity,occurrenceRefs:refs};});
 if(new Set(clean.map(origin=>JSON.stringify([origin.orderRef,origin.bundleId]))).size!==clean.length)fail('Duplicate purchase groups.');
 return {providerItemId:id,title:value.title,mediaType:value.mediaType,metadata:meta,purchasedAt:date(value.purchasedAt),origins:clean};}
 function validate(value){if(!plain(value)||Object.keys(value).some(key=>!['protocolVersion','provider','snapshotId','accountRef','accountLabel','capturedAt','scope','completeness','limitations','records'].includes(key))||value.protocolVersion!==VERSION||!['humble','fanatical'].includes(value.provider)||!['full','incremental','historical','incomplete'].includes(value.scope)||!['complete','partial'].includes(value.completeness)||value.scope==='incomplete'&&value.completeness==='complete')fail('Unsupported purchase snapshot version or scope.');
 if(!Array.isArray(value.records)||value.records.length>MAX_RECORDS||!Array.isArray(value.limitations)||value.limitations.length>20)fail();
 const result={protocolVersion:VERSION,provider:value.provider,snapshotId:text(value.snapshotId,100),accountRef:text(value.accountRef,128),accountLabel:text(value.accountLabel,100),capturedAt:date(value.capturedAt),scope:value.scope,completeness:value.completeness,limitations:value.limitations.map(v=>text(v,500)),records:value.records.map(v=>record(v,value.provider))};
 if(!result.snapshotId||!result.accountRef||!result.capturedAt||size(result)>MAX_BYTES)fail('Purchase snapshot exceeds the bounded transfer size.');
 const ids=result.records.map(v=>v.providerItemId??JSON.stringify([v.metadata.purchaseId,v.title,v.mediaType,v.metadata.entitlement??'']));if(new Set(ids).size!==ids.length)fail('Duplicate provider purchase records.');return result;}
 function withoutKeyObservations(value,level=0){
 const data=JSON.parse(JSON.stringify(value));if(data.provider==='humble'){if(level<1)for(const row of data.records)delete row.metadata.keyCheckedAt;return data;}if(data.provider!=='fanatical')return data;
 for(const row of data.records){if(level<1&&row.metadata?.keyCheckedAt!==undefined){delete row.metadata.keyStatus;delete row.metadata.keyCheckedAt;}for(const origin of row.origins??[]){if(level<1){delete origin.keyStatus;delete origin.keyCheckedAt;}if(level<2)delete origin.keyReview;}}return data;
 }
 function equal(left,right){
 if(left===right)return true;
 if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;
 const a=Object.keys(left).filter(key=>left[key]!==undefined),b=Object.keys(right).filter(key=>right[key]!==undefined);
 return a.length===b.length&&a.every(key=>Object.hasOwn(right,key)&&equal(left[key],right[key]));
 }
 function sparse(value){return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined&&v!==null&&v!==''&&(!Array.isArray(v)||v.length)));}
 function richer(previous={},incoming={}){const out={...incoming,...previous};for(const [key,value]of Object.entries(incoming))if(previous[key]===undefined||previous[key]===null||previous[key]===''||Array.isArray(previous[key])&&!previous[key].length)out[key]=value;return out;}
 root.GalacticPurchaseSnapshot=Object.freeze({VERSION,MAX_RECORDS,MAX_BYTES,CHUNK_BYTES,fields,hash,size,metadata,record,validate,keyReview,mergeKeyReview,keyReviewHidden,withoutKeyObservations,equal,sparse,richer});
})(globalThis);
