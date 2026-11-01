// The break watch texts someone over their break once — even though the hosting restarts the app every five
// minutes, and even if a till's save lays an older copy of the day over the "warned" mark in the books.
//   (the local PostgreSQL running: cd server; npm run db:local — and run-e2e has made the sepos_e2e database)
//   node backend/tools/check-breakwatch.mjs
// It starts its own server on :4012 against sepos_e2e, stops it and starts it again, and counts the texts that
// reach a stand-in gateway on :4019. Nothing real is sent.
import { spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
const here = path.dirname(fileURLToPath(import.meta.url)), serverDir = path.resolve(here, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(serverDir, '.env'), 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }));
const url = new URL(env.DATABASE_URL); url.pathname = '/sepos_e2e';
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const wait = ms => new Promise(r => setTimeout(r, ms));
const texts = []; const gw = http.createServer((q, s) => { let b = ''; q.on('data', d => b += d); q.on('end', () => { texts.push(Object.fromEntries(new URLSearchParams(b))); s.setHeader('Content-Type', 'application/json'); s.end('{"success":true}') }) });
await new Promise(r => gw.listen(4019, '127.0.0.1', r));
const db = new pg.Client({ connectionString: url.href }); await db.connect();

// someone an hour into a 30-minute lunch, with a mobile; sending on, through the stand-in
const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' });
const { rows: [row] } = await db.query(`SELECT data FROM books WHERE key = 'regal'`);
const data = row.data, S = data.S, CFG = data.CFG;
const keep = JSON.stringify({ msg: CFG.msg, shift: S.shift });
CFG.msg = { ...CFG.msg, live: true, apiUrl: 'http://127.0.0.1:4019/send', apiKey: 't', provider: 'test', testOnly: '', staffBreakOver: true };
const e = S.employees.find(x => x.active !== false); e.phone = e.phone || '0771230001';
S.shift = S.shift || {}; S.shift.settings = { ...(S.shift.settings || {}), breaks: [{ id: 'bwT', name: 'Lunch', mins: 30 }] };
S.shift.days = S.shift.days || {}; S.shift.days[day] = { ...(S.shift.days[day] || {}), [e.id]: { status: 'work', in: '08:00', breaks: [{ id: 'bwT', name: 'Lunch', start: '09:00', startAt: Date.now() - 60 * 60000 }] } };
await db.query(`UPDATE books SET data = $1 WHERE key = 'regal'`, [data]);
await db.query(`DELETE FROM break_warned`).catch(() => {});

const start = () => { const p = spawn(process.execPath, ['src/index.js'], { cwd: serverDir, env: { ...process.env, ...env, DATABASE_URL: url.href, PORT: '4012', JWT_SECRET: 'e2e-secret' }, stdio: 'ignore' }); return p };
const mine = () => texts.filter(t => /break time is over/.test(t.text || '')).length;
let srv = start();
for (let i = 0; i < 40 && !mine(); i++) await wait(2000);     // the watch runs once a minute
ok(mine() === 1, 'over their break: one text', `${mine()} text(s)`);
srv.kill(); await wait(1500);
// a till's save lays an older copy of the day over the mark in the books
const { rows: [r2] } = await db.query(`SELECT data FROM books WHERE key = 'regal'`);
const b2 = r2.data.S.shift.days[day][e.id].breaks[0]; const marked = !!b2.warnedAt; delete b2.warnedAt;
await db.query(`UPDATE books SET data = $1 WHERE key = 'regal'`, [r2.data]);
ok(marked, 'the break was marked as warned in the books');
// the hosting starts the app again: nobody is told twice
srv = start(); await wait(70000);
ok(mine() === 1, 'the app starts again and the mark is gone from the books: still only one text', `${mine()} text(s)`);
srv.kill();
// put the shop's settings back
const { rows: [r3] } = await db.query(`SELECT data FROM books WHERE key = 'regal'`);
const k = JSON.parse(keep); r3.data.CFG.msg = k.msg; r3.data.S.shift = k.shift;
await db.query(`UPDATE books SET data = $1 WHERE key = 'regal'`, [r3.data]);
await db.end(); gw.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
