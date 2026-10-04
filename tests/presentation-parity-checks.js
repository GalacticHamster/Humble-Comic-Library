async function runPanelPresentationChecks(hb,check) {
  const prefix=hb?'hcl':'fanatical-library',panel=document.querySelector('.'+prefix+'-summary');
  const style=document.createElement('style');
  // Simulate hostile storefront resets and a different root rem size.
  style.textContent='html{font-size:27px} body aside p,body aside details,body aside summary,body aside li,body aside button,body aside input,body aside select{font:900 23px/40px serif!important;color:orange!important;background:white;border-top:3px solid white} body aside summary::before{content:"---"}';
  document.head.append(style);
  const css=node=>getComputedStyle(node);
  const typography=node=>{const s=css(node);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight].join('|');};
  try{
    check(typography(panel)==='Arial, sans-serif|14px|400|21px','Common panel uses explicit 14px/21px regular Arial independent of host rem size');
    check(typography([...panel.children].find(node=>node.tagName==='STRONG'))==='Arial, sans-serif|16px|700|24px','Bundle ownership heading uses canonical 16px bold typography');
    check(typography(panel.querySelector('.'+prefix+'-summary-counts'))==='Arial, sans-serif|14px|700|21px','Simple counts use canonical bold body typography');
    check(typography(panel.querySelector('.'+prefix+'-legend span'))==='Arial, sans-serif|12px|700|18px','Legend uses canonical compact typography');
    const advanced=panel.querySelector('.'+prefix+'-advanced');
    check(typography(advanced.querySelector('summary'))==='Arial, sans-serif|14px|700|21px'&&css(advanced.querySelector('summary')).display==='list-item','Advanced disclosures retain canonical typography and native arrows under host resets');
    check([...advanced.querySelectorAll('details')].every(node=>css(node).borderTopWidth==='0px'),'Ordinary Advanced sections have no horizontal divider');
    const body=advanced.querySelector('p');
    check(body&&typography(body)==='Arial, sans-serif|14px|400|21px'&&css(body).color==='rgb(242, 242, 242)'&&css(body).backgroundColor==='rgba(0, 0, 0, 0)','Explanatory body copy is regular readable body text, without warning accent');
    const muted=panel.querySelector('.library-ui-muted');
    check(muted&&css(muted).color==='rgb(197, 203, 211)','Secondary GL information uses the common readable muted color');
    const attention=document.createElement('p');attention.className='library-ui-warning';attention.textContent='Needs review: test';advanced.append(attention);
    check(css(attention).color==='rgb(244, 204, 115)','Explicit warnings use the common attention color');attention.remove();
    const control=advanced.querySelector('select'),button=advanced.querySelector('button'),checkbox=advanced.querySelector('input[type="checkbox"]');
    // Chrome's native select reports "normal" line-height despite the CSS
    // declaration. Keep its native arrow and check the typography it exposes.
    check(control&&button&&typography(control).split('|').slice(0,3).join('|')==='Arial, sans-serif|14px|400'&&typography(button)==='Arial, sans-serif|14px|400|21px'&&css(button).backgroundColor==='rgb(51, 51, 51)','Planning buttons and selectors share protected typography and dark control styling');
    check(checkbox&&css(checkbox).width==='14px'&&css(checkbox).height==='14px','Planning checkboxes have the same canonical dimensions');
    const planner=panel.querySelector('.library-ui-planning');
    const wasAdvancedOpen=advanced.open,wasPlannerOpen=planner.open;advanced.open=true;planner.open=true;
    check(Math.abs(parseFloat(css(control).width)-parseFloat(css(planner).width))<2,'Both planners use the same full-width goal selector');
    advanced.open=wasAdvancedOpen;planner.open=wasPlannerOpen;
    const list=panel.querySelector('ul');
    check(list&&css(list).paddingLeft==='20px'&&typography(list.querySelector('li'))==='Arial, sans-serif|14px|400|21px','Tier and item lists share protected typography and 20px indentation');
    const luminance=color=>{const channels=color.match(/\d+/g).slice(0,3).map(v=>Number(v)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
    const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    check(['rgb(242, 242, 242)','rgb(197, 203, 211)','rgb(244, 204, 115)'].every(color=>contrast(color,css(panel).backgroundColor)>=4.5),'Body, muted and warning text exceed 4.5:1 contrast on the common dark panel');
    check([...panel.querySelectorAll('.'+prefix+'-legend span')].every(chip=>contrast(css(chip).color,css(chip).backgroundColor)>=4.5),'All summary status legend labels exceed 4.5:1 text contrast');
  }finally{style.remove();}
}
