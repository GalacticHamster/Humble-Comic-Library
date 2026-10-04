import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url), hb=fs.existsSync(new URL('ownership.js',root));
const ctx={URL};ctx.globalThis=ctx;vm.createContext(ctx);
for(const name of hb?['shared.js','collection-mappings.js','ownership.js']:['src/shared.js','src/planning.js'])vm.runInContext(fs.readFileSync(new URL(name,root),'utf8'),ctx);
const O=hb?ctx.HumbleOwnership:ctx.FanaticalLibrary;
const item=(title,extra={})=>({title,kind:'book',mediaType:'book',weight:5,...extra});
const relationCases=[
 ['same title missing metadata',item('A story',{authors:['Alan Moore'],isbn:['9780306406157']}),item('A story'),'match'],
 ['punctuation',item('Batman: Year One'),item('Batman - Year One'),'match'],
 ['related edition',item('Algorithmic Thinking'),item('Algorithmic Thinking, 2nd Edition'),'related'],
 ['related article',item('Room'),item('The Room'),'related'],
 ['conflicting ISBN',item('A story',{isbn:['9780306406157']}),item('A story',{isbn:['9780140328721']}),'related'],
 ['strong ISBN renamed',item('Original',{isbn:['9780306406157']}),item('Renamed',{isbn:['9780306406157']}),'match'],
 ['conflicting authors',item('A story',{authors:['Alan Moore']}),item('A story',{authors:['Neil Gaiman']}),'related'],
 ['compatible author variation is independent of ownership uncertainty',item('A story',{authors:['Alan Moore']}),item('A story',{authors:['A. Moore']}),'match'],
 ['shared ISBN cannot overrule contradictory authors',item('A story',{authors:['Alan Moore'],isbn:['9780306406157']}),item('A story',{authors:['Neil Gaiman'],isbn:['9780306406157']}),'related'],
 ['different volume',item('Saga Volume 1'),item('Saga Volume 2'),'none'],
 ['game package',item('Space Adventure',{kind:'game',mediaType:'game',externalIds:{steamAppId:'42'}}),item('Space Adventure Deluxe Edition',{kind:'game',mediaType:'game',externalIds:{steamAppId:'42'}}),'related'],
 ['different media',item('A story'),item('A story',{kind:'audiobook',mediaType:'audiobook'}),'none']
];
for(const [name,wish,offer,expected] of relationCases)test('wishlist parity: '+name,()=>{assert.equal(O.wishlistRelation(wish,offer),expected);});
test('wishlist parity: round trips preserve every validated ISBN for renamed fulfillment candidates',()=>{
 const wishes=(hb?ctx.HumbleComicLibrary:O).normalizeWishlist([item('Original',{isbn:['9780140328721','9780306406157']})]);
 assert.equal(O.wishlistRelation(wishes[0],item('Renamed',{isbn:['9780306406157']})),'match');
});
function plan(products,states,wishes,include=false,goal='wishlist',pool=false){
 if(hb)return O.planBundle(products.map((p,n)=>({item:{...p,tier:{price:n?10:1}},match:{state:states[n]}})),wishes,goal==='products'?'items':goal,include);
 const rows=products.map((p,n)=>({...p,sourceItemId:'product-'+n,availability:{regionAvailable:true}}));
 return O.planPurchase({kind:pool?'pick-mix':'standard',products:rows,groups:[{price:{USD:100},products:[rows[0]]},{price:{USD:1000},products:rows.slice(1)}],tiers:[{quantity:1,price:{USD:100}}]},states.map(state=>({state})),wishes,{goal,includeUncertain:include});
}
test('one wish has alternatives, its priority counts once, native duplicates cannot multiply it',()=>{
 const wish=item('Batman: Year One'),offers=[item(wish.title),item(wish.title)];const p=plan(offers,['new','new'],[wish,{...wish,sourceItemId:'alternate-id'}]);
 assert.equal(hb?p.goalCount:p.targetWishes,1);assert.equal(hb?p.lowest.price:p.recommended.price/100,1);
 assert.equal(hb?p.tiers[1].wishlistValue:p.plans[1].wishlistWeight,5);
 if(!hb)assert(O.planPurchase({kind:'pick-mix',products:offers.map((p,n)=>({...p,sourceItemId:'offer-'+n})),tiers:[{quantity:1,price:{USD:100}}]},[{state:'new'},{state:'new'}],[wish],{goal:'wishlist'}).recommended);
});
test('intentional edition-specific wishes remain separate',()=>{
 const wishes=[item('A story',{edition:'first'}),item('A story',{edition:'second'})],p=plan(wishes,['new','new'],wishes);
 assert.equal(hb?p.goalCount:p.targetWishes,2);assert.equal(hb?p.lowest.price:p.recommended.price/100,10);
});
test('Possible opt-in changes only ownership eligibility, never related-wish satisfaction or incomplete checks',()=>{
 const offers=[item('A story'),item('Other story')],wishes=offers;
 const normal=plan(offers,['possible','unchecked'],wishes),explicit=plan(offers,['possible','unchecked'],wishes,true);
 assert.equal(hb?normal.goalCount:normal.targetWishes,0);assert.equal(hb?explicit.goalCount:explicit.targetWishes,1);
 const related=plan([item('Algorithmic Thinking, 2nd Edition')],['possible'],[item('Algorithmic Thinking')],true);
 assert.equal(hb?related.goalCount:related.targetWishes,0);
});
