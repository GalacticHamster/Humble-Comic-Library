import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, resolve, isAbsolute, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const git=process.env.GIT_BIN||'git';
const approved={name:'Galactic Hamster',email:'gh@galactichamster.com'};
const clean={...process.env,GIT_OPTIONAL_LOCKS:'0'};
for(const key of Object.keys(clean))if(/^GIT_(?:AUTHOR_|COMMITTER_|CONFIG_(?:COUNT|KEY_|VALUE_|PARAMETERS))/u.test(key)||key==='EMAIL')delete clean[key];
if(isAbsolute(git))clean.PATH=dirname(git)+delimiter+(clean.PATH||'');
const run=(args,extra={})=>spawnSync(git,args,{cwd:root,env:{...clean,...extra},encoding:'utf8',windowsHide:true});
const required=args=>{const r=run(args);assert.equal(r.status,0,r.stderr||r.error?.message);return r.stdout.trim();};
assert.equal(required(['config','--local','--get','core.hooksPath']),'.githooks','Install the version-controlled hooks before running this test.');
const gitdir=resolve(root,required(['rev-parse','--git-dir']));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const initial={config:hash(resolve(gitdir,'config')),index:hash(resolve(gitdir,'index')),head:required(['rev-parse','HEAD']),refs:required(['for-each-ref','--format=%(refname) %(objectname)'])};
const version=required(['--version']);
const numbers=/git version (\d+)\.(\d+)/u.exec(version);
assert(numbers,'Unrecognized Git version.');
const native=Number(numbers[1])>2||Number(numbers[1])===2&&Number(numbers[2])>=36;
const transport=native?['hook','run','pre-commit']:['-c','alias.project-identity-hook-test=!.githooks/pre-commit','project-identity-hook-test'];
console.log(version+'; '+(native?'Git hook runner':'Git shell-alias transport for legacy Git'));
let checks=0;
const goodAuthor={GIT_AUTHOR_NAME:approved.name,GIT_AUTHOR_EMAIL:approved.email};
const goodCommitter={GIT_COMMITTER_NAME:approved.name,GIT_COMMITTER_EMAIL:approved.email};
function check(name,{config=approved,env={},ok=false,role}={}){
  const r=run(['-c','user.name='+config.name,'-c','user.email='+config.email,...transport],env);
  assert(!r.error,r.error?.message);
  if(ok)assert.equal(r.status,0,r.stderr);
  else{
    assert.notEqual(r.status,0,'Wrong identity unexpectedly accepted.');
    assert.match(r.stderr,new RegExp('effective Git '+role,'u'));
    assert(r.stderr.includes('git config --local user.name "Galactic Hamster"'));
    assert(r.stderr.includes('git config --local user.email "gh@galactichamster.com"'));
    assert(r.stderr.includes('GIT_AUTHOR_NAME')&&r.stderr.includes('GIT_COMMITTER_EMAIL'));
  }
  checks++;console.log('PASS '+name);
}
const wrong={name:'Unapproved Identity',email:'unapproved@example.invalid'};
check('correct configured author and committer',{ok:true});
check('incorrect configured author, correct committer override',{config:wrong,env:goodCommitter,role:'author'});
check('incorrect configured committer, correct author override',{config:wrong,env:goodAuthor,role:'committer'});
check('incorrect author environment name',{env:{GIT_AUTHOR_NAME:wrong.name},role:'author'});
check('incorrect author environment email',{env:{GIT_AUTHOR_EMAIL:wrong.email},role:'author'});
check('incorrect committer environment name',{env:{GIT_COMMITTER_NAME:wrong.name},role:'committer'});
check('incorrect committer environment email',{env:{GIT_COMMITTER_EMAIL:wrong.email},role:'committer'});
check('correct environment identities override incorrect configuration',{config:wrong,env:{...goodAuthor,...goodCommitter},ok:true});
check('both incorrect roles receive clear diagnostics',{env:{GIT_AUTHOR_NAME:wrong.name,GIT_COMMITTER_EMAIL:wrong.email},role:'author'});
const both=run(['-c','user.name='+approved.name,'-c','user.email='+approved.email,...transport],{GIT_AUTHOR_NAME:wrong.name,GIT_COMMITTER_EMAIL:wrong.email});
assert.match(both.stderr,/effective Git author/u);assert.match(both.stderr,/effective Git committer/u);
assert.equal(hash(resolve(gitdir,'config')),initial.config,'Hook tests changed local configuration.');
assert.equal(hash(resolve(gitdir,'index')),initial.index,'Hook tests changed the index.');
assert.equal(required(['rev-parse','HEAD']),initial.head,'Hook tests created a commit.');
assert.equal(required(['for-each-ref','--format=%(refname) %(objectname)']),initial.refs,'Hook tests changed refs.');
console.log(`${checks} identity cases passed; configuration, index, HEAD and refs unchanged.`);
