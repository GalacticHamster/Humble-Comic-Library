// Offline presentation-change acceptance: compare shipped matching paths with a pre-polish commit.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {fixture} from './matching-fixture.mjs';
const root=new URL('../',import.meta.url),hb=fs.existsSync(new URL('ownership.js',root));
const baseline=process.argv[2];if(!baseline)throw Error('Pass a pre-polish git commit; synthetic responses only, no storage/network.');
const cache=new Map(),readSource=file=>{if(!cache.has(file))cache.set(file,execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8',windowsHide:true}));return cache.get(file);};
const unit=n=>({series:'Saga',run:'2020',language:'en',unitType:'issue',number:String(n),completeness:'full'});
const external=(ownership='owned',title='Offered collection',relationship='same-edition')=>({provider:'kindle',title,ownership,relationship,itemRef:'synthetic-ref',evidence:{authors:['Example Author']}});
const cases=[
 ['local owned','book',{title:'Offered collection'},[{title:'Offered collection'}],null],
 ['exact external','book',{title:'Offered collection'},[],{matches:[external()]}],
 ['new','book',{title:'Offered collection'},[],{matches:[]}],
 ['incomplete','book',{title:'Offered collection'},[],new Error('Synthetic unavailable')],
 ['30 Days multi-candidate','book',{title:'30 Days of Night Deluxe Edition: Book One'},[{title:'30 Days of Night',sourceBundle:'Anniversary collection'}],{matches:[external('subscription','30 Days of Night Deluxe Edition: Book One')],possibleMatches:[]}],
 ['related game edition','game',{title:'Space Adventure Deluxe Edition'},[{title:'Space Adventure',externalIds:{steamAppId:'42'}}],{matches:[],possibleMatches:[external('owned','Space Adventure Gold Edition','same-work')]}],
 ['software version','software',{title:'Paint App 3'},[{title:'Paint App 2'}],{matches:[],possibleMatches:[external('owned','Paint App 2','same-work')]}],
 ['partial contents','book',{title:'Saga #1-2',series:'Saga',run:'2020',language:'en',contents:[unit(1),unit(2)],contentsComplete:true},[],{matches:[],partialMatches:[external('owned','Saga Collection','contains')],coverage:{total:2,owned:1,complete:false,scopeUncertain:false,covered:[{...unit(1),evidence:[external('owned','Saga Collection','contains')]}],possibleCovered:[],missing:[unit(2)]}}],
 ...['subscription','borrowed','rental','unknown'].map(access=>[access,'book',{title:'Offered collection'},[],{matches:[external(access)]}]),
 ['ISBN conflict','book',{title:'Offered collection',isbn:['9780306406157']},[{title:'Offered collection',isbn:['9780140328721']}],{matches:[]}],
 ['historical','book',{title:'Offered collection'},[],{matches:[]},[{title:'Offered collection',sourceBundle:'Earlier bundle'}]]
];
for(const [name,media,offer,records,central,history=[]]of cases){
 const input=JSON.stringify([offer,records,central,history]);
 const before=fixture(records,media,offer,central,history,readSource),after=fixture(records,media,offer,central,history);
 const old=(await before.classify()).match,current=(await after.classify()).match;
 assert.equal(JSON.stringify(current),JSON.stringify(old),name+' changed authoritative result');
 if(hb)assert.equal(JSON.stringify(after.context.summary),JSON.stringify(before.context.summary),name+' changed counts/tier values');
 assert.equal(JSON.stringify([offer,records,central,history]),input,name+' changed supplied evidence');
 console.log('PASS unchanged matching/ownership/evidence: '+name+' ('+current.state+')');
}
console.log(cases.length+' identical authoritative results; supplied records/history unchanged.');
