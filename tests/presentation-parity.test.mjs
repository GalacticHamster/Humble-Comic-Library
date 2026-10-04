import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url), hb=fs.existsSync(new URL('ownership.js',root));
const ctx={URL};ctx.globalThis=ctx;vm.createContext(ctx);
for(const name of hb?['shared.js','collection-mappings.js','ownership.js']:['src/shared.js','src/planning.js'])vm.runInContext(fs.readFileSync(new URL(name,root),'utf8'),ctx);
const P=(hb?ctx.HumbleOwnership:ctx.FanaticalLibrary).presentation;
const fixtures=JSON.parse(fs.readFileSync(new URL('presentation-fixtures.json',import.meta.url),'utf8'));
for(const fixture of fixtures)test('presentation parity: '+fixture.name,()=>{
 const model=P.summary(fixture.rows),states=['owned','owned-elsewhere','new','partial','possible','unchecked'];
 assert.equal(Object.values(model.counts).reduce((a,b)=>a+b,0),fixture.rows.length);
 assert.deepEqual(Array.from(model.sections),states.filter(state=>fixture.rows.some(row=>row.match.state===state)));
 for(let i=0;i<fixture.rows.length;i++){
  const row=model.items[i],state=fixture.rows[i].match.state;
  assert.equal(row.why,['possible','partial','unchecked'].includes(state));
  if(state==='owned-elsewhere')assert.deepEqual(Array.from(row.providers),['Steam']);
  if(state==='partial')assert.equal(row.fraction,'7/10 owned');
  if(state==='possible')assert.equal(row.relatedTitle,'Related title');
  assert(!/normalized|same-edition|identifiers|checked unknown/u.test(P.explanation(fixture.rows[i].item,fixture.rows[i].match)));
 }
});
