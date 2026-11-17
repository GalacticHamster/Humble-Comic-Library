(async()=>{
  const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const wait=async predicate=>{for(let i=0;i<300;i++){if(predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('Initial bundle did not settle');};
  let error;
  try{
    await wait(()=>document.querySelector('#hcl-summary')&&!document.querySelector('#hcl-progress'));
    const originalCollect=collectBundleItems,originalSend=chrome.runtime.sendMessage;
    const before=JSON.stringify(fixtureStored);
    const card=document.createElement('article');card.className='product';card.innerHTML='<img class="item-image" alt="Test title"><h3>Test title</h3>';document.body.append(card);
    const image=card.querySelector('img');
    async function classify(kind,title,records,send){
      const item={title,lookupTitle:title,kind,element:image,container:card,tier:{label:'$5 tier',price:5}};
      image.alt=title;card.querySelector('h3').textContent=title;
      collectBundleItems=()=>[item];chrome.runtime.sendMessage=send;
      const comparison={job:1,galactic:createGalacticLookup('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')};
      await renderBundleComparison(createBundleLibraryMatcher(records,kind),kind,[],[],comparison,1);
      return comparison.resolvedItems[0].match;
    }
    try{
      for(const kind of ['software','book','game','audiobook']){
        const calls=[];
        const match=await classify(kind,'Unmatched item',[],async(_id,r)=>{calls.push(r.type);throw Error('Could not establish connection. Receiving end does not exist.');});
        check(match.state==='new'&&calls.join(',')==='PING',kind+': absent GL leaves final local New, without a capability request');
      }
      for(const state of ['unlinked','revoked','unsupported','success','failed','capability-failed']){
        const calls=[];
        const match=await classify('software','Software item',[],async(_id,r)=>{
          calls.push(r.type);
          if(r.type==='PING')return state==='unlinked'?{ok:false,error:'This extension is not allowed to use the Galactic Library API.'}:{ok:true,apiVersion:1};
          if(r.type==='GET_STATUS'){
            if(state==='revoked')return {ok:false,error:'This extension is not allowed to use the Galactic Library API.'};
            if(state==='capability-failed')throw Error('Transport interrupted');
            return {ok:true,apiVersion:1,capabilities:{mediaTypes:state==='unsupported'?['book']:['software']}};
          }
          if(state==='failed')throw Error('Participating lookup failed');
          return {ok:true,apiVersion:1,results:r.items.map(item=>({requestId:item.requestId,matches:[{provider:'fanatical',title:item.title,ownership:'owned',relationship:'same-edition'}],possibleMatches:[],partialMatches:[]}))};
        });
        check(match.state===(state==='success'?'elsewhere':['failed','capability-failed'].includes(state)?'unchecked':'new'),'software '+state+': correct final badge classification');
        if(['unlinked','revoked','unsupported','capability-failed'].includes(state))check(!calls.includes('MATCH_ITEMS'),state+': no unsupported ownership request');
      }
      const noGL=async()=>{throw Error('Could not establish connection. Receiving end does not exist.');};
      for(const [title,stored]of [['F.E.A.R. 2','FEAR 2'],['FEAR 2','F.E.A.R. 2']]){
        const match=await classify('game',title,[{title:stored,kind:'game',purchaseKey:'original-copy'}],noGL);
        check(match.state==='owned'&&match.item.title===stored,'dotted acronym: correct purchased candidate '+title);
        check(card.classList.contains('hcl-owned-item'),'dotted acronym: actual card has Owned styling');
        check(matchProvenance(match).includes(stored),'dotted acronym: explanation retains stored spelling');
      }
      for(const title of ['FEAR 3','FEAR 2 Remastered','FEAR 2 Gold Edition','FEAR Collection']){
        const match=await classify('game','F.E.A.R. 2',[{title,kind:'game'}],noGL);
        check(match.state!=='owned','dotted acronym: preserves '+title+' distinction');
      }
      check(JSON.stringify(fixtureStored)===before,'comparison leaves purchases, corrections and saved preferences unchanged');
    }finally{collectBundleItems=originalCollect;chrome.runtime.sendMessage=originalSend;card.remove();}
  }catch(failure){error=failure.stack||failure.message;}
  await fetch('/test-result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({checks,...(error?{error}:{})})});
})();
