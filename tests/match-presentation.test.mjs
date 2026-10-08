import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),hb=fs.existsSync(new URL('ownership.js',root));
const ctx={URL};ctx.globalThis=ctx;vm.createContext(ctx);
for(const file of hb?['shared.js','collection-mappings.js','ownership.js']:['src/shared.js','src/planning.js'])vm.runInContext(fs.readFileSync(new URL(file,root),'utf8'),ctx);
const P=(hb?ctx.HumbleOwnership:ctx.FanaticalLibrary).presentation;
const item={title:'30 Days of Night Deluxe Edition: Book One',kind:'book',mediaType:'book'};
const local={title:'30 Days of Night',source:hb?'humble':'fanatical',sourceBundle:'Anniversary collection',purchasedAt:'2026-01-02T12:00:00Z',relationship:'same-work'};
const central=(ownership='subscription',extra={})=>({title:item.title,provider:'kindle',ownership,relationship:'same-edition',itemRef:'opaque-one',evidence:{source:'amazon-kindle-content-library',authors:['Steve Niles'],checkedAt:'2026-10-01T12:00:00Z'},verifiedAt:null,...extra});
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};
const temporary=central();
const example=freeze({state:'possible',ownershipReview:true,offered:item,localMatch:{state:'possible',item:local},externalPossibleMatches:[temporary],externalResult:{matches:[],possibleMatches:[temporary]}});
test('30 Days separates same-title subscription from related purchased base edition without modifying evidence',()=>{
 const before=JSON.stringify(example),views=P.candidateViews(item,example);
 assert.equal(views.length,2);assert.equal(views[0].heading,'Same title found');assert.equal(views[0].access,'Subscription access');
 assert.equal(views[1].heading,'Possibly related purchase');assert.match(views[1].uncertainty,/different edition/);assert.match(views[1].context,/Anniversary collection/);assert.doesNotMatch(views[1].context,/T12:00/);
 assert.equal(P.status(item,example),'Check ownership');assert.doesNotMatch(P.tooltip(item,example),/amazon-kindle|same-edition|2026-10-01|verified/);assert.equal(JSON.stringify(example),before);
});
for(const [ownership,label]of [['subscription','Subscription access'],['borrowed','Borrowed access'],['rental','Rental access'],['unknown','Ownership not confirmed'],['owned','Owned'],['claimed','Owned']])test('candidate access: '+ownership,()=>{
 const record=central(ownership),match=freeze({state:'possible',externalPossibleMatches:[record]});
 assert.equal(P.candidateViews(item,match)[0].access,label);assert.equal(P.status(item,match),'Possible');
});
test('contents verification date never becomes ownership confirmation; missing metadata does not add a blanket warning',()=>{
 const record=central('owned',{evidence:{},verifiedAt:'2026-10-01T12:00:00Z'});const match={state:hb?'elsewhere':'owned-elsewhere',externalMatches:[record]};
 const view=P.candidateViews(item,match)[0];assert.equal(view.access,'Owned');assert.equal(view.uncertainty,'');assert.equal(view.annotations.length,0);assert.doesNotMatch(JSON.stringify(view),/verified|unknown|identifiers/);
});
test('distinct providers, account nicknames and access records survive; repeated opaque references appear once',()=>{
 const records=[central('owned'),central('subscription'),central('owned',{itemRef:'opaque-two',provider:'kobo'}),{...local,profileLabel:'personal'},{...local,profileLabel:'family'}];
 const views=P.candidateViews(item,{state:'possible',externalPossibleMatches:records.slice(0,3),candidates:records.slice(3),externalResult:{possibleMatches:[structuredClone(records[0])]}});
 assert.equal(views.length,5);assert.deepEqual(Array.from(views.filter(v=>v.account).map(v=>v.account)),['personal','family']);assert(views.some(v=>v.provider==='Kobo'));
});
test('central fields outside the contract do not become account context or raw URLs',()=>{
 const record=central('owned',{profileLabel:'not-in-contract',sourceItemId:'secret-source',url:'https://private.invalid/'});const view=P.candidateViews(item,{state:'possible',externalMatches:[record]})[0];
 assert.equal(view.account,'');assert.doesNotMatch(JSON.stringify(view),/secret-source|private.invalid|not-in-contract/);
});
test('partial numbered and software-component results explain limited overlap without confirming whole edition',()=>{
 for(const match of [{state:'partial',range:{owned:2,total:4},externalResult:{partialMatches:[central('owned',{relationship:'contains'})]}},{state:'partial',owned:1,total:3,componentMatches:[{state:'owned',item:{...local,title:'Paint app'}}]}]){
 assert.match(P.explanation(item,match),/some|Some/);assert.match(P.explanation(item,match),/does not establish ownership/);assert.equal(P.status(item,match),'Partial');assert.equal(P.candidateViews(item,match).length,1);
 }
});
test('new, incomplete and stale evidence remain distinct',()=>{
 assert.equal(P.status(item,{state:'new'}),'New');assert.match(P.explanation(item,{state:'new'}),/available library data/);
 assert.equal(P.status(item,{state:'unchecked',lookupIncomplete:true}),'Check incomplete');assert.match(P.explanation(item,{state:'unchecked'}),/could not finish/);
 const stale=P.candidateViews(item,{state:'possible',externalMatches:[central('owned',{evidence:{availability:'not-observed-in-last-full-scan'}})]})[0];assert.match(stale.annotations[0],/availability needs review/);
 const historical=P.candidateViews(item,{state:'possible',historicalItems:[{...local,historical:true}]})[0];assert.match(historical.access,/current access needs review/);assert.doesNotMatch(historical.access,/Purchased/);
});
test('manual ownership, purchased keys and ownership preference retain their distinctions',()=>{
 assert.equal(P.access({title:'Manual title'},true),'Marked as owned locally');
 assert.match(P.access({...local,entitlement:'third-party-key'},true),/activation not confirmed/);
 const record=central('owned',{evidence:{ownershipBasis:'user-assumed-owned',observedOwnership:'subscription'}}),view=P.candidateViews(item,{state:'possible',externalMatches:[record]})[0];
 assert.match(view.access,/your preference/);assert.match(view.annotations[0],/Subscription access/);
});
test('known ISBN, language and revision differences have specific practical guidance',()=>{
 for(const [offer,record,pattern]of [[{...item,isbn:['9780306406157']},{...local,isbn:['9780140328721']},/ISBNs differ/],[{...item,language:'en'},{...local,language:'fr'},/languages differ/],[item,local,/different edition/]]){
 const view=P.candidateViews(offer,{state:'possible',item:record})[0];assert.match(view.uncertainty,pattern);
 }
});
test('all principal outcomes count offered items once, not candidates, and preserve immutable state',()=>{
 const rows=['owned',hb?'elsewhere':'owned-elsewhere','new','partial','possible','unchecked'].map(state=>({item,match:freeze({...example,state,range:{owned:1,total:2}})}));const before=JSON.stringify(rows);
 const model=P.summary(rows);assert.equal(Object.values(model.counts).reduce((a,b)=>a+b,0),6);for(const row of rows){P.tooltip(row.item,row.match);P.explanation(row.item,row.match);}
 assert.equal(JSON.stringify(rows),before);
});
test('long titles and verbose reasons stay literal and technical reasons remain separate',()=>{
 const long='Very long title '.repeat(80),record=central('subscription',{title:long,reason:'raw normalization diagnostic '.repeat(100)}),match={state:'possible',ownershipReview:true,externalPossibleMatches:[record]};
 assert.equal(P.candidateViews(item,match)[0].title,long);assert.doesNotMatch(P.tooltip(item,match),/raw normalization/);assert(P.relatedCaption(item,match).includes('Kindle'));
});

test('different evidence claims for one opaque item are not silently combined',()=>{
 const a=central('owned',{reason:'Title match'}),b=central('owned',{reason:'Edition uncertain'});
 assert.equal(P.candidateViews(item,{state:'possible',externalPossibleMatches:[a,b]}).length,2);
});
