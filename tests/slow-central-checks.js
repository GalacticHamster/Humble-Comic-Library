(async()=>{
  const checks=[],check=(condition,message)=>{if(!condition)throw Error(message);checks.push(message);};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const wait=async predicate=>{for(let n=0;n<750;n++){if(predicate())return;await pause(20);}throw Error('Slow central check did not finish');};
  const panel=()=>document.querySelector('#hcl-summary');
  try{
    await wait(()=>panel()&&!document.querySelector('#hcl-progress'));
    check(Boolean(panel().querySelector('.hcl-galactic-pending')),'local summary renders immediately while Galactic Library is pending');
    await wait(()=>panel()&&!panel().querySelector('.hcl-galactic-pending'));
    check(!document.querySelector('.hcl-status-button[data-state="unchecked"]'),'a valid 4.5-second lookup completes instead of turning every unmatched title into Not checked');
    check(document.querySelectorAll('.hcl-status-button[data-state="partial"]').length===2&&document.querySelectorAll('.hcl-status-button[data-state="possible"]').length===1,'slow responses preserve Partial contents and Possible editions');
    check(panel().classList.contains('hcl-summary-minimized')&&panel().dataset.position==='top-left','slow initial lookup preserves the saved summary size and corner');
    const ready=panel();window.fixtureCentralDelayMs=0;window.fixtureCentralFailure=true;
    await chrome.storage.local.set({galacticLibraryExtensionId:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'});
    await wait(()=>panel()!==ready&&!document.querySelector('#hcl-progress'));
    check(document.querySelectorAll('.hcl-status-button[data-state="unchecked"]').length===3,'an actual failed lookup retains local Partial evidence and reports the remaining unchecked titles');
    const failed=panel(),retry=failed.querySelector('.hcl-retry-galactic');
    check(Boolean(retry),'failed checks offer an explicit retry');
    window.fixtureCentralFailure=false;window.fixtureCentralDelayMs=4500;
    retry.click();retry.click();await pause(150);
    check(panel()===failed&&retry.disabled&&failed.getAttribute('aria-busy')==='true','retry retains the settled panel and prevents duplicate clicks');
    await wait(()=>panel()&&panel().getAttribute('aria-busy')!=='true'&&!panel().querySelector('.hcl-galactic-pending'));
    check(!document.querySelector('.hcl-status-button[data-state="unchecked"]')&&!panel().querySelector('.hcl-retry-galactic'),'a successful slow retry clears stale errors and Not checked results');
    const recovered=panel(),requests=fixtureCalls.length;await pause(500);
    check(panel()===recovered&&fixtureCalls.length===requests&&recovered.classList.contains('hcl-summary-minimized'),'recovery settles without another refresh loop or a size reset');
    await fetch('/test-result',{method:'POST',body:JSON.stringify({checks})});
  }catch(error){await fetch('/test-result',{method:'POST',body:JSON.stringify({checks,error:error.message})});}
})();
