(async()=>{
  const checks=[],check=(condition,message)=>{if(!condition)throw Error(message);checks.push(message);};
  const wait=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('Importer did not update');};
  try{
    await wait(()=>document.querySelector('#hcl-importer output')?.textContent);
    const panel=document.querySelector('#hcl-importer'),profile=panel.querySelector('.library-import-profile'),footer=panel.querySelector('.library-import-footer'),quick=panel.querySelector('[data-import-mode="new"]'),full=panel.querySelector('[data-import-mode="all"]');
    check(panel.children.length===3&&profile.children.length===3,'importer groups description, three account controls and footer into three rows');
    check(getComputedStyle(profile).display==='grid'&&footer.contains(panel.querySelector('output'))&&footer.contains(quick),'account controls and scan status have dedicated layout containers');
    check(quick.textContent==='Import new purchases'&&full.textContent==='Rescan all purchases','import buttons use the shared labels');
    check(panel.querySelector('details').textContent.includes('does not sign you in'),'account nickname help explains local scope');
    const before=JSON.stringify(fixtureStored);quick.click();await wait(()=>panel.querySelector('output').textContent.startsWith('Import failed:'));
    check(JSON.stringify(fixtureStored)===before,'unconfirmed account cannot start import or replace ownership');
    window.confirm=()=>false;full.click();check(JSON.stringify(fixtureStored)===before,'cancelled full rescan leaves the active snapshot unchanged');
    const controls=[...profile.children];check(controls.every(label=>label.querySelector('input')),'each account control retains its visible associated label');
    await fetch('/test-result',{method:'POST',body:JSON.stringify({checks})});
  }catch(error){await fetch('/test-result',{method:'POST',body:JSON.stringify({checks,error:error.message})});}
})();
