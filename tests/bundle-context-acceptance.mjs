import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {bundleFixture} from './matching-fixture.mjs';
const root=new URL('../',import.meta.url),hb=fs.existsSync(new URL('ownership.js',root));
const baseline=process.argv[2];if(!baseline)throw Error('Pass the pre-context commit hash. Synthetic data only.');
const cache=new Map(),readSource=file=>{if(!cache.has(file))cache.set(file,execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8',windowsHide:true}));return cache.get(file);};
const original='Beneath the Trees Where Nobody Sees',sequel=original+': Rite of Spring';
const book=title=>({title,kind:'book',mediaType:'book'});
const strong={provider:'kindle',itemRef:'original-ref',title:original,ownership:'owned',relationship:'same-edition',reason:'Matching full book title with no conflicting identity evidence'};
const weak={...strong,relationship:'same-work',reason:'Related title or edition; compare the owned and offered titles.'};
const subscribed={...strong,itemRef:'sequel-ref',title:sequel,ownership:'subscription'};
const scenarios=[
 ['core',[book(original),book(sequel),book('Independent New Story')],[],{[original]:{matches:[strong]},[sequel]:{possibleMatches:[subscribed,weak]}},1],
 ['lone',[book(sequel)],[],{[sequel]:{possibleMatches:[subscribed,weak]}},0],
 ['local',[book(original),book(sequel)],[{title:original,source:hb?'humble':'fanatical',sourceBundle:'Synthetic purchase',bundle:{title:'Synthetic purchase'}}],{},1],
 ['incomplete',[book(original),book(sequel)],[],{[original]:{matches:[strong]},[sequel]:new Error('Synthetic request failed')},0],
 ['no strong',[book(original),book(sequel)],[],{[original]:{possibleMatches:[weak]},[sequel]:{possibleMatches:[weak]}},0],
 ['edition',[book(original),book(original+' Deluxe Edition')],[],{[original]:{matches:[strong]},[original+' Deluxe Edition']:{possibleMatches:[weak]}},0],
 ['formats',[{...book(original),format:'PDF'},{...book(sequel),format:'EPUB'}],[],{[original]:{matches:[strong]},[sequel]:{possibleMatches:[weak]}},0],
 ['manual',[book(original),book(sequel)],[],{[original]:{matches:[strong]},[sequel]:{possibleMatches:[{...weak,reason:'Reviewed same-work relationship.'}]}},0]
];
const results=[];
for(const [name,offers,records,responses,deferred]of scenarios){const old=bundleFixture(offers,records,responses,{readSource}),current=bundleFixture(offers,records,responses);const before=await old.classify(),after=await current.classify();assert.equal(JSON.stringify(after),JSON.stringify(before),name+' changed authoritative matching');assert.equal(JSON.stringify(current.P.summary(after)),JSON.stringify(old.P.summary(before)),name+' changed summary');if(hb)assert.equal(JSON.stringify(current.context.summary),JSON.stringify(old.context.summary),name+' changed tier/count values');const projection=current.P.reconcileBundle(after,{complete:true});assert.equal(projection.deferredCount,deferred,name);results.push({name,unchangedMatches:true,deferred,states:after.map(row=>row.match.state)});}
// Measure the added projection, not network/matching time. 1,000 offered products;
// 500 distinct owned identities with one competing title each, across >500 queries.
const offers=[],responses={};for(let i=0;i<500;i++){const title='Synthetic Work '+i,other=title+': Related Story';offers.push(book(title),book(other));const r={...strong,title,itemRef:'synthetic-'+i};responses[title]={matches:[r]};responses[other]={possibleMatches:[{...r,relationship:'same-work',reason:weak.reason}]};}
const f=bundleFixture(offers,[],responses),rows=await f.classify();const authoritative=JSON.stringify(rows),times=[];for(let n=0;n<7;n++){const start=performance.now();const result=f.P.reconcileBundle(rows,{complete:true});times.push(performance.now()-start);assert.equal(result.deferredCount,500);assert.equal(JSON.stringify(rows),authoritative);}
const reversed=[...rows].reverse();f.P.reconcileBundle(reversed,{complete:true});const primary=Object.fromEntries(rows.map(({item,match})=>[item.title,Array.from(f.P.primaryCandidateViews(item,match),v=>[v.title,v.provider,v.access])]));
const report={repo:hb?'HB':'FAN',baseline,scenarios:results,largeBundle:{offers:1000,candidates:1000,expectedDeferred:500,projectionMs:times,medianMs:[...times].sort((a,b)=>a-b)[3],matchingObjectsUnchanged:true},corePrimary:Object.fromEntries((await bundleFixture(scenarios[0][1],[],scenarios[0][3]).classify()).map(({item,match})=>[item.title,match.state])),largePrimary:primary};
fs.mkdirSync(new URL('audit-artifacts/bundle-match-context/',root),{recursive:true});fs.writeFileSync(new URL('audit-artifacts/bundle-match-context/acceptance.json',root),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,largePrimary:undefined},null,2));
