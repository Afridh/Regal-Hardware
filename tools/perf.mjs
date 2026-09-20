// How long each page takes to draw, and where the time goes — run against the live till.
//   node tools/perf.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const BASE = 'http://localhost:4000';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] });
const pg = await b.newPage(); await pg.setViewport({ width: 1366, height: 800 });
await pg.goto(BASE + '/pos', { waitUntil: 'networkidle2' });
await pg.waitForSelector('#lockScreen'); await pg.click('[data-user="Afridh"]'); await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'afridh123'); await pg.click('#lockGo');
await pg.waitForFunction(() => !document.getElementById('lockScreen')); await new Promise(r => setTimeout(r, 1000));
const views = process.argv.slice(2).length ? process.argv.slice(2) : ['dashboard', 'pos', 'customers', 'products', 'inventory', 'suppliers', 'purchases', 'accounting', 'reports', 'settings', 'site', 'site/products', 'weborders'];
for (const v of views) {
  const r = await pg.evaluate(async (v) => {
    const [view, tab] = v.split('/'); if (tab && view === 'site') siteTab = tab; if (tab && view === 'settings') setTab = tab;
    const t0 = performance.now(); go(view); const t1 = performance.now();
    const t2 = performance.now(); const s = snapshotTxt(); const t3 = performance.now();
    return { render: Math.round(t1 - t0), snapshot: Math.round(t3 - t2), snapshotKB: Math.round(s.length / 1024), nodes: document.getElementById('main').querySelectorAll('*').length, imgs: document.getElementById('main').querySelectorAll('img').length };
  }, v);
  console.log(v.padEnd(14), `render ${String(r.render).padStart(5)} ms   snapshot ${String(r.snapshot).padStart(4)} ms (${r.snapshotKB} KB)   nodes ${r.nodes}   imgs ${r.imgs}`);
}
await b.close();
