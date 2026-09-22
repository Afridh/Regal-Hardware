// Fetch the print helper's rendering of the latest bill without printing it.
//   node tools/agent-preview.mjs r80 out.png
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [format = 'r80', out = 'agent-preview.png'] = process.argv.slice(2);
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: exe, headless: true });
const pg = await b.newPage(); await pg.goto('http://localhost:4000/pos', { waitUntil: 'networkidle2' });
await pg.waitForSelector('#lockScreen'); await pg.click('[data-user="Afridh"]'); await pg.waitForSelector('#lockPw'); await pg.type('#lockPw', 'Afridh123'); await pg.click('#lockGo');
await pg.waitForFunction(() => !document.getElementById('lockScreen')); await new Promise(r => setTimeout(r, 800));
const html = await pg.evaluate(f => { const inv = S.sales.slice().reverse().find(s => s.lines.length >= 3) || S.sales.at(-1); return billDocument({ ...inv, proof: true }, f); }, format);
await b.close();
const r = await fetch('http://localhost:4100/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format, html }) });
if (!r.ok) { console.error('preview failed', r.status, await r.text()); process.exit(1); }
fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
console.log('wrote', out);
