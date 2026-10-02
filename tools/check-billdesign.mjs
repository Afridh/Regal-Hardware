// Designing the receipt: does what the page says actually come out of the printer.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE='http://localhost:4000';
const exe=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
const b=await puppeteer.launch({executablePath:exe,headless:true,args:['--no-sandbox']});
const pg=await b.newPage(); await pg.setViewport({width:1500,height:1100});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
let pass=0,fail=0; const ok=(c,w,x='')=>{c?(pass++,console.log('PASS '+w+(x?'  '+x:''))):(fail++,console.log('FAIL '+w+(x?'  '+x:'')))};

await pg.goto(BASE+'/pos',{waitUntil:'networkidle2'});
await pg.waitForSelector('#lockScreen');
if(await pg.$('#lockUser')) await pg.type('#lockUser','Afridh'); else await pg.click('[data-user="Afridh"]');
await pg.type('#lockPw','Afridh123'); await pg.click('#lockGo');
await pg.waitForFunction(()=>!document.getElementById('lockScreen'));
await new Promise(r=>setTimeout(r,900));

const base=await pg.evaluate(()=>{
  CFG.bill.r80=null; Object.keys(R80_OLD).forEach(k=>{CFG.bill[R80_OLD[k]]=true});
  const inv=billSample();
  return { parts:R80_DEFAULT.length, order:r80Order().join(','), html:billHtml(inv,'r80'), mm:r80Mm(inv) };
});
ok(base.parts===17&&base.order.startsWith('top,logo,name'),'the receipt is made of named parts, in the order it has always had',`${base.parts} parts`);
ok(/sb-logo/.test(base.html)&&/sb-items/.test(base.html)&&/sb-bc/.test(base.html)&&/sb-thanks/.test(base.html),
   'and all of them print by default');
ok(base.mm>80&&base.mm<400,'it knows how far down the roll it runs',base.mm+' mm');

// turning one off takes it off the paper, and shortens the roll
const off=await pg.evaluate(()=>{
  const inv=billSample();
  r80Set('barcode',false); r80Set('logo',false);
  const html=billHtml(inv,'r80');
  return { bc:/sb-bc/.test(html), logo:/sb-logo/.test(html), mm:r80Mm(inv), items:/sb-items/.test(html) };
});
ok(!off.bc&&!off.logo,'turning a part off takes it off the paper');
ok(off.items,'and what was sold is still there');
ok(off.mm<base.mm,'the roll gets shorter',`${base.mm} → ${off.mm} mm`);

// and the old switch says the same thing, so nothing comes back on by itself
const agrees=await pg.evaluate(()=>({ barcode:CFG.bill.showBarcode, logo:CFG.bill.t80Logo }));
ok(agrees.barcode===false&&agrees.logo===false,'the old switches are kept in step',JSON.stringify(agrees));

// the lines themselves cannot be taken off
const cannot=await pg.evaluate(()=>{ r80Set('items',false);
  return { on:r80On('items'), inBill:/sb-items/.test(billHtml(billSample(),'r80')) } });
ok(cannot.on&&cannot.inBill,'a bill cannot be left without its lines');

// moving a part moves it on the paper
const moved=await pg.evaluate(()=>{
  CFG.bill.r80=null; Object.keys(R80_OLD).forEach(k=>{CFG.bill[R80_OLD[k]]=true});
  const inv=billSample();
  const before=billHtml(inv,'r80');
  const beforeAt={ bc:before.indexOf('sb-bc'), items:before.indexOf('sb-items') };
  for(let i=0;i<12;i++) r80Move('barcode',-1);        // walk it to the top
  const after=billHtml(inv,'r80');
  return { beforeAt, afterAt:{ bc:after.indexOf('sb-bc'), items:after.indexOf('sb-items') },
    order:r80Order().slice(0,3).join(',') };
});
ok(moved.beforeAt.bc>moved.beforeAt.items&&moved.afterAt.bc<moved.afterAt.items,
   'moving a part up moves it up the paper',JSON.stringify(moved.afterAt));

// putting it back
const reset=await pg.evaluate(()=>{
  CFG.bill.r80=null; r80Cfg(); Object.values(R80_OLD).forEach(k=>{CFG.bill[k]=true}); CFG.bill.r80Scale=100;
  const inv=billSample();
  return { order:r80Order().join(','), html:billHtml(inv,'r80'), mm:r80Mm(inv) };
});
ok(reset.order===base.order&&reset.html===base.html&&reset.mm===base.mm,
   'putting it back gives exactly the bill it started with');

// the page itself
const page=await pg.evaluate(()=>{ go('billdesign');
  const mn=document.getElementById('main');
  return { rows:mn.querySelectorAll('.bd-row').length, bill:!!mn.querySelector('.bd-bill .print.r80'),
    ticks:mn.querySelectorAll('[data-bdon]').length, moves:mn.querySelectorAll('[data-bdup]').length,
    words:mn.querySelectorAll('[data-bdw]').length, mm:/mm of roll/.test(mn.textContent) };
});
ok(page.rows===17&&page.bill&&page.mm,'the page shows the paper and every part of it',JSON.stringify(page));
ok(page.ticks===17&&page.moves===17&&page.words>=5,'with a switch, arrows and the wording',JSON.stringify(page));

ok(errs.length===0,'no script errors',errs.join(' | '));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
