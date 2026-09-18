// Screenshot the classic till in a real browser (Edge/Chrome via puppeteer-core).
//   node tools/shot.mjs [out.png] [width] [height]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = 'http://localhost:4000';
const out = process.argv[2] || 'till.png', W = +(process.argv[3] || 1366), H = +(process.argv[4] || 768);
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: W, height: H });
await pg.goto(BASE + (process.argv[5] === 'shop' ? '/' : '/pos'), { waitUntil: 'networkidle2' });
if (process.argv[5] === 'shop') { await new Promise(r => setTimeout(r, 800)); await pg.screenshot({ path: out }); await b.close(); console.log('wrote ' + out); process.exit(0); }
await pg.waitForSelector('#lockScreen', { timeout: 15000 });
await pg.click('[data-user="Afridh"]'); await pg.waitForSelector('#lockPw');
await pg.type('#lockPw', 'afridh123'); await pg.click('#lockGo');
await pg.waitForFunction(() => !document.getElementById('lockScreen'), { timeout: 15000 });
await new Promise(r => setTimeout(r, 800));
await pg.evaluate(() => { go('pos'); csStart(1); csCommit(); csStart(2); csCommit(); csStart(3); csCommit(); });
await new Promise(r => setTimeout(r, 300));
if (process.argv[5] === 'hits') { await pg.focus('#csQ'); await pg.keyboard.type('ce'); await new Promise(r => setTimeout(r, 300)); }
if (process.argv[5] === 'edit') { await pg.evaluate(() => csLineEdit(1)); await new Promise(r => setTimeout(r, 300)); }
if ((process.argv[5] || '').startsWith('view:')) {           // any other page, e.g. view:customers
  const v = process.argv[5].slice(5);
  await pg.evaluate(v => { S.pos = { lines: [], customer: null, billDisc: 0, sel: -1, entry: null, lastBill: S.pos.lastBill }; const [view, tab] = v.split('/'); if (tab && view === 'customers') custTab = tab; go(view); }, v);
  await new Promise(r => setTimeout(r, 500));
  await pg.screenshot({ path: out, fullPage: process.argv[6] === 'full' }); await b.close(); console.log('wrote ' + out); process.exit(0);
}
const m = await pg.evaluate(() => ({ pageScroll: document.documentElement.scrollHeight > window.innerHeight, mainScroll: document.getElementById('main').scrollHeight > document.getElementById('main').clientHeight, list: (() => { const l = document.querySelector('.till-lines'); return l ? l.scrollHeight + '/' + l.clientHeight : '-' })(), sum: document.querySelector('.till-sum')?.getBoundingClientRect().width, header: getComputedStyle(document.querySelector('header')).display }));
console.log(JSON.stringify(m));
await pg.screenshot({ path: out }); await b.close();
console.log('wrote ' + out);
