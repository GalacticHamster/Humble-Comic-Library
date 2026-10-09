import test from 'node:test';
import assert from 'node:assert/strict';
import {bundleFixture} from './matching-fixture.mjs';
const original='Beneath the Trees Where Nobody Sees',sequel=original+': Rite of Spring';
const offer=title=>({title,kind:'book',mediaType:'book'});
const record=(title,extra={})=>({title,provider:'kindle',itemRef:title,ownership:'subscription',relationship:'same-work',reason:'Related title or edition; compare the owned and offered titles.',...extra});
test('owned original probes are context only; provider duplicate can be deferred without title-based identity',async()=>{
 const exact=record(original,{relationship:'same-edition',reason:'Matching full book title with no conflicting identity evidence'});
 const weak={...exact,relationship:'same-work',reason:'Related title or edition; compare the owned and offered titles.'};
 const issue=record(sequel+' #1',{reason:'Numbered series item related to this title; collection membership and completeness are unconfirmed.'});
 const f=bundleFixture([offer(original),offer(sequel)],[{title:original,sourceBundle:'Synthetic',bundle:{title:'Synthetic'}}],{[original]:{matches:[exact]},[sequel]:{possibleMatches:[weak,issue]}},{emulateStorefront:true,identityContext:true});
 const rows=await f.classify(),before=JSON.stringify(rows),summary=JSON.stringify(f.P.summary(rows));
 assert.equal(rows[0].match.state,'owned');assert(!(rows[0].match.externalResult?.matches||[]).length);
 assert.equal(f.P.reconcileBundle(rows,{complete:true}).deferredCount,2); // local + GL original
 assert.deepEqual(Array.from(f.P.primaryCandidateViews(rows[1].item,rows[1].match),v=>v.title),[issue.title]);
 assert.match(f.P.explanation(rows[1].item,rows[1].match),/membership.*unconfirmed/);
 assert.equal(JSON.stringify(rows),before);assert.equal(JSON.stringify(f.P.summary(rows)),summary);
 const key=f.P.candidateViews(rows[1].item,rows[1].match).find(v=>v.title===issue.title);assert.equal(key.heading,'Related numbered item');assert.equal(key.access,'Subscription access');
});
test('failed context leaves local Owned and all related evidence available',async()=>{
 const f=bundleFixture([offer(original),offer(sequel)],[{title:original,sourceBundle:'Synthetic',bundle:{title:'Synthetic'}}],{[original]:new Error('Synthetic unavailable'),[sequel]:{possibleMatches:[record(original)]}},{emulateStorefront:true,identityContext:true});
 const rows=await f.classify();assert.equal(rows[0].match.state,'owned');assert.equal(f.P.reconcileBundle(rows,{complete:true}).deferredCount,0);
 assert(f.P.primaryCandidateViews(rows[1].item,rows[1].match).length);
});
test('generic unnumbered purchases explain each offered book independently, with no first-volume assignment',async()=>{
 const titles=['One','Two','Three'].map(n=>'30 Days of Night Deluxe Edition: Book '+n),f=bundleFixture(titles.map(offer),[{title:'30 Days of Night',sourceBundle:'Synthetic',bundle:{title:'Synthetic'}}]);
 const rows=await f.classify();f.P.reconcileBundle(rows,{complete:true});
 for(const [i,row]of rows.entries()){
  assert.equal(row.match.state,'possible');const generic=f.P.primaryCandidateViews(row.item,row.match).find(v=>v.title==='30 Days of Night');
  assert.equal(generic.heading,'Related unnumbered title');assert(generic.uncertainty.includes('Book '+['One','Two','Three'][i]));assert.match(generic.uncertainty,/overlap is unconfirmed/);
 }
});
test('reviewed contents rank ahead of generic similarity while independent claims survive',()=>{
 const f=bundleFixture([offer(sequel)]),item=offer(sequel),contents=record('A reviewed collection',{relationship:'contains',ownership:'owned',reason:'Reviewed contents coverage.'}),weak=record(original),issue=record(sequel+' #1');
 const match={state:'partial',externalPossibleMatches:[weak,issue],externalResult:{partialMatches:[contents]}},before=JSON.stringify(match);
 const views=f.P.primaryCandidateViews(item,match);assert.equal(views[0].title,contents.title);assert.equal(views[1].title,issue.title);assert.equal(views.length,3);assert.equal(JSON.stringify(match),before);
});
test('display numbering is strict, recognizes words/Romans, and never parses narrative numbers as a volume',()=>{
 const f=bundleFixture([offer(original)]),B=f.context.BundleMatchContext;
 for(const [title,number]of [['A: Book One','1'],['A Book III','3'],['A Vol. 2','2'],['A #1/2','1/2'],['A Annual 1','1'],['A Special 2','2']])assert.equal(B.numberedScope(title).number,number);
 for(const title of ['4001 AD','30 Days of Night','Room Two','A Book One: New Story','A #1-3'])assert.equal(B.numberedScope(title),null);
 assert.equal(B.relevance({offeredTitle:sequel,title:sequel+' #2: A synthetic issue subtitle',media:'book',basis:'Numbered series item related to this title; collection membership and completeness are unconfirmed.'}),'numbered-series');
});
