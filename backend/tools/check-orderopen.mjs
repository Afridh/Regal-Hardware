// An order waiting for a yes or no: its items are on the card, and Open shows the whole of it,
// on the Approvals page and in the Action centre, not only on Supplier orders.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-orderopen.mjs [screenshot-dir]
// The till here never reaches the print helper on this PC: its printers are the shop's.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1440, height: 1000 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url(); if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u)) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await pg.waitForFunction(() => !document.querySelector('.pin-welcome'), { timeout: 10000 }).catch(() => {});
await pg.evaluate(() => { window.eval("CFG.print.agent=''"); window.printPaper = () => {}; document.querySelectorAll('.modal-bg,.modal').forEach(m => m.remove()) });

// orders planted in the test shop, taken out again at the end
await pg.evaluate(() => {
  const S = window.eval('S'), sid = S.suppliers[0].id, ev = [{ id: 'e1', actor: 'rep', name: 'Rep', action: 'sent', note: '', at: Date.now() }];
  const lines = Array.from({ length: 15 }, (_, i) => ({ desc: 'Item ' + (i + 1), qty: i + 1, unit: 'pcs', price: 10 }));
  S.orders = (S.orders || []).concat([
    { id: 'TLINES', dir: 'IN', sid, rep: 'Test rep', date: '2026-11-05', status: 'pending', src: 'portal', events: ev,
      lines: [{ desc: 'Cable 2.5mm <b>red</b>', qty: 3, unit: 'rolls', price: 4500 }, { desc: 'Cable 1.5mm', qty: 2, unit: 'rolls', price: 3200, pid: 1 }, { desc: 'Clips', qty: 10, unit: 'box' }] },
    { id: 'TTEXT', dir: 'IN', sid, rep: 'Test rep', date: '2026-11-05', status: 'pending', src: 'portal', events: ev, lines: [], text: 'Please send\n10 bags of cement and a long enough note to go past sixty letters on this card', files: ['data:image/gif;base64,R0lGODlhAQABAAAAACw='] },
    { id: 'TMANY', dir: 'IN', sid, rep: 'Test rep', date: '2026-11-05', status: 'pending', src: 'portal', events: ev, lines },
    { id: 'TOUT', no: 'PO-T1', dir: 'OUT', sid, date: '2026-11-05', status: 'completed', events: ev, lines: [{ desc: 'Paint', qty: 2, unit: 'tin', est: 100 }], supLines: [{ desc: 'Paint', qty: 1, unit: 'tin', price: 950 }] },
  ]);
});

const card = sel => pg.evaluate(id => { const btn = [...document.querySelectorAll('.act-item [data-act="ordView"]')].find(x => x.dataset.id === id); const c = btn && btn.closest('.act-item'); return c ? c.innerText : null }, sel);
const press = id => pg.evaluate(i => { const x = [...document.querySelectorAll('.act-item [data-act="ordView"]')].find(y => y.dataset.id === i); if (x) x.click(); return !!x }, id);
const shown = () => pg.evaluate(() => { const m = document.getElementById('ordModal'); return m ? m.innerText : null });

const tray = t => pg.evaluate(x => { window.eval(`inTab='${x}'; actCat='all'`); window.eval('render')() }, t).then(() => wait(300));
const view = 'actions';
{
  await pg.evaluate(() => window.eval('go')('approvals')); await wait(500);
  await tray('decide');
  const t = await card('TLINES');
  ok(t && /Cable 2\.5mm/.test(t) && /Cable 1\.5mm/.test(t) && /Clips/.test(t), `${view}: the card lists each item`, t ? '' : 'no card');
  ok(t && /3\s*rolls/.test(t) && /4,?500/.test(t), `${view}: with its quantity and price`);
  ok(t && t.includes('<b>red</b>'), `${view}: a supplier's words are shown as words, not run as page code`);
  ok(await pg.evaluate(() => ![...document.querySelectorAll('.act-item b')].some(x => x.textContent === 'red')), `${view}: no markup from the order gets into the page`);
  const tx = await card('TTEXT');
  ok(tx && /past sixty letters on this card/.test(tx), `${view}: an order typed as a note is shown whole`, tx || '');
  ok(await pg.evaluate(() => { const c = [...document.querySelectorAll('.act-item [data-act="ordView"]')].find(x => x.dataset.id === 'TTEXT').closest('.act-item'); return !!c.querySelector('img') }), `${view}: its photo is on the card`);
  const many = await card('TMANY');
  ok(many && /Item 12\b/.test(many) && !/Item 13\b/.test(many) && /3 more/.test(many), `${view}: a long order shows 12 items and says how many more`);
  await tray('todo');
  const out = await card('TOUT');
  ok(out && /Paint/.test(out) && /950/.test(out), `${view}: our order they completed shows what they will send`);
  await tray('decide');
  if (OUT) await pg.screenshot({ path: OUT + '/order-card.png' });

  ok(await press('TLINES') && (await wait(400), /Cable 2\.5mm/.test(await shown() || '')), `${view}: Open shows the whole order`, String(await shown()).slice(0, 80));
  await wait(1500); await pg.evaluate(() => window.eval('render')()); await wait(200);
  ok(/Cable 1\.5mm/.test(await shown() || ''), `${view}: it stays open when the page redraws`);
  ok(await pg.evaluate(v => window.eval('S').view === v, view), `${view}: you stay on the same page`);
  if (OUT) await pg.screenshot({ path: OUT + '/order-open.png' });
  await pg.keyboard.press('Escape'); await wait(200);
  ok(await shown() === null && await pg.evaluate(v => window.eval('S').view === v, view), `${view}: Esc closes it and leaves you on the page`);
  await tray('todo');
  ok(await press('TOUT') && (await wait(400), /Paint/.test(await shown() || '')), `${view}: Open works for our own order too`);
  await pg.evaluate(() => window.eval('ordClose')());
}

// leaving the page shuts the window; the Approve inside it works and shows at once
await pg.evaluate(() => window.eval('go')('approvals')); await wait(400); await tray('decide');
await press('TLINES'); await wait(300);
await pg.evaluate(() => window.eval('go')('products')); await wait(300);
ok(await shown() === null, 'going to another page closes the order');
await pg.evaluate(() => window.eval('go')('approvals')); await wait(400); await tray('decide');
ok(await shown() === null, 'and it does not come back by itself');
await press('TLINES'); await wait(300);
await pg.evaluate(() => { const x = document.querySelector('#ordModal [data-act="ord"][data-st="accepted"]'); x && x.click() }); await wait(400);
ok(await pg.evaluate(() => window.eval('S').orders.find(o => o.id === 'TLINES').status === 'accepted'), 'Approve inside the window approves it');
ok(/Goods arrived|Approved|accepted/i.test(await shown() || ''), 'and the window shows it at once');
await pg.evaluate(() => window.eval('ordClose')()); await wait(100);
ok(await card('TLINES') === null, 'the card leaves the list');

// on Supplier orders itself, as before
await pg.evaluate(() => window.eval('go')('orders')); await wait(400);
await pg.evaluate(() => { const x = document.querySelector('.ordrow[data-id="TMANY"]') || [...document.querySelectorAll('[data-act="ordView"]')].find(y => y.dataset.id === 'TMANY'); x && x.click() }); await wait(400);
ok(/Item 15/.test(await shown() || ''), 'Supplier orders: Open still works, every item shown');
ok(errs.length === 0, 'no errors in the page', errs.join(' | '));

await pg.evaluate(() => { const S = window.eval('S'); S.orders = S.orders.filter(o => !['TLINES', 'TTEXT', 'TMANY', 'TOUT'].includes(o.id)); window.eval('persist')(true) }); await wait(1500);
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
