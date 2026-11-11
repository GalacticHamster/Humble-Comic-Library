import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fixture} from './matching-fixture.mjs';
import {importer,initialState,order,bookDetail} from './partial-import-fixture.mjs';

// Shape observed in public November 11 Flight props; synthetic titles/IDs only.
const page={slug:'test',tiers:[{price:{amount:15,currencyCode:'USD'},bundleItems:[{title:'Quoted "title" {test}'},{title:'Other book'}]},{price:{amount:5,currencyCode:'USD'},bundleItems:[{title:'Quoted "title" {test}'}]}]};
function metadata(value=page){
 const f=fixture([],'book',{title:'Unused'});f.context.location.pathname='/books/test';
 f.context.document.querySelectorAll=()=>[{textContent:'self.__next_f.push('+JSON.stringify([1,'e:["$","Component",null,'+JSON.stringify({bundlePage:value})+']'])+')'}];
 return {run:code=>vm.runInContext(code,f.context),context:f.context};
}
test('public Flight props are parsed without execution; escaped quotes and braces retain exact title identity',()=>{
 const f=metadata();assert.equal(f.run('readRedesignedBundle().slug'),'test');
 assert.equal(f.run('redesignedItemTier(\'Quoted "title" {test}\').price'),5);
 assert.equal(f.run('redesignedItemTier("Other book").price'),15);
 assert.equal(f.run('redesignedItemTier("Not a purchased product").price'),null);
});
test('stale routes, unresolved props, malformed tiers and foreign currencies cannot invent tier context',()=>{
 for(const p of [{...page,slug:'old'}, {slug:'test',tiers:'$r'}, {slug:'test',tiers:[{bundleItems:null}]}, {...page,tiers:page.tiers.map(t=>({...t,price:{...t.price,currencyCode:'EUR'}}))}]){
  assert.equal(metadata(p).run('redesignedItemTier("Other book").price'),null);
 }
 const f=metadata();f.context.document.querySelectorAll=()=>[{textContent:'self.__next_f.push([1,(()=>{throw Error("execute")})()])'}];assert.equal(f.run('readRedesignedBundle()'),null);
});
for(const full of [true,false])test(`redesigned ${full?'Full':'Quick'} stops before scan admission and preserves purchases/corrections/history/accounts/checkpoints`,async()=>{
 const f=importer({...initialState(),historicalLibraryItems:[{...initialState().libraryItems[0],title:'Earlier book'}],historicalPurchaseSummaries:[{purchaseKey:'earlier',sourceBundle:'Earlier bundle'}],mediaTypeOverrides:{old:'comic'},lastImport:{completedAt:'2026-11-01'},profileArchives:[{label:'Other'}]},[order('new')],{new:bookDetail('New')});
 const before=JSON.stringify(f.stored);f.context.document.querySelector=()=>({});
 await assert.rejects(f.scan(full),/temporarily unavailable/);
 assert.equal(JSON.stringify(f.stored),before);assert.equal(f.writes.length,0);assert.equal(f.requests.length,0);
});
test('legacy missing purchase API fails with actionable preservation message and no writes',async()=>{
 const f=importer({...initialState(),hclSyncControl:null},[],{}),before=JSON.stringify(f.stored);f.context.fetch=async()=>({ok:false,status:404});
 await assert.rejects(f.scan(),/changed its purchase service.*kept/);assert.equal(f.writes.length,0);assert.equal(JSON.stringify(f.stored),before);
});

test('a books-layout card does not erase established audiobook context',()=>{
 const f=metadata();assert.equal(f.run(`describeBundleItem({title:'Narration',element:{closest:()=>({getAttribute:()=> 'books'}),getAttribute:()=>null}}, {defaultKind:'audiobook',kindsByTitle:new Map(),productsByTitle:new Map()}).kind`),'audiobook');
});

test('all-tier title export reuses concrete public metadata without a legacy page fetch',async()=>{
 const f=metadata();f.context.document.querySelector=()=>({});f.context.fetch=()=>{throw Error('Unexpected legacy fetch');};
 const tiers=await f.run('tierTitlesFromPageData()');assert.equal(tiers.size,2);assert.equal(tiers.get('0').price,15);assert.equal(tiers.get('0').titles.size,2);assert.equal(tiers.get('1').price,5);
});
