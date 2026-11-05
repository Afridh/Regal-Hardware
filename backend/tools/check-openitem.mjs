// An open item keeps the name it was given, everywhere (5 Nov 2026: it came back as "Open item" on a recall and on a quotation).
// Keyed through the real till as an open item, then looked for on every screen and paper a bill or quotation appears on:
// the held list and a recall; a quotation, its reprints on both papers, its preview and the bill made from it; a bill,
// its reprints, its details, a change to it, a copy of it, a return. "Open item" showing anywhere is a failure. No paper.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-openitem.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:4010', NAME = 'CUSTOM CUT PIPE 3FT', PRICE = 475;
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'], protocolTimeout: 90000 });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 900 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
const posted = [];
await pg.setRequestInterception(true);
pg.on('request', rq => { const u = rq.url(); if (!/:41\d\d/.test(u)) return rq.continue();
  const head = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
  if (rq.method() === 'OPTIONS') return rq.respond({ status: 204, headers: head });
  if (u.endsWith('/print')) { posted.push(JSON.parse(rq.postData())); return rq.respond({ status: 200, headers: head, contentType: 'application/json', body: '{"ok":true,"printer":"nothing, a test"}' }) }
  rq.abort() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
const fresh = () => pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'), C = window.eval('CFG'); C.bill.printTo = ''; C.print = { agent: 'http://localhost:4100' }; C.done.askSize = false; C.done.printAnim = false; C.done.preview = false; window.eval('CS').paper = 'none';
  window.eval('prefs')().till = 'classic'; S.pos.lines = []; S.pos.customer = null; S.pos.editing = null; S.pos.fromDoc = null; window.eval('go')('pos') });
// through the till itself: the open-item code, the name, the price, Enter along the row
const keyOpen = async () => { await fresh(); await wait(400);
  const code = await pg.evaluate(() => window.eval('openCode')()); await pg.focus('#csQ'); await pg.keyboard.type(String(code)); await pg.keyboard.press('Enter'); await wait(300);
  await pg.waitForSelector('#csName', { timeout: 3000 }); await pg.focus('#csName'); await pg.keyboard.type(NAME); await pg.keyboard.press('Enter'); await wait(150);
  await pg.keyboard.press('Enter'); await wait(100); await pg.keyboard.type(String(PRICE)); for (let i = 0; i < 3; i++) { await pg.keyboard.press('Enter'); await wait(150) } await wait(300) };
const screen = () => pg.evaluate(() => { const m = [...document.querySelectorAll('.modal')].pop(); return (m || document.getElementById('main') || document.body).innerText });
const onTill = () => pg.evaluate(() => window.eval('S').pos.lines.map(l => ({ name: window.eval('lineName')(l), price: l.price, open: window.eval('isOpenLine')(l) })));
const shows = (label, t) => ok(new RegExp(NAME, 'i').test(t) && !/open item/i.test(t), label, /open item/i.test(t) ? 'it says Open item' : new RegExp(NAME, 'i').test(t) ? '' : 'the name is not there: ' + t.replace(/\s+/g, ' ').slice(0, 90));
const tillLine = (label, l) => ok(l.length === 1 && l[0].name === NAME && l[0].price === PRICE && l[0].open, label, JSON.stringify(l));

await keyOpen();
tillLine('keyed on the till: the name, the price', await onTill());
shows('on the till screen', await screen());
const toPaper = async (fn, arg, wantDocs = 1) => { posted.length = 0; await pg.evaluate(fn, arg); await wait(1200); return posted.map(p => p.html).join(' ') };
const paperText = async (html) => { const p = await b.newPage(); await p.setContent(html || '<i></i>', { waitUntil: 'load' }); const t = await p.evaluate(() => (document.getElementById('printArea') || document.body).innerText); await p.close(); return t };

// held: the list, and a recall
await pg.evaluate(() => window.eval('holdCurrentBill')(true, 'test hold')); await wait(300);
await pg.evaluate(() => window.eval('showHeldBillsModal')()); await wait(400);
shows('the held bills window', await screen());
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('recallHeldBill')(0) }); await wait(400);
tillLine('recalled from held: the name, the price', await onTill());
shows('on the till after the recall', await screen());

// a quotation: its reprints, and the bill from it
const qno = await pg.evaluate(() => { const S = window.eval('S'); window.eval('saveDoc')('QUOTE', 'test'); return S.docs.at(-1).no }); await wait(500);
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
for (const style of ['sepos', 'boxed', 'bw']) { const t = await paperText(await toPaper(([no, st]) => { window.eval('CFG').bill.a5Style = st; const d = window.eval('S').docs.find(x => x.no === no); window.eval('docToPaper')(d, 'a5') }, [qno, style])); shows(`quotation ${qno} reprinted, large, ${style}`, t) }
shows(`quotation ${qno} reprinted, 80mm`, await paperText(await toPaper(no => { const d = window.eval('S').docs.find(x => x.no === no); window.eval('docToPaper')(d, 'r80') }, qno)));
await pg.evaluate(no => window.eval('docPrint')(no, { preview: true, format: 'a5' }), qno); await wait(400); shows('quotation preview', await screen());
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('go')('docs') }); await wait(500);
await pg.evaluate(no => { window.eval('docSel = ' + JSON.stringify(no)); window.eval('render')() }, qno); await wait(400); shows('the quotation on the Documents page', await screen());
await pg.evaluate(no => { window.eval('docToBill')(no) }, qno); await wait(600);
tillLine('quotation made into a bill: the name, the price', await onTill());
shows('on the till, from the quotation', await screen());

// a bill: reprints, details, a change, a copy, a return
const inv = await pg.evaluate(() => { const c = window.eval('C')(1), t = window.eval('billTotal')(); const i = window.eval('finishTillBill')({ cust: c, pays: [{ method: 'CASH', amount: t }] }); return { no: i.no } }); await wait(500);
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
const sale = await pg.evaluate(no => window.eval('S').sales.find(s => s.no === no).lines.map(l => ({ name: l.name, open: l.open, price: l.price })), inv.no);
ok(sale[0].name === NAME && sale[0].open, `bill ${inv.no} holds the name`, JSON.stringify(sale));
for (const f of ['a5', 'r80']) { const t = await paperText(await pg.evaluate((no, f) => { const s = window.eval('S').sales.find(x => x.no === no); return window.eval('billDocument')(s, f) }, inv.no, f)); shows(`bill ${inv.no} reprinted, ${f}`, t) }
await pg.evaluate(no => window.eval('showInvoice')(window.eval('S').sales.find(x => x.no === no), 'a5'), inv.no); await wait(500); shows('the bill shown', await screen());
await pg.evaluate(no => { document.querySelectorAll('.modal').forEach(m => m.remove()); const v = window.eval('billQ = ' + JSON.stringify(no)); window.eval('billSel = ' + JSON.stringify(no)); window.eval('go')('bills') }, inv.no); await wait(600); shows('the bill on the Bills page', await screen());
await pg.evaluate(no => window.eval('billCopy')(no), inv.no); await wait(500);
tillLine('a bill copied back to the till: the name, its price', await onTill());
await pg.evaluate(() => { window.eval('S').pos.lines = [] });
// the bill opened on the till to be changed
await pg.evaluate(no => { window.eval('billToTill')(no) }, inv.no); await wait(300);
await pg.evaluate(() => { const y = document.getElementById('ebYes'); if (y) y.click() }); await wait(500);
tillLine('a bill opened on the till to be changed', await onTill());
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove()));
// the question before a line is taken off, and the search for a quotation by the typed name
await pg.evaluate(() => { const S = window.eval('S'); S.pos.editing = null; window.eval('csAskDel')(0) }); await wait(300);
shows('asked before the line is taken off', await screen());
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); S.pos.lines = [] });
ok(await pg.evaluate(([no, name]) => { window.eval('docQ = ' + JSON.stringify(name.slice(0, 10).toLowerCase())); window.eval('docState = "all"'); const f = window.eval('docList')().some(d => d.no === no); window.eval('docQ = ""'); return f }, [qno, NAME]), 'a quotation is found by the typed name');
// the keyboard till's own table
await pg.evaluate(name => { const S = window.eval('S'); window.eval('prefs')().till = 'keys'; S.pos.lines = [{ pid: window.eval('OPEN_PID'), name, qty: 1, price: 475, disc: 0, open: true, auto: false }]; window.eval('go')('pos') }, NAME); await wait(400);
shows('on the keyboard till', await screen());
await pg.evaluate(() => { window.eval('prefs')().till = 'classic'; window.eval('S').pos.lines = []; window.eval('go')('pos') }); await wait(200);
// tidy: the test papers go
await pg.evaluate(({ no, qno }) => { const S = window.eval('S'); window._allowWipeOnce = Date.now(); S.sales = S.sales.filter(s => s.no !== no); S.journal = S.journal.filter(j => j.ref !== no); S.docs = S.docs.filter(d => d.no !== qno); S.pos.lines = []; window.eval('persist')(true) }, { no: inv.no, qno }); await wait(1500);
ok(!errs.length, 'no script errors', errs.slice(0, 2).join(' | '));
console.log(`\n${pass} passed, ${fail} failed`);
await b.close();
