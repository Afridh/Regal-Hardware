// Paying a supplier the way the shop's desk diary works: a total, cut into cheques under the
// ceiling, each on a day that can actually take it.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE='http://localhost:4000';
const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const b=await puppeteer.launch({executablePath:exe,headless:true,args:['--no-sandbox']});
const pg=await b.newPage(); await pg.setViewport({width:1500,height:1000});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
let pass=0,fail=0; const ok=(c,w,x='')=>{c?(pass++,console.log('PASS '+w+(x?'  '+x:''))):(fail++,console.log('FAIL '+w+(x?'  '+x:'')))};

await pg.goto(BASE+'/pos',{waitUntil:'networkidle2'});
await pg.waitForSelector('#lockScreen');
if(await pg.$('#lockUser')) await pg.type('#lockUser','Afridh'); else await pg.click('[data-user="Afridh"]');
await pg.type('#lockPw','Afridh123'); await pg.click('#lockGo');
await pg.waitForFunction(()=>!document.getElementById('lockScreen'));
await new Promise(r=>setTimeout(r,800));

await pg.evaluate(()=>{ S.cheques=(S.cheques||[]).filter(c=>c.dir!=='ISSUED'); CFG.plan={...PLAN_DEF}; });

// 800,000 becomes eight cheques of 100,000, which is the shop's own system
const cut=await pg.evaluate(()=>{
  const out=planChequesOnDays(800000, D(today));
  return { n:out.length, each:[...new Set(out.map(x=>x.amount))], total:out.reduce((a,x)=>a+x.amount,0),
    days:out.map(x=>x.date), gaps:out.slice(1).map((x,i)=>Math.round((new Date(x.date)-new Date(out[i].date))/864e5)) };
});
ok(cut.n===8&&cut.each.length===1&&cut.each[0]===100000,'800,000 becomes eight cheques of 100,000',JSON.stringify({n:cut.n,each:cut.each}));
ok(Math.abs(cut.total-800000)<0.005,'and they add back up to the whole of it',String(cut.total));
ok(new Set(cut.days).size===8,'every one on a day of its own',JSON.stringify(cut.days));
ok(cut.gaps.every(g=>g>=7),'a week apart or more',JSON.stringify(cut.gaps));

// and an amount that does not divide evenly keeps the round cheques, with the rest on the last
const odd=await pg.evaluate(()=>{
  const full=planCheques(228800, D(today), {style:'full'}).map(x=>x.amount);
  const even=planCheques(228800, D(today), {style:'even'}).map(x=>x.amount);
  return { full, even, fullAdds:full.reduce((a,x)=>a+x,0), evenAdds:even.reduce((a,x)=>a+x,0) };
});
ok(odd.full.length===3&&odd.full[0]===100000&&odd.full[1]===100000&&odd.full[2]===28800,
   '228,800 becomes 100,000 + 100,000 + 28,800, the way the shop writes them',JSON.stringify(odd.full));
ok(Math.abs(odd.fullAdds-228800)<0.005&&Math.abs(odd.evenAdds-228800)<0.005,
   'and either way it adds back up',JSON.stringify({full:odd.fullAdds,even:odd.evenAdds}));
ok(odd.even.length===3&&new Set(odd.even).size<=2,'spread evenly is still there for a shop that wants it',JSON.stringify(odd.even));

// a day that is full, a Sunday and a holiday are all stepped over
const stepped=await pg.evaluate(()=>{
  CFG.plan.dayMax=150000;
  const d1=addDays(D(today),7);
  // fill that day right up
  S.cheques.push({dir:'ISSUED',no:'T1',bankId:1,bank:'HNB',date:d1,payee:'X',amount:150000,status:'ISSUED',party:'X'});
  const sun=(()=>{ let x=D(today); for(let i=0;i<8;i++){ if(diaryIsSunday(x)) return x; x=addDays(x,1) } return null })();
  S.shift.holidays=(S.shift.holidays||[]).concat([{date:addDays(D(today),14),name:'Poya'}]);
  const out=planChequesOnDays(500000, D(today));
  return { days:out.map(x=>x.date), full:d1, sun, hol:addDays(D(today),14),
    onFull:out.some(x=>x.date===d1), onSun:out.some(x=>diaryIsSunday(x.date)),
    onHol:out.some(x=>!!holidayOf(x.date)) };
});
ok(!stepped.onFull,'a day already at its ceiling is stepped over',stepped.full);
ok(!stepped.onSun,'and a Sunday');
ok(!stepped.onHol,'and a holiday',stepped.hol);

// what a day already carries, said in words
const says=await pg.evaluate(()=>{
  const d1=addDays(D(today),7);
  return { full:diarySays(d1,0), sun:diarySays((()=>{let x=D(today);for(let i=0;i<8;i++){if(diaryIsSunday(x))return x;x=addDays(x,1)}})(),0),
    empty:diarySays((()=>{ let x=addDays(D(today),200); for(let i=0;i<40;i++){ if(diaryWeight(x)==='free') return x; x=addDays(x,1) } return x })(),0), weight:diaryWeight(d1) };
});
ok(/1 cheque/.test(says.full)&&says.weight==='full','a loaded day says how much is on it',JSON.stringify({full:says.full,weight:says.weight}));
ok(/Sunday/.test(says.sun)&&/nothing on that day/.test(says.empty),'a Sunday and an empty day say so',JSON.stringify(says));

// the finger running down the page
const next=await pg.evaluate(()=>{
  const d1=addDays(D(today),7);
  const got=diaryNextFree(d1,null,100000);
  return { from:d1, got, isLater:got>d1, free:diaryWeight(got) };
});
ok(next.isLater&&['free','some'].includes(next.free),'the next free day skips past the full one',JSON.stringify(next));

// the diary itself draws, and reads like the book: who, the number, the amount
const page=await pg.evaluate(()=>{
  go('purchasing'); purchTab='diary'; render();
  const mn=document.getElementById('main');
  return { cells:mn.querySelectorAll('td.dy').length, entries:mn.querySelectorAll('.dy-c').length,
    shut:mn.querySelectorAll('td.dy.shut').length, full:mn.querySelectorAll('td.dy.full').length,
    hasAmount:/Rs /.test((mn.querySelector('.dy-c')||{}).textContent||'') };
});
ok(page.cells===70,'ten weeks, day by day',String(page.cells));
ok(page.entries>0&&page.hasAmount,'each cheque on its day with who it is to and what it is for',JSON.stringify(page));
ok(page.shut>0,'Sundays and holidays are marked shut',String(page.shut));

// the payment window says what the chosen day carries
const win=await pg.evaluate(()=>{
  // the ceiling is dropped for this check so whatever is owed is more than one cheque's worth,
  // rather than the check depending on how much the demo books happen to owe by now
  const s=S.suppliers.sort((a,b)=>partyBal('S',b.id)-partyBal('S',a.id))[0];
  const owed=partyBal('S',s.id);
  CFG.plan.chequeMax=Math.max(1000,Math.floor(owed/3/1000)*1000);
  supPayModal(s.id);
  const box=document.querySelector('.modal .box');
  box.querySelector('#spGo').click();      // the day buttons live on the second stage
  const html=box.innerHTML;
  const out={ dates:box.querySelectorAll('[data-day]').length,
    tags:box.querySelectorAll('.sp-day').length,
    nextFree:box.querySelectorAll('[data-day]').length,
    saysSomething:/cheque|Sunday|nothing on that day/.test(html) };
  closeModals();
  return out;
});
ok(win.nextFree>0&&win.saysSomething,'the payment window says what each day already carries, with a way past it',JSON.stringify(win));

// ---- paying a supplier, the way the shop does it: the bills, then how it is paid ----
const flow=await pg.evaluate(()=>{
  S.cheques=(S.cheques||[]).filter(c=>c.dir!=='ISSUED'); CFG.plan={...PLAN_DEF};
  // the ceiling is dropped for this one so whatever is owed is more than a single cheque's worth,
  // rather than the check depending on how much the demo books happen to owe by the time it runs
  const s=S.suppliers.slice().sort((a,b)=>partyBal('S',b.id)-partyBal('S',a.id))[0];
  const owed=partyBal('S',s.id);
  CFG.plan.chequeMax=Math.max(1000,Math.floor(owed/3/1000)*1000);
  supPayModal(s.id);
  const box=document.querySelector('.modal .box');
  const one={ step:(box.querySelector('.sp-steps .on')||{}).textContent||'',
    bills:box.querySelectorAll('[data-sbill]').length,
    check:box.querySelectorAll('[data-sadj]').length,
    noLines:box.querySelectorAll('[data-k="method"]').length };
  box.querySelector('#spGo').click();
  const two={ step:(box.querySelector('.sp-steps .on')||{}).textContent||'',
    lines:box.querySelectorAll('[data-k="method"]').length,
    dayBtns:box.querySelectorAll('[data-day]').length,
    back:!!box.querySelector('#spBack2') };
  box.querySelector('#spSplit').click();
  const cut={ lines:box.querySelectorAll('[data-k="method"]').length,
    amounts:[...box.querySelectorAll('[data-k="amount"]')].map(i=>+i.value),
    tot:(box.querySelector('#spTot')||{}).textContent||'' };
  box.querySelector('#spBack2').click();
  const backTo=(box.querySelector('.sp-steps .on')||{}).textContent||'';
  const cap=CFG.plan.chequeMax;
  closeModals(); CFG.plan={...PLAN_DEF};
  return { one, two, cut, backTo, owed, cap };
});
ok(/The bills/.test(flow.one.step)&&flow.one.bills>0&&flow.one.check>0&&flow.one.noLines===0,
   'it opens on the bills, with a way to check each one and no cheques in sight',JSON.stringify(flow.one));
ok(/How it is paid/.test(flow.two.step)&&flow.two.lines===1&&flow.two.dayBtns===1&&flow.two.back,
   'going on gives one line for the whole of it, its day on a button',JSON.stringify(flow.two));
ok(flow.cut.lines>1&&/of /.test(flow.cut.tot),'cutting it up gives a line each, and says how much of the total is covered',JSON.stringify(flow.cut));
ok(/The bills/.test(flow.backTo),'and you can go back to the bills',flow.backTo);

// ---- the calendar: the recommendation, the full days, the shut ones ----
const cal=await pg.evaluate(()=>{
  const d=D(today), at=(n,amt)=>{ const t=new Date(d+'T00:00:00'); t.setDate(t.getDate()+n);
    S.cheques.push({dir:'ISSUED',no:'C'+n,bankId:1,bank:'HNB',date:D(t),payee:'Z',amount:amt,status:'ISSUED',party:'Z'}) };
  at(0,600000); at(1,600000);
  let got=null; diaryPickModal(d,100000,(ds)=>{got=ds});
  const box=document.querySelector('.modal .box');
  const best=[...box.querySelectorAll('td.best')].map(t=>t.querySelector('b').textContent);
  const out={ best, btn:box.querySelector('#dpBest').textContent.trim(),
    full:[...box.querySelectorAll('td.full')].map(t=>t.querySelector('b').textContent),
    shutClickable:[...box.querySelectorAll('td.shut')].filter(t=>t.hasAttribute('data-dp')).length,
    expect:diaryNextFree(d,null,100000) };
  const pick=box.querySelector('td[data-dp]'); if(pick) pick.click();
  out.picked=got; closeModals(); return out;
});
ok(cal.best.length===1&&cal.btn.includes(cal.expect),'the calendar marks one recommended day and offers it',JSON.stringify({best:cal.best,btn:cal.btn}));
ok(cal.full.length===2,'the days already at the ceiling are marked',JSON.stringify(cal.full));
ok(cal.shutClickable===0,'a Sunday or a holiday cannot be picked',String(cal.shutClickable));
ok(!!cal.picked,'clicking a day hands it back',String(cal.picked));

ok(errs.length===0,'no script errors',errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
