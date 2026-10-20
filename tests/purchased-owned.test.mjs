import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {fixture} from './matching-fixture.mjs';
const hb=fs.existsSync(new URL('../ownership.js',import.meta.url)),provider=hb?'humble':'fanatical';
const offered={title:'Synthetic Space Adventure',sourceItemId:'offer-game'};
const purchase={title:offered.title,source:provider,kind:'game',mediaType:'game',sourceItemId:'local-game',purchaseKey:'synthetic-order',entitlement:'third-party-key',keyStatus:'unrevealed'};
const exact=(source='steam',extra={})=>({provider:source,title:offered.title,ownership:'owned',relationship:'same-edition',confidence:1,itemRef:'opaque-platform-item',evidence:{},...extra});
const P=f=>hb?f.context.HumbleOwnership.presentation:f.context.FanaticalLibrary.presentation;
async function badge(records,result=null,offer=offered,media='game'){
 const before=JSON.stringify([records,result]);
 const response=result&&Object.hasOwn(result,'requestId')?{...result}:result;if(response&&Object.hasOwn(response,'requestId'))delete response.requestId; // Harness assigns its own per-request ID.
 const f=fixture(records,media,offer,response);const {match}=await f.classify();
 assert.equal(JSON.stringify([records,result]),before,'Reconciliation must not mutate provider observations or GL evidence');
 return {f,match,label:P(f).status(f.context.offered,match)};
}
for(const source of ['steam','gog','epic','amazon-games','nintendo','playstation','xbox'])test('Purchased game becomes Owned with independent exact '+source+' evidence',async()=>{
 const {f,match,label}=await badge([purchase],{matches:[exact(source)]});assert.equal(label,'Owned');assert.equal(match.state,'owned');
 assert.equal(match.localMatch.item.title,purchase.title);assert.match(P(f).explanation(offered,match),/independently confirms ownership/);
 assert(P(f).candidateViews(offered,match).some(view=>view.access==='Owned'));
});
for(const [name,result]of [
 ['none',null],['same marketplace mirror',{matches:[exact(provider)]}],['other marketplace purchase',{matches:[exact(hb?'fanatical':'humble',{evidence:{purchaseEvidence:'confirmed',activationStatus:'unknown'}})]}],
 ['Possible platform match',{possibleMatches:[exact()]}],['Partial platform match',{partialMatches:[exact()]}],
 ...['subscription','borrowed','rental','unknown','returned','revoked','expired'].map(ownership=>[ownership,{matches:[exact('steam',{ownership})]}]),
 ['same work',{matches:[exact('steam',{relationship:'same-work'})]}],['contains',{matches:[exact('steam',{relationship:'contains'})]}],
 ['low confidence',{matches:[exact('steam',{confidence:0.8})]}],['legacy missing identity confirmation',{matches:[exact('steam',{relationship:undefined,confidence:undefined})]}],
 ['ownership assumption',{matches:[exact('steam',{evidence:{ownershipBasis:'user-assumed-owned',observedOwnership:'unknown'}})]}],
 ['marketplace origin mislabeled as platform',{matches:[exact('steam',{evidence:{source:'humble-purchase-library'}})]}],
 ['temporary confirmed access',{matches:[exact('steam',{evidence:{accessExpiresAt:'2099-01-01'}})]}],
 ['lookup failed',new Error('Lookup unavailable')]
])test('Purchased game remains Purchased: '+name,async()=>{
 const {f,match,label}=await badge([purchase],result);assert.equal(label,'Purchased');assert.equal(match.state,'owned');
 assert.equal(match.independentOwnershipMatches?.length||0,0);assert.match(P(f).explanation(offered,match),/does not confirm activation/);
});
test('A second marketplace purchase does not establish independent ownership',async()=>{
 const {label}=await badge([purchase,{...purchase,purchaseKey:'second-order',sourceItemId:'second-local-game'}],{matches:[exact(provider),exact(hb?'fanatical':'humble')]});assert.equal(label,'Purchased');
});
test('Independent platform evidence is found after marketplace records in the same response',async()=>{
 const {label,match}=await badge([purchase],{matches:[exact(hb?'fanatical':'humble'),exact()]});assert.equal(label,'Owned');assert.equal(match.independentOwnershipMatches.length,1);
});
test('No local purchase retains Owned elsewhere with exact platform ownership, and New without evidence',async()=>{
 const {label}=await badge([],{matches:[exact()]});assert.equal(label,'Owned elsewhere');assert.equal((await badge([])).label,'New');
});
test('Directly delivered books retain Owned and do not need a game ownership query',async()=>{
 const record={...purchase,kind:'book',mediaType:'book',title:'Distinctive Comic Volume 1',entitlement:'direct-download'};
 const {label}=await badge([record],null,{title:record.title,sourceItemId:'offer-book'},'book');assert.equal(label,'Owned');
});
test('Different platform edition never upgrades a locally purchased deluxe game',async()=>{
 const title=offered.title+' Deluxe Edition';const {label}=await badge([{...purchase,title}],{matches:[exact()]},{...offered,title});assert.equal(label,'Purchased');
});
test('Conflicting explicit edition metadata never upgrades a purchased game',async()=>{
 const {label}=await badge([{...purchase,edition:'Deluxe'}],{matches:[exact('steam',{evidence:{edition:'Standard'}})]},{...offered,edition:'Deluxe'});assert.equal(label,'Purchased');
});
test('Fresh responses downgrade a revoked platform copy without changing the purchase',async()=>{
 assert.equal((await badge([purchase],{matches:[exact()]})).label,'Owned');assert.equal((await badge([purchase],{matches:[exact('steam',{ownership:'revoked'})]})).label,'Purchased');
});
if(hb)test('HB queries local game purchases in its existing batch and shows local Purchased while pending',async()=>{
 const f=fixture([purchase],'game',offered,{matches:[]});let finish;const messages=[];
 f.context.chrome.runtime.sendMessage=async(_id,m)=>{messages.push(m);if(m.type==='PING')return {ok:true,apiVersion:1};return new Promise(resolve=>{finish=()=>resolve({ok:true,apiVersion:1,results:m.items.map(({requestId})=>({requestId,matches:[exact()]}))});});};
 const pending=f.classify();for(let i=0;i<20&&!finish;i++)await new Promise(resolve=>setTimeout(resolve,0));assert(finish,'Local purchases must not skip GL lookup');
 const local=f.context.comparison.resolvedItems[0].match;assert.equal(P(f).status(offered,local),'Purchased');finish();const {match}=await pending;assert.equal(P(f).status(offered,match),'Owned');
 assert.equal(messages.filter(m=>m.type==='MATCH_ITEMS').length,1);assert.equal(messages.find(m=>m.type==='MATCH_ITEMS').items.length,1);
});

const glRoot=new URL('../../GalacticLibrary/',import.meta.url);
if(fs.existsSync(new URL('src/lib/external-api.js',glRoot)))test('Real GL projection distinguishes marketplace copies from independent platform ownership',async()=>{
 const {createEmptyDatabase,normalizeProviderItem}=await import(new URL('src/lib/models.js',glRoot));
 const {handleExternalApiRequest}=await import(new URL('src/lib/external-api.js',glRoot));
 const database=createEmptyDatabase();
 const add=(source,id,ownership='owned')=>{const item=normalizeProviderItem({provider:source,providerItemId:id,title:offered.title,mediaType:'game',ownership,
   metadata:source==='humble'||source==='fanatical'?{entitlement:'third-party-key',keyStatus:'unrevealed',purchaseId:'synthetic-order'}:{steamAppId:'42'}});database.providerItems[item.id]=item;return item;};
 add(provider,'same-purchase');add(hb?'fanatical':'humble','other-marketplace');
 const response=()=>handleExternalApiRequest(database,{type:'MATCH_ITEMS',apiVersion:1,items:[{title:offered.title,mediaType:'game',excludeProviders:[provider]}]}).results[0];
 let result=response();assert(result.matches.some(record=>record.evidence.activationStatus==='unknown'));assert.equal((await badge([purchase],result)).label,'Purchased');
 const platform=add('steam','42');result=response();assert(result.matches.some(record=>record.provider==='steam'&&record.relationship==='same-edition'&&record.confidence===1));assert.equal((await badge([purchase],result)).label,'Owned');
 database.providerItems[platform.id]={...platform,ownership:'subscription'};assert.equal((await badge([purchase],response())).label,'Purchased');
});

test('Ownership preferences do not hide an already permanent independent platform observation',async()=>{
 const {label}=await badge([purchase],{matches:[exact('steam',{evidence:{ownershipBasis:'user-assumed-owned',observedOwnership:'owned'}})]});assert.equal(label,'Owned');
});
test('A legacy key purchase without a source label still queries independent ownership',async()=>{
 const {source,...legacy}=purchase;assert.equal((await badge([legacy],{matches:[exact()]})).label,'Owned');assert.equal((await badge([legacy])).label,'Purchased');
});
