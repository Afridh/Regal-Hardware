// The shop site on a phone: can a thumb reach everything, and does the page arrive as you come
// down it. Checked at the width of a real phone, with touch on.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE='http://localhost:4000';
const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const b=await puppeteer.launch({executablePath:exe,headless:true,args:['--no-sandbox']});
let pass=0,fail=0; const ok=(c,w,x='')=>{c?(pass++,console.log('PASS '+w+(x?'  '+x:''))):(fail++,console.log('FAIL '+w+(x?'  '+x:'')))};
const errs=[];

for(const [label,w,h,mobile] of [['phone',390,844,true],['small phone',360,740,true],['tablet',820,1180,false],['desk',1440,900,false]]){
  const pg=await b.newPage();
  await pg.setViewport({width:w,height:h,deviceScaleFactor:2,isMobile:mobile,hasTouch:mobile});
  pg.on('pageerror',e=>errs.push(label+': '+e.message));
  await pg.goto(BASE+'/',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,1300));
  const m=await pg.evaluate(()=>{
    const cs=(s)=>{const el=document.querySelector(s);return el?getComputedStyle(el).display:'(none)'};
    const tooSmall=[...document.querySelectorAll('a,button')].filter(el=>{
      const r=el.getBoundingClientRect();
      return r.width>0&&r.height>0&&r.height<40&&!el.closest('.ft,.top-navbar,.mob-nav')}).length;
    return { w:innerWidth, overflow:document.documentElement.scrollWidth>innerWidth+1,
      menu:cs('.menu-btn'), pill:cs('.contractor-pill'), nav:cs('.nav-links'),
      drawer:!!document.querySelector('.mob-nav'), reveal:document.querySelectorAll('.rv').length,
      shown:document.querySelectorAll('.rv.in').length, tooSmall };
  });
  ok(!m.overflow, `${label}: nothing runs off the side of the screen`, `${m.w}px`);
  if(mobile||w<=1024){
    ok(m.menu!=='none', `${label}: there is a menu button`);
    ok(m.drawer, `${label}: and a drawer behind it`);
  }
  if(w<=768){
    ok(m.pill==='none'&&m.nav==='none', `${label}: the desktop menu is out of the way`, JSON.stringify({pill:m.pill,nav:m.nav}));
    ok(m.tooSmall===0, `${label}: everything meant to be tapped is big enough for a finger`, m.tooSmall+' too small');
  }
  if(w>=1440){
    ok(m.menu==='none'&&m.nav!=='none', 'desk: the full menu is back and the button is gone',JSON.stringify({menu:m.menu,nav:m.nav}));
  }
  ok(m.reveal>0&&m.shown>0, `${label}: the page is set to arrive, and what is already on screen is shown`,
     `${m.shown} of ${m.reveal} shown at once`);
  await pg.close();
}

/* the drawer itself */
const pg=await b.newPage();
await pg.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
pg.on('pageerror',e=>errs.push('drawer: '+e.message));
await pg.goto(BASE+'/',{waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,1200));
const drawer=await pg.evaluate(async()=>{
  const d=document.querySelector('.mob-nav');
  const shut=getComputedStyle(d).transform;
  document.querySelector('.menu-btn').click();
  await new Promise(r=>setTimeout(r,400));
  const open=getComputedStyle(d).transform;
  const links=[...d.querySelectorAll('a[href^="#/"]')].map(a=>a.textContent.trim());
  const locked=getComputedStyle(document.body).overflow;
  d.querySelector('.mn-close').click();
  await new Promise(r=>setTimeout(r,400));
  return { shut, open, links, locked, closed:!document.body.classList.contains('nav-open') };
});
ok(drawer.shut!==drawer.open,'the drawer slides in when the button is pressed');
ok(drawer.links.length>=5,'with the whole menu in it',drawer.links.join(' · '));
ok(drawer.locked==='hidden','and the page behind it does not scroll');
ok(drawer.closed,'and it shuts again');

/* a phone asking for less movement gets none */
await pg.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
await pg.reload({waitUntil:'networkidle2'});
await new Promise(r=>setTimeout(r,1200));
const quiet=await pg.evaluate(()=>{
  const r=[...document.querySelectorAll('.rv')];
  return { n:r.length, hidden:r.filter(el=>getComputedStyle(el).opacity==='0').length };
});
ok(quiet.hidden===0,'a phone asking for less movement is shown everything at once',JSON.stringify(quiet));
await pg.close();

ok(errs.length===0,'no script errors at any width',errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
