// Warranty on the large bill, and the A5 drawn clear for the laser.
//  · a line sold with a warranty prints "Warranty: 1 YEAR, until <date>" on the A5 — Boxed and Old SePOS —
//    and on the 80mm receipt
//  · the A5 as the print helper draws it: grey edges kept (not forced to black and white), at ~370 dpi;
//    with SAVE=<folder> it saves the old and the new drawing of the same bill to compare
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billwarr.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010';
const SAVE = process.env.SAVE || '';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 60000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.setRequestInterception(true); pg.on('request', rq => { if (/:41\d\d/.test(rq.url())) return rq.abort(); rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
const r = await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove());
  const S = window.eval('S'), C = window.eval('CFG'), keep = C.bill.a5Style;
  const p = S.products.find(x => x.active !== false);
  const inv = { no: 'W-TEST', date: '2026-11-03', time: '10:00:00 am', by: 'Afridh', customerId: 1, type: 'CASH', total: 5000, paid: 5000, balance: 0, sub: 5000, billDisc: 0,
    lines: [{ pid: p.id, qty: 1, price: 5000, disc: 0, warranty: '1 YEAR', serials: ['SN123'] }], pays: [{ method: 'CASH', amount: 5000 }] };
  const txt = (f) => { const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:0;top:0;width:794px'; d.innerHTML = window.eval('billHtml')(inv, f); document.body.appendChild(d); const t = d.innerText.replace(/\s+/g, ' '); d.remove(); return t };
  const out = {}; for (const st of ['boxed', 'sepos']) { C.bill.a5Style = st; out[st] = txt('a5') } out.r80 = txt('r80'); C.bill.a5Style = keep; return out });
ok(/Warranty: 1 YEAR, until 03 Nov 2027/.test(r.boxed), 'Boxed A5: "Warranty: 1 YEAR, until 03 Nov 2027"');
ok(/Warranty: 1 YEAR, until 03 Nov 2027/.test(r.sepos) && /S\/N SN123/.test(r.sepos), 'Old SePOS A5: the warranty and the serial print (they did not before)');
ok(/WARRANTY|Warranty/i.test(r.r80), 'the 80mm receipt prints the warranty too');
// the helper's way of drawing the A5: old (thresholded, 2x) against new (grey, 4x)
const agent = fs.readFileSync(new URL('./print-agent/agent.mjs', import.meta.url), 'utf8');
const desk = fs.readFileSync(new URL('../../desktop/printing.js', import.meta.url), 'utf8');
ok(/if \(wide\) for \(let i = 0/.test(agent) && /if \(!\$\{!!f\.grey\}\)/.test(desk) && /grey: true/.test(desk), 'the A5 is no longer forced to black and white (print helper and Regal POS)');
ok(/"oversample": 2/.test(fs.readFileSync(new URL('./print-agent/config.json', import.meta.url), 'utf8')) && /a5: \{ widthPx: 733, scale: 2, oversample: 2/.test(desk), 'the A5 is drawn at 4x — about 370 dots an inch');
if (SAVE) {
  const html = await pg.evaluate(() => { const C = window.eval('CFG'); C.bill.a5Style = 'sepos'; const S = window.eval('S'); const inv = S.sales.filter(s => s.lines && s.lines.length > 2).pop(); return window.eval('printDocument')(window.eval('billHtml')(inv, 'a5'), 'a5') });
  for (const [name, dsf, grey] of [['old', 2, false], ['new', 4, true]]) {
    const p2 = await b.newPage(); await p2.setViewport({ width: 733, height: 800, deviceScaleFactor: dsf }); await p2.setContent(html, { waitUntil: 'load' }); await p2.emulateMediaType('print');
    await p2.evaluate(() => { document.body.classList.add('direct-print'); document.body.style.margin = '0' }); await wait(300);
    const el = await p2.$('#printArea .print') || await p2.$('body'); const shot = await el.screenshot({ encoding: 'base64' });
    const png = await p2.evaluate(async (b64, grey) => { const img = new Image(); await new Promise(r => { img.onload = r; img.src = 'data:image/png;base64,' + b64 });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      if (!grey) { const d = g.getImageData(0, 0, c.width, c.height), px = d.data; for (let i = 0; i < px.length; i += 4) { const v = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) < 186 ? 0 : 255; px[i] = px[i + 1] = px[i + 2] = v } g.putImageData(d, 0, 0) }
      // the same patch of the bill, shown at the same size, so the two can be put side by side
      const s = c.width / 733, o = document.createElement('canvas'); o.width = 700; o.height = 260; const og = o.getContext('2d'); og.imageSmoothingEnabled = false;
      og.drawImage(c, 10 * s, 168 * s, 175 * s, 65 * s, 0, 0, 700, 260); return o.toDataURL('image/png').split(',')[1] }, shot, grey);
    fs.writeFileSync(`${SAVE}/a5-${name}.png`, Buffer.from(png, 'base64')); await p2.close(); }
  console.log('saved a5-old.png and a5-new.png in', SAVE);
}
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
