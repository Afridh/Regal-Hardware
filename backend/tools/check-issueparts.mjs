// A big bill whose goods go bit by bit: each part has a delivery note, and the bill shows what has gone and what is pending.
//  · after the bill: Issue in parts; on the till: every line in one go; the money and the stock do not move
//  · Issue goods: part of a line, a delivery note large or small; a reprint says what it said at the time
//  · the bill screen, the Not delivered filter, Goods to collect; a return; editing a bill keeps what has gone
//  · Ctrl+K opens and closes the calculator on the till
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-issueparts.mjs [screenshot-dir]
// Nothing reaches a printer: printPaper is stubbed and the print helper's address is stopped.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const OUT = process.argv[2] || '';
const BASE = process.env.BASE || 'http://localhost:4010';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
await pg.setRequestInterception(true);
const road = { helper: [], queue: [], helperUp: false, queueUp: false };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*', 'Access-Control-Allow-Private-Network': 'true' };
pg.on('request', rq => { const u = rq.url();
  if (/^https?:\/\/(localhost|127\.0\.0\.1):41\d\d/.test(u)) {   // answered here: it never reaches the print helper on this PC
    if (rq.method() === 'OPTIONS') return rq.respond({ status: 204, headers: CORS });
    if (!/\/print$/.test(u) || !road.helperUp) return rq.abort();
    road.helper.push(JSON.parse(rq.postData())); return rq.respond({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ ok: true, printer: 'TEST' }) }) }
  if (/\/api\/print\b/.test(u) && rq.method() !== 'GET') { if (!road.queueUp) return rq.abort(); road.queue.push(JSON.parse(rq.postData())); return rq.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }) }
  rq.continue() });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForFunction(() => document.getElementById('lockScreen') || document.querySelector('#nav button'), { timeout: 25000 });
if (await pg.$('#lockScreen')) {
  if (!(await pg.$('#lockUser')) && !(await pg.$('#lockPw'))) await pg.evaluate(() => shopLockPassword());
  if (await pg.$('#lockUser')) await pg.type('#lockUser', 'Afridh');
  await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
  await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 20000 });
}
await wait(1500);
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval("CFG.print.agent=''");
  window._printed = []; window._realPrint = window.printPaper; window.printPaper = (html, f, no) => { window._printed.push({ html: String(html), f, no }) }; window.print = () => { window._winPrint = (window._winPrint || 0) + 1 };
  window.eval('featOn'); const p = window.eval('prefs')(); delete p.tillLook; p.till = 'classic'; try { localStorage.removeItem('regal_note_paper') } catch (e) {} });

// Ctrl+K
await pg.evaluate(() => { window.eval('S').pos.lines = []; window.eval('go')('pos') }); await wait(500);
await pg.focus('#csQ');
const ctrlK = async () => { await pg.keyboard.down('Control'); await pg.keyboard.press('KeyK'); await pg.keyboard.up('Control'); await wait(250) };
await ctrlK();
ok(await pg.evaluate(() => !!document.querySelector('.modal.calcbox')), 'Ctrl+K opens the calculator, cursor in the item box');
await pg.keyboard.press('7'); await wait(60);
await ctrlK();
ok(await pg.evaluate(() => !document.querySelector('.modal.calcbox')), 'and closes it');
ok(await pg.evaluate(() => document.getElementById('csQ').value === ''), 'and nothing reached the item box');
await pg.evaluate(() => window.eval('go')('bills')); await wait(300); await ctrlK();
ok(await pg.evaluate(() => !document.querySelector('.modal.calcbox')), 'it belongs to the till: not on the Bills page');

// a bill of five lines, made the real way, on a customer
const made = await pg.evaluate(() => {
  const S = window.eval('S'), cs = window.eval('completeSale'), c = S.customers.find(x => x.id !== 1 && x.active !== false); c.limit = 1e9;
  const ps = S.products.filter(p => p.active !== false && p.stock > 40 && p.retail > 0 && !p.serialised && !(p.tiers || []).length).slice(0, 5);
  S.pos = { ...S.pos, lines: ps.map((p, i) => ({ pid: p.id, qty: 10 + i, price: p.retail, disc: 0 })), customer: c.id, billDisc: 0, sel: -1 };
  const before = ps.map(p => p.stock), total = window.eval('billTotal')();
  const inv = cs({ lines: S.pos.lines.map(l => ({ ...l })), customerId: c.id, billDisc: 0, pays: [{ method: 'CASH', amount: total }] }); S.pos.lines = []; S.pos.customer = 1;
  return { cid: c.id, no: inv.no, pids: ps.map(p => p.id), stock: ps.map(p => p.stock), sold: ps.map((p, i) => before[i] - p.stock), journal: S.journal.length, total: inv.total, cust: c.name, names: ps.map(p => p.name) };
});
ok(!!made.no && made.sold.every((n, i) => n === 10 + i), 'a five line bill, out of stock in the normal way', made.no);
await pg.evaluate(no => { const w = window; window.eval(`billSel=${JSON.stringify(no)}; billQ=''; billType='all'; billFrom=''; billTo=''; billBy='all'; billCust=null`); window.eval('go')('bills') }, made.no); await wait(500);
const paneText = () => pg.evaluate(() => (document.querySelector('.bl-wrap') || document.body).innerText);
const has = sel => pg.evaluate(s => !!document.querySelector(s), sel);
ok(await has('[data-act="billIssueParts"]'), 'the bill has Issue in parts');
ok(!/GIVEN/.test(await paneText()), 'a normal bill shows no given and pending columns');

// after the bill: 3 of the first line were taken, the rest is pending
await pg.evaluate(() => document.querySelector('[data-act="billIssueParts"]').click()); await wait(250);
if (OUT) await pg.screenshot({ path: OUT + '/parts-ask.png' });
ok(await pg.evaluate(() => [...document.querySelectorAll('.modal [data-ci]')].every(i => i.value === '0') && !window.eval('S').sales.some(s => 0)), 'it opens with nothing going yet');
ok(await pg.evaluate(no => !window.eval('S').sales.find(s => s.no === no).lines.some(l => l.later), made.no), 'and nothing is pending until it is confirmed');
const printedBefore = await pg.evaluate(() => window._printed.length);
await pg.evaluate(() => { document.querySelector('.modal [data-ci]').value = 3 });
await pg.focus('.modal [data-ci]'); await pg.keyboard.press('Enter'); await wait(500);
let partsNote = await pg.evaluate(() => window._printed.slice(-1)[0]);
ok((await pg.evaluate(() => window._printed.length)) === printedBefore + 1 && /DELIVERY NOTE/.test(partsNote.html) && partsNote.f === 'a5', 'typing what is going and Enter prints a delivery note', partsNote && partsNote.no);
let st = await pg.evaluate(no => { const S = window.eval('S'), inv = S.sales.find(s => s.no === no); return { later: inv.lines.map(l => l.later), j: S.journal.length, total: inv.total, stock: inv.lines.map(l => S.products.find(p => p.id === l.pid).stock), pending: window.eval('billPending')(inv) } }, made.no);
ok(st.later[0] === 10 && st.later[1] === 11 && st.later[4] === 14, 'every goods line goes through the notes', JSON.stringify(st.later));
ok(st.j === made.journal && st.total === made.total, 'no money moved');
ok(JSON.stringify(st.stock) === JSON.stringify(made.stock), 'and the stock did not move');
let t = await paneText();
ok(/GIVEN/.test(t) && /PENDING/.test(t), 'the bill now shows given and pending');
ok(/goods pending/.test(t), 'and the list says so');
ok(await has('[data-act="colIssueBill"]') && !(await has('[data-act="billIssueParts"]')), 'Issue goods is there, Issue in parts has gone');
ok(!(await has('[data-act="billDlvNot"]')), 'Not delivered yet is not offered as well');
// the Not delivered filter finds it
await pg.evaluate(() => { window.eval("billType='undelivered'"); window.eval('render')() }); await wait(300);
ok(await pg.evaluate(no => [...document.querySelectorAll('.bl-row')].some(r => r.dataset.no === no), made.no), 'the Not delivered filter finds it');
await pg.evaluate(() => { window.eval("billType='all'"); window.eval('render')() }); await wait(200);

// the first part: 2 of line 1 and all of line 2, on the large sheet by default
await pg.evaluate(() => document.querySelector('[data-act="colIssueBill"]').click()); await wait(250);
await pg.evaluate(() => { document.getElementById('ciNone').click(); const i = document.querySelectorAll('.modal [data-ci]'); i[0].value = 2; i[1].value = 11; document.getElementById('ciWho').value = 'Kamal'; document.getElementById('ciCar').value = 'WP LA-1234' });
if (OUT) await pg.screenshot({ path: OUT + '/parts-issue.png' });
await pg.focus('#ciWho'); await pg.keyboard.press('Enter'); await wait(500);
let pr = await pg.evaluate(() => window._printed.slice(-1)[0]);
ok(pr && pr.f === 'a5' && /^ISN/i.test(pr.no), 'the delivery note goes to the large paper by default', pr && pr.no);
ok(pr && /DELIVERY NOTE/.test(pr.html) && /WP LA-1234/.test(pr.html) && /Kamal/.test(pr.html), 'it says delivery note, who took it and the vehicle');
if (pr && OUT) fs.writeFileSync(OUT + '/note1.html', pr.html);
const cells = async (html) => pg.evaluate(h => { const d = new DOMParser().parseFromString(h, 'text/html'); return [...d.querySelectorAll('#printArea table.x-tbl tbody tr')].map(r => [...r.cells].map(c => c.textContent.trim())) }, html);
let row = await cells(pr.html);
ok(row.length === 5, 'every goods line of the bill is on it', String(row.length));
ok(row[0][2] === '10' && row[0][3] === '3' && row[0][4] === '2' && row[0][5] === '5', 'line 1: 10 on the bill, 3 before, 2 now, 5 pending', row[0].join('|'));
ok(row[1][3] === '—' && row[1][4] === '11' && row[1][5] === '—', 'line 2: all 11 now, none pending', row[1].join('|'));
ok(row[2][4] === '—' && row[2][5] === '12', 'line 3: none now, 12 pending', row[2].join('|'));
const firstIsn = pr.no, firstHtml = pr.html;
ok(/Still pending on this bill: 44/.test(pr.html.replace(/,/g, '')), 'it says how much is still pending');
await pg.evaluate(no => window.eval('render')()); await wait(200);
t = await paneText();
ok(t.includes(firstIsn) && /Delivery notes/.test(t), 'the bill lists the note');
let ln = await pg.evaluate(() => [...document.querySelectorAll('.bl-lines tr')].slice(1, 3).map(r => [...r.cells].map(c => c.textContent.trim())));
ok(ln[0][3] === '5' && ln[0][4] === '5', 'line 1 on the screen: 5 given (3 + 2), 5 pending', ln[0].join('|'));
ok(ln[1][3] === '11' && ln[1][4] === '—', 'line 2 on the screen: 11 given, none pending', ln[1].join('|'));
if (OUT) await pg.screenshot({ path: OUT + '/parts-bill.png' });

// too many
await pg.evaluate(() => document.querySelector('[data-act="colIssueBill"]').click()); await wait(250);
await pg.evaluate(() => { document.querySelectorAll('.modal [data-ci]')[0].value = 99; document.getElementById('ciLarge').click() }); await wait(250);
ok(await pg.evaluate(() => /Only 5/.test([...document.querySelectorAll('.toast')].map(t => t.innerText).join(' ')) && !!document.getElementById('ciOk') === false && !!document.getElementById('ciLarge')), 'more than is pending is refused');
// the second part, small paper
await pg.evaluate(() => { document.getElementById('ciNone').click(); document.querySelectorAll('.modal [data-ci]')[0].value = 5; document.getElementById('ciSmall').click() }); await wait(500);
pr = await pg.evaluate(() => window._printed.slice(-1)[0]);
ok(pr.f === 'r80' && /DELIVERY NOTE/.test(pr.html) && /STILL PENDING ON THIS BILL/.test(pr.html), 'the small note too, with what is still pending', pr.no);
ok(!/GOODS ISSUE NOTE/.test(pr.html), 'it is not called a goods issue note');
// a reprint of the first says what it said
await pg.evaluate(isn => window.eval('collectPrint')(isn), firstIsn); await wait(300);
pr = await pg.evaluate(() => window._printed.slice(-1)[0]);
row = await cells(pr.html);
ok(pr.f === 'a5' && row[0][3] === '3' && row[0][4] === '2' && row[0][5] === '5', 'a reprint of the first note says what it said then, on its own paper', row[0].join('|'));
await pg.evaluate(isn => window.eval('collectPrint')(isn, 'r80'), firstIsn); await wait(200);
ok((await pg.evaluate(() => window._printed.slice(-1)[0].f)) === 'r80', 'it can be asked for on the other paper');
ok(/\b5\b/.test((await pg.evaluate(() => window._printed.slice(-1)[0].html)).match(/STILL PENDING[\s\S]*?sb-rule/)?.[0] || ''), 'the small reprint has the pending as it stood');

// Print on a note asks which paper first
const notePrints = () => pg.evaluate(() => window._printed.length);
const pressPrint = isn => pg.evaluate(i => [...document.querySelectorAll('[data-act="colReprint"]')].find(b => b.dataset.isn === i).click(), isn).then(() => wait(250));
await pg.evaluate(() => window.eval('render')()); await wait(200);
let npr = await notePrints();
await pressPrint(firstIsn);
ok(await has('.modal [data-nf="a5"]') && await has('.modal [data-nf="r80"]') && await notePrints() === npr, 'Print on a note asks large or small, and nothing has printed yet');
if (OUT) await pg.screenshot({ path: OUT + '/note-ask.png' });
await pg.evaluate(() => document.querySelector('.modal [data-nf="r80"]').click()); await wait(250);
pr = await pg.evaluate(() => window._printed.slice(-1)[0]);
ok(await notePrints() === npr + 1 && pr.f === 'r80' && pr.no === firstIsn, 'choosing Small prints it small, once');
ok(!(await has('.modal [data-nf]')), 'and the question closes');
await pressPrint(firstIsn); await pg.evaluate(() => { const b = document.querySelector('.modal [data-nf="a5"]'); b.click(); b.click() }); await wait(250);
pr = await pg.evaluate(() => window._printed.slice(-1)[0]);
ok(await notePrints() === npr + 2 && pr.f === 'a5', 'choosing Large prints it large, once, even pressed twice');
await pressPrint(firstIsn); await pg.keyboard.press('Escape'); await wait(250);
ok(await notePrints() === npr + 2 && !(await has('.modal [data-nf]')), 'Esc prints nothing');
await pressPrint(firstIsn); await pg.evaluate(() => document.querySelector('.modal').click()); await wait(250); await pg.keyboard.press('Enter'); await wait(250);
ok(await notePrints() === npr + 2, 'a click outside prints nothing, and a key pressed after it does not either');
await pg.evaluate(() => document.querySelectorAll('.modal').forEach(m => m.remove())); await wait(150);   // Enter on the Bills page opens the bill: that is the page's own, not this
await pressPrint(firstIsn); await pg.keyboard.press('Enter'); await wait(250);
pr = await pg.evaluate(() => window._printed.slice(-1)[0]);
ok(await notePrints() === npr + 3 && pr.f === 'a5', 'Enter takes the paper it was printed on', `${await notePrints() - npr} ${pr.f}`);
await pressPrint(firstIsn); await pg.keyboard.press('s'); await wait(250);
pr = await pg.evaluate(() => window._printed.slice(-1)[0]);
ok(pr.f === 'r80', 'S is small');
await pressPrint(firstIsn); await pg.keyboard.press('2'); await wait(250);
pr = await pg.evaluate(() => window._printed.slice(-1)[0]);
ok(pr.f === 'a5', '2 is large');

// editing a bill keeps what has gone
await pg.evaluate(no => window.eval('billToTill')(no), made.no); await wait(300); await pg.click('#ebYes'); await wait(500);
const posL = await pg.evaluate(() => { const L = window.eval('S').pos.lines; return L.map(l => ({ later: l.later, n: (l.issued || []).length })) });
ok(posL.length === 5 && posL[0].n === 3 && posL[0].later === 10, 'Edit in the till carries what has gone', JSON.stringify(posL[0]));
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'); S.pos.sel = 0; window.eval('csLater')(0) }); await wait(200);
await pg.evaluate(() => { document.getElementById('clQty').value = 3; document.getElementById('clOk').click() }); await wait(200);
ok(await pg.evaluate(() => window.eval('S').pos.lines[0].later === 10 && /already gone/.test([...document.querySelectorAll('.toast')].map(t => t.innerText).join(' '))), 'a line cannot be set below what has gone');
await pg.evaluate(() => { document.querySelectorAll('.modal').forEach(m => m.remove()); window.eval('creditSale')() }); await wait(400);
await pg.evaluate(c => window.eval('cpPick')(c), made.cid); await wait(200);
await pg.evaluate(() => window.eval('cpSave')()); await wait(900);
const saved = await pg.evaluate(no => { document.querySelectorAll('.modal').forEach(m => m.remove()); const S = window.eval('S'), again = S.sales.find(x => x.no === no && !x.returnOf); return { n: (again.lines[0].issued || []).length, later: again.lines[0].later, one: S.sales.filter(x => x.no === no).length } }, made.no); await wait(100);
ok(saved.n === 3 && saved.later === 10 && saved.one === 1, 'and a saved edit keeps it', JSON.stringify(saved));

// Goods to collect lists the bill together; the last of it finishes it
await pg.evaluate(() => { window.eval('go')('collect') }); await wait(400);
const rows = await pg.evaluate(no => [...document.querySelectorAll('.card table tr')].filter(r => r.innerText.includes(no)).length, made.no);
ok(rows >= 1, 'Goods to collect has it', String(rows));
await pg.evaluate(no => window.eval('collectIssue')(no), made.no); await wait(250);
await pg.evaluate(() => document.getElementById('ciLarge').click()); await wait(500);
pr = await pg.evaluate(() => window._printed.slice(-1)[0]);
ok(/All goods on this bill have now been given/.test(pr.html), 'the last note says everything has now been given');
st = await pg.evaluate(no => { const S = window.eval('S'), inv = S.sales.find(s => s.no === no); return { pend: window.eval('billPending')(inv) } }, made.no);
ok(st.pend === false, 'and the bill is no longer pending');
await pg.evaluate(no => { window.eval(`billSel=${JSON.stringify(no)}; billType='all'`); window.eval('go')('bills') }, made.no); await wait(400);
t = await paneText();
ok(/All the goods have been given/.test(t) && !(await has('[data-act="colIssueBill"]')), 'the bill says so, and Issue goods has gone');
ok(!(await has('[data-act="billIssueParts"]')), 'Issue in parts does not come back');

// the till: every line at once, and the printed bill says it in one line
await pg.evaluate(() => { const S = window.eval('S'), ps = S.products.filter(p => p.active !== false && p.stock > 40 && p.retail > 0 && !p.serialised && !(p.tiers || []).length).slice(0, 5); S.pos = { ...S.pos, lines: ps.map(p => ({ pid: p.id, qty: 2, price: p.retail, disc: 0 })), customer: 1, billDisc: 0, sel: 0 }; window.eval('go')('pos'); window.eval('csLater')(0) }); await wait(300);
await pg.evaluate(() => document.getElementById('clAll').click()); await wait(250);
ok(await pg.evaluate(() => window.eval('S').pos.lines.every(l => l.later === 2)), 'on the till: Every line on this bill');
const big = await pg.evaluate(() => { const S = window.eval('S'), inv = window.eval('completeSale')({ lines: S.pos.lines.map(l => ({ ...l })), customerId: 1, billDisc: 0, pays: [{ method: 'CASH', amount: window.eval('billTotal')() }] }); S.pos.lines = []; return { no: inv.no, a5: window.eval('billHtml')(inv, 'a5'), r80: window.eval('billHtml')(inv, 'r80'), pend: window.eval('billPending')(inv), later: inv.lines.every(l => l.later === 2) } });
ok(big.later && big.pend, 'the bill is saved with the goods pending', big.no);
ok(/ISSUED IN PARTS/.test(big.a5) && !/Bring this bill to collect/.test(big.a5), 'the large bill says so once, not line by line');
ok(/ISSUED IN PARTS/.test(big.r80), 'and the small bill');

// nothing typed: pending, and no note
const nothing = await pg.evaluate(() => { const S = window.eval('S'), ps = S.products.filter(p => p.active !== false && p.stock > 40 && p.retail > 0 && !p.serialised && !(p.tiers || []).length).slice(0, 2); S.pos.lines = ps.map(p => ({ pid: p.id, qty: 4, price: p.retail, disc: 0 })); const inv = window.eval('completeSale')({ lines: S.pos.lines.map(l => ({ ...l })), customerId: 1, billDisc: 0, pays: [{ method: 'CASH', amount: window.eval('billTotal')() }] }); S.pos.lines = []; return inv.no });
let was = await pg.evaluate(() => window._printed.length);
await pg.evaluate(no => window.eval('billIssueParts')(no), nothing); await wait(250);
await pg.evaluate(() => document.getElementById('ciLarge').click()); await wait(300);
ok((await pg.evaluate(() => window._printed.length)) === was && await pg.evaluate(no => window.eval('billPending')(window.eval('S').sales.find(s => s.no === no)), nothing), 'nothing typed: it all stays pending and nothing prints');
ok(/no delivery note/i.test(await pg.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.innerText).join(' '))), 'and it says so');
// Esc walks away: nothing changed
const left = await pg.evaluate(() => { const S = window.eval('S'), ps = S.products.filter(p => p.active !== false && p.stock > 40 && p.retail > 0 && !p.serialised && !(p.tiers || []).length).slice(0, 2); S.pos.lines = ps.map(p => ({ pid: p.id, qty: 4, price: p.retail, disc: 0 })); const inv = window.eval('completeSale')({ lines: S.pos.lines.map(l => ({ ...l })), customerId: 1, billDisc: 0, pays: [{ method: 'CASH', amount: window.eval('billTotal')() }] }); S.pos.lines = []; return inv.no });
await pg.evaluate(no => window.eval('billIssueParts')(no), left); await wait(250);
await pg.evaluate(() => document.querySelector('.modal [data-act="closeModal"]').click()); await wait(200);
ok(await pg.evaluate(no => !window.eval('S').sales.find(s => s.no === no).lines.some(l => l.later), left), 'Cancel: nothing on the bill changes');

// the real road: printPaper as it is on the till, down to the request that leaves the page
await pg.evaluate(() => { window.printPaper = window._realPrint; window.eval("CFG.print.agent='http://localhost:4100'") });
const send = async (no, paper) => { await pg.evaluate(n => window.eval('billIssueParts')(n), no); await wait(250); await pg.evaluate(() => { document.querySelector('.modal [data-ci]').value = 1 }); await pg.evaluate(p => document.getElementById(p).click(), paper); await wait(1500) };
road.helperUp = true;
await send(left, 'ciLarge');
ok(road.helper.length === 1 && road.helper[0].format === 'a5' && /DELIVERY NOTE/.test(road.helper[0].html) && /^ISN/i.test(road.helper[0].no), 'for real: the large note goes to the print helper', road.helper[0] && road.helper[0].no);
road.helper.length = 0;
await pg.evaluate(n => window.eval('collectIssue')(n), left); await wait(250); await pg.evaluate(() => { document.getElementById('ciNone').click(); document.querySelector('.modal [data-ci]').value = 1; document.getElementById('ciSmall').click() }); await wait(1200);
ok(road.helper.length === 1 && road.helper[0].format === 'r80' && /DELIVERY NOTE/.test(road.helper[0].html), 'for real: the small note goes to the print helper');
// no helper on this PC: the shop's queue
road.helperUp = false; road.queueUp = true;
await pg.evaluate(n => window.eval('collectIssue')(n), left); await wait(250); await pg.evaluate(() => { document.getElementById('ciNone').click(); document.querySelector('.modal [data-ci]').value = 1; document.getElementById('ciLarge').click() }); await wait(1500);
ok(road.queue.length === 1 && /DELIVERY NOTE/.test(road.queue[0].html), 'no helper here: it goes to the shop printer through the server');
// neither: the browser's own print window
road.queueUp = false;
await pg.evaluate(() => { window._winPrint = 0 });
await pg.evaluate(n => window.eval('collectIssue')(n), left); await wait(250); await pg.evaluate(() => { document.getElementById('ciNone').click(); document.querySelector('.modal [data-ci]').value = 1; document.getElementById('ciLarge').click() }); await wait(1500);
ok((await pg.evaluate(() => window._winPrint)) === 1, 'neither there: the browser print window opens, so it never just goes quiet');
await pg.evaluate(() => { window.printPaper = (html, f, no) => { window._printed.push({ html: String(html), f, no }) }; window.eval("CFG.print.agent=''") });

// the size on the paper: drawn on a sheet the width the printers use, as they draw it. It was half this (6 Nov 2026: the small-window zoom)
const sized = await pg.evaluate(() => { const S = window.eval('S'), rec = { no: 'ISN-SIZE', qty: 1, date: '2026-11-06', by: 'Afridh' }, p = S.products.find(x => x.active !== false); return { html: window.eval('printDocument')(window.eval('noteA5')({ no: 'T-SIZE', date: '2026-11-06', customerId: 1, lines: [{ pid: p.id, qty: 5, price: 10, disc: 0, later: 5, issued: [rec] }] }, rec, rec.no), 'a5'), want: Math.max(0.6, Math.min(2, (+window.eval('CFG').bill.a5Scale || 100) / 100)) } });
for (const w of [733, 794]) {
  const sh = await b.newPage(); await sh.setRequestInterception(true); sh.on('request', rq => /^data:|^about:/.test(rq.url()) ? rq.continue() : rq.abort());
  await sh.setViewport({ width: w, height: 800 }); await sh.setContent(sized.html.replace(/<base[^>]*>/, ''), { waitUntil: 'load' }); await sh.emulateMediaType('print');
  const m = await sh.evaluate(() => { document.body.classList.add('direct-print'); const p = document.querySelector('#printArea .print'), td = p.querySelector('table.x-tbl td'), r = p.getBoundingClientRect(), z = parseFloat(getComputedStyle(p).zoom) || 1; return { zoom: z, td: parseFloat(getComputedStyle(td).fontSize), width: r.width } });
  ok(Math.abs(m.zoom - sized.want) < 0.01, w + 'px sheet: the note is at the shop\'s large paper size', JSON.stringify(m));
  ok(m.td * m.zoom >= 13.5, w + 'px sheet: an item line is big enough to read', String(m.td * m.zoom));
  ok(m.width >= w * 0.95, w + 'px sheet: it fills the width of the sheet', String(m.width));
  const lay = await sh.evaluate(() => { const find = t => [...document.querySelectorAll('#printArea td,#printArea div')].filter(e => e.textContent.trim().startsWith(t)).pop().getBoundingClientRect(), a = find('DELIVERY NOTE'), n = find('REGAL'), i = find('Issued by'), d = find('Delivered by'), r = find('Received in good'), c = find('Customer:'), bl = find('Bill:'); return { head: Math.abs(a.top - n.top) < 12 && a.left > n.left, sign: Math.abs(i.top - d.top) < 2 && Math.abs(d.top - r.top) < 2 && i.left < d.left && d.left < r.left, info: Math.abs(c.top - bl.top) < 2 && c.left > bl.left } });
  ok(lay.head, w + 'px sheet: the shop on the left and DELIVERY NOTE on the right, in one row', JSON.stringify(lay));
  ok(lay.sign, w + 'px sheet: the three signatures side by side');
  ok(lay.info, w + 'px sheet: bill and customer side by side');
  await sh.close();
}
await pg.bringToFront();

// an ordinary note stays on one sheet
const ten = await pg.evaluate(async () => { const S = window.eval('S'), ps = S.products.filter(p => p.active !== false).slice(0, 8), rec = { no: 'ISN-TEN', qty: 1, date: '2026-11-06', by: 'Afridh', who: 'Kamal', car: 'WP LA-1234' }; const html = window.eval('printDocument')(window.eval('noteA5')({ no: 'T-TEN', date: '2026-11-06', customerId: S.customers.find(c => c.id !== 1).id, lines: ps.map(p => ({ pid: p.id, qty: 5, price: 10, disc: 0, later: 5, issued: [{ ...rec }] })) }, rec, rec.no), 'a5'); return (await window.eval('a5PageDocs')(html, rec.no)).length });
ok(ten === 1, 'an eight line note fits on one sheet', String(ten));

// a long bill: the note runs on to more sheets, with the letterhead on the first only, each row once and the signatures on the last
const long = await pg.evaluate(async () => {
  const S = window.eval('S'), ps = S.products.filter(p => p.active !== false).slice(0, 26);
  const rec = { no: 'ISN-TEST', qty: 1, date: '2026-11-06', by: 'Afridh', who: 'Kamal', car: 'WP LA-1234' };
  const inv = { no: 'T-LONG', date: '2026-11-06', customerId: 1, lines: [] };
  for (let i = 0; i < 40; i++) { const p = ps[i % ps.length]; inv.lines.push({ pid: p.id, qty: 5, price: 10, disc: 0, later: 5, issued: i % 2 ? [] : [{ ...rec }] }) }
  const html = window.eval('printDocument')(window.eval('noteA5')(inv, rec, rec.no), 'a5');
  const docs = await window.eval('a5PageDocs')(html, rec.no);
  return docs.map(h => { const d = new DOMParser().parseFromString(h, 'text/html'), top = d.querySelector('#printArea'); return { rows: top.querySelectorAll('table.x-tbl tbody tr').length, head: /REGAL|DELIVERY NOTE/i.test(top.textContent), sign: /Received in good order/.test(top.textContent), page: (top.querySelector('.a5-pg') || {}).textContent || '' } });
});
ok(long.length >= 2, 'a 40 line note runs on to more sheets', long.map(p => p.rows).join('+'));
ok(long.reduce((a, p) => a + p.rows, 0) === 40, 'every row on it, once');
ok(long[0].head && long.slice(1).every(p => !p.head), 'the letterhead on the first sheet only');
ok(long.slice(0, -1).every(p => !p.sign) && long[long.length - 1].sign, 'the signatures on the last sheet');
ok(long.every((p, i) => p.page.startsWith('Page ' + (i + 1))) && !/Bill ISN/.test(long[1].page), 'each sheet says its page, and does not call the note a bill', long[1].page);
ok(errs.length === 0, 'no errors in the page', errs.join(' | '));
await wait(500); await pg.evaluate(() => window.eval('persist')(true)); await wait(2500);
await b.close();
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
