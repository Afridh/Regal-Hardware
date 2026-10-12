// What moves, and — just as important — what does not. The till redraws on every keystroke,
// so this checks the motion layer stays out of the way while somebody is typing.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE='http://localhost:4000';
const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const b=await puppeteer.launch({executablePath:exe,headless:true,args:['--no-sandbox']});
const pg=await b.newPage(); await pg.setViewport({width:1400,height:900});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
let pass=0,fail=0; const ok=(c,w,x='')=>{c?(pass++,console.log('PASS '+w+(x?'  '+x:''))):(fail++,console.log('FAIL '+w+(x?'  '+x:'')))};

await pg.goto(BASE+'/pos',{waitUntil:'networkidle2'});
await pg.waitForSelector('#lockScreen');
if(await pg.$('#lockUser')) await pg.type('#lockUser','Afridh'); else await pg.click('[data-user="Afridh"]');
await pg.type('#lockPw','Afridh123'); await pg.click('#lockGo');
await pg.waitForFunction(()=>!document.getElementById('lockScreen'));
await new Promise(r=>setTimeout(r,800));

// a page arriving
const arrive=await pg.evaluate(()=>{ go('bills');
  const mn=document.getElementById('main');
  return { page:mn.classList.contains('mo-page'), rows:mn.querySelectorAll('.mo-in').length,
    maxDelay:Math.max(0,...[...mn.querySelectorAll('.mo-in')].map(e=>+getComputedStyle(e).animationDelay.replace('s',''))) };
});
ok(arrive.page&&arrive.rows>0,'a page and its rows arrive together',JSON.stringify({page:arrive.page,rows:arrive.rows}));
ok(arrive.maxDelay<=0.3,'the last row is in within a third of a second',arrive.maxDelay+'s');

// a redraw of the SAME page must not re-animate anything
// let the arrival finish, then redraw the same page: nothing should move or be left behind
await new Promise(r=>setTimeout(r,400));
const still=await pg.evaluate(()=>{ render();
  const mn=document.getElementById('main');
  return { page:mn.classList.contains('mo-page'), rows:mn.querySelectorAll('.mo-in').length };
});
ok(!still.page&&still.rows===0,'redrawing the same page moves nothing',JSON.stringify(still));

// the till: typing into the search must not set the rows going
await pg.evaluate(()=>{ go('pos'); S.pos.lines=[]; render() });
await new Promise(r=>setTimeout(r,300));
const typing=await pg.evaluate(async()=>{
  const q=document.querySelector('#csQ')||document.querySelector('input');
  let moved=0;
  for(const ch of 'cem'){ if(q){ q.value+=ch; q.dispatchEvent(new Event('input',{bubbles:true})) }
    await new Promise(r=>setTimeout(r,60));
    moved+=document.querySelectorAll('#main .mo-in').length; }
  return { moved, focused:document.activeElement&&document.activeElement.id };
});
ok(typing.moved===0,'searching at the till animates nothing under the fingers',JSON.stringify(typing));

// a line joining the bill says so, and the total answers
const added=await pg.evaluate(async()=>{
  S.pos.lines=[]; moLastLines=-1; render();
  await new Promise(r=>setTimeout(r,60));
  const p=S.products[0];
  S.pos.lines.push({pid:p.id,qty:2,price:p.retail,disc:0});
  render();
  await new Promise(r=>setTimeout(r,60));
  return { flash:!!document.querySelector('.mo-flash'), bump:!!document.querySelector('.mo-bump') };
});
ok(added.flash,'a line joining the bill shows where it landed');
ok(added.bump,'and the total answers it',JSON.stringify(added));

// a figure that changes counts to its new value; one that does not, does not move
const roll=await pg.evaluate(async()=>{
  go('dashboard'); await new Promise(r=>setTimeout(r,120));
  const el=document.querySelector('.stat .v, .kpi b'); if(!el) return {no:'nothing to roll'};
  const before=el.textContent;
  render(); await new Promise(r=>setTimeout(r,60));
  const unchanged=(document.querySelector('.stat .v, .kpi b')||{}).classList;
  const stayed=!(unchanged&&unchanged.contains('mo-roll'));
  // now make one actually change
  const keys=[...MO_ROLLS.keys()]; const k=keys[0];
  if(k) MO_ROLLS.set(k, MO_ROLLS.get(k)+1234);
  render(); await new Promise(r=>setTimeout(r,60));
  const now=document.querySelector('.stat .v, .kpi b');
  return { before, stayed, rolled:!!(now&&now.classList.contains('mo-roll')) };
});
ok(roll.stayed,'a figure that has not changed stays still',JSON.stringify({stayed:roll.stayed}));
ok(roll.rolled,'a figure that has changed counts to its new value',JSON.stringify({rolled:roll.rolled}));

// somebody who has asked for less movement gets none
const quiet=await pg.evaluate(async()=>{
  await pg_emulate();
  go('customers'); await new Promise(r=>setTimeout(r,120));
  return { rows:document.querySelectorAll('#main .mo-in').length };
}).catch(()=>null);

await pg.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
const reduced=await pg.evaluate(async()=>{
  go('suppliers'); await new Promise(r=>setTimeout(r,120));
  const any=[...document.querySelectorAll('#main .mo-in')].some(e=>getComputedStyle(e).animationName!=='none');
  S.pos.lines=[]; moLastLines=-1; render();
  S.pos.lines.push({pid:S.products[0].id,qty:1,price:100,disc:0}); render();
  return { animating:any, flash:!!document.querySelector('.mo-flash') };
});
ok(!reduced.animating&&!reduced.flash,'a machine asking for less movement gets none',JSON.stringify(reduced));
await pg.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'no-preference'}]);

ok(errs.length===0,'no script errors anywhere',errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
