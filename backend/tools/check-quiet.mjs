// The quiet screen: five taps on Dashboard, and a share or an amount.
//
// The thing that matters most here is not what it shows but what it keeps: the real bills must
// come back whole, and nothing may ever be saved while the screen is quiet.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE='http://localhost:4000';
const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const b=await puppeteer.launch({executablePath:exe,headless:true,args:['--no-sandbox']});
const pg=await b.newPage(); await pg.setViewport({width:1400,height:950});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
let pass=0,fail=0; const ok=(c,w,x='')=>{c?(pass++,console.log('PASS '+w+(x?'  '+x:''))):(fail++,console.log('FAIL '+w+(x?'  '+x:'')))};

await pg.goto(BASE+'/pos',{waitUntil:'networkidle2'});
await pg.waitForSelector('#lockScreen');
if(await pg.$('#lockUser')) await pg.type('#lockUser','Afridh'); else await pg.click('[data-user="Afridh"]');
await pg.type('#lockPw','Afridh123'); await pg.click('#lockGo');
await pg.waitForFunction(()=>!document.getElementById('lockScreen'));
await new Promise(r=>setTimeout(r,900));

const set=(o)=>pg.evaluate((o)=>{ CFG.privacy={...(CFG.privacy||{}),...o} },o);
const real=await pg.evaluate(()=>({ sales:S.sales.length, took:S.sales.reduce((a,s)=>a+(+s.total||0),0),
  journal:S.journal.length, on:!!window.privacyOn }));
ok(real.sales>0&&!real.on,'the shop starts with its real figures',`${real.sales} bills`);

/* ---- five taps, and only five ---- */
await set({on:true,mode:'pct',pct:35,hideCredit:false,minutes:0});
const four=await pg.evaluate(()=>{ for(let i=0;i<4;i++) go('dashboard'); return !!window.privacyOn });
ok(!four,'four presses do nothing');
const five=await pg.evaluate(()=>{ go('dashboard'); return { on:!!window.privacyOn, sales:S.sales.length } });
ok(five.on,'the fifth turns the screen quiet');
ok(five.sales<real.sales&&five.sales>0,'and it shows some of the bills, not all and not none',
   `${real.sales} → ${five.sales}`);

const back=await pg.evaluate(()=>{ for(let i=0;i<5;i++) go('dashboard');
  return { on:!!window.privacyOn, sales:S.sales.length, took:S.sales.reduce((a,s)=>a+(+s.total||0),0), journal:S.journal.length } });
ok(!back.on,'five more bring the real figures back');
ok(back.sales===real.sales&&Math.abs(back.took-real.took)<0.01&&back.journal===real.journal,
   'every bill and every journal line comes back whole',
   JSON.stringify({sales:back.sales,journal:back.journal}));

/* ---- slow taps are not a signal ---- */
const slow=await pg.evaluate(async()=>{ for(let i=0;i<3;i++){ go('dashboard'); await new Promise(r=>setTimeout(r,60)) }
  await new Promise(r=>setTimeout(r,2200));           // a pause longer than the window
  for(let i=0;i<3;i++) go('dashboard');
  return !!window.privacyOn });
ok(!slow,'presses spread out over time are not taken as the signal');
await pg.evaluate(()=>{ if(window.privacyOn) privacyToggle() });

/* ---- an amount to land near ---- */
await set({on:true,mode:'amount',amount:Math.round(real.took*0.2)});
const amt=await pg.evaluate(()=>{ for(let i=0;i<5;i++) go('dashboard');
  return { on:!!window.privacyOn, took:S.sales.reduce((a,s)=>a+(+s.total||0),0) } });
ok(amt.on&&amt.took>0&&amt.took<real.took*0.5,'asking for about a fifth shows about a fifth',
   `${Math.round(real.took)} → ${Math.round(amt.took)}`);
await pg.evaluate(()=>{ if(window.privacyOn) privacyToggle() });

/* ---- and it can never be written to the books ---- */
const safe=await pg.evaluate(()=>{
  for(let i=0;i<5;i++) go('dashboard');
  const quiet=S.sales.length;
  let saved=false; const real=window.fetch;
  window.fetch=(u,o)=>{ if(String(u).includes('/api/books/')&&o&&o.method==='PUT') saved=true; return real(u,o) };
  persist(true); persist();
  window.fetch=real;
  const out={ quiet, saved, on:!!window.privacyOn };
  privacyToggle(); out.after=S.sales.length;
  return out;
});
ok(!safe.saved,'nothing is written to the books while the screen is quiet');
ok(safe.after===real.sales,'and the real bills are still there afterwards',`${safe.quiet} shown → ${safe.after} real`);

/* ---- switched off, the taps do nothing at all ---- */
await set({on:false});
const offTaps=await pg.evaluate(()=>{ for(let i=0;i<6;i++) go('dashboard'); return !!window.privacyOn });
ok(!offTaps,'with the privacy screen switched off, the taps are just taps');

ok(errs.length===0,'no script errors',errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
