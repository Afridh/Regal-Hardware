// A bill's camera keeping: a cash bill's pictures for a month, a credit bill's pictures and a short
// clip from the recorder for four months — and gone from the server once their time is up.
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010)
//   node backend/tools/check-billkeep.mjs [a-jpeg] [an-mp4]
// Talks to the test server only, as the till and as the camera helper (with the test server's key).
// With CLIP_FROM_HELPER=1 it leaves the clip to a camera helper pointed at the test server instead,
// and waits for it to arrive.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || 'http://localhost:4010';
const env = Object.fromEntries(fs.readFileSync(path.join(here, '../../server/.env'), 'utf8').split(/\r?\n/).map(l => /^\s*([A-Z_]+)\s*=\s*(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const KEY = env.PRINT_DEVICE_KEY || env.SHIFT_DEVICE_KEY;
const JPEG = fs.readFileSync(process.argv[2]), MP4 = process.argv[3] ? fs.readFileSync(process.argv[3]) : null;
let pass = 0, fail = 0; const ok = (c, m, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };
const days = (d) => Math.round((new Date(d) - Date.now()) / 864e5);

const login = await (await fetch(BASE + '/api/books/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: 'Afridh', password: 'Afridh123' }) })).json();
const tok = login.token; ok(!!tok, 'signed in to the test server as the till');
const till = (p, body) => fetch(BASE + '/api/cams/' + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
const dev = (p, q = '', body, type) => fetch(`${BASE}/api/cams/${p}?key=${encodeURIComponent(KEY)}${q}`, body ? { method: 'POST', headers: { 'Content-Type': type }, body } : {});

const tag = Date.now().toString(36).slice(-5), CASH = 'KC' + tag, CRED = 'KR' + tag;
const a = await till('shot', { ch: '101', ref: CASH, count: 2, credit: false, at: Date.now() });
ok(a.keepDays === 31 && !a.clip, 'a cash bill: pictures kept 31 days, no clip', JSON.stringify(a));
const BILL_AT = Date.now() - 15 * 60000;   // a quarter of an hour ago: the recorder can play it back by now
const b = await till('shot', { ch: '101', ref: CRED, count: 2, credit: true, at: BILL_AT });
ok(b.keepDays === 122 && b.clip === 30, 'a credit bill: pictures and a 30 s clip kept 122 days', JSON.stringify(b));

let clip = null;
if (process.env.CLIP_FROM_HELPER) {
  // a real camera helper, pointed at this test server, does it all: the pictures off the recorder, then
  // the clip from the recorder's recording — nothing is asked of the server here that would take its job
  let got = null;
  for (let i = 0; i < 40 && !got; i++) { await new Promise(r => setTimeout(r, 5000)); const r = await till('shots/' + CRED); if ((r.clips || []).length && r.shots.length === 2) got = r; }
  ok(!!got, 'the camera helper took the pictures and made the clip from the recorder, and sent them');
} else {
  // the helper's part played here: the pictures, and the clip job looked at
  const jobs = await (await dev('jobs')).json();
  const mine = (jobs.shots || []).filter(s => s.ref === CASH || s.ref === CRED);
  ok(mine.length === 2, 'the helper is asked for both bills\' pictures');
  for (const s of mine) for (let i = 0; i < s.left; i++) await dev('frame', `&ch=${s.ch}&shot=${s.id}`, JPEG, 'image/jpeg');
  clip = (jobs.clips || []).find(c => c.ref === CRED);
  ok(!!clip && !(jobs.clips || []).some(c => c.ref === CASH), 'and for a clip of the credit bill only');
  ok(clip && Math.abs(new Date(clip.start) - (BILL_AT - 15000)) < 5000 && clip.secs === 30, 'from 15 s before the bill, for 30 s', clip && clip.start);
}
const sc = await till('shots/' + CASH);
ok(sc.shots.length === 2 && sc.shots.every(s => days(s.until) === 31), 'the cash bill\'s pictures say: kept 31 days', sc.shots.map(s => days(s.until)).join(','));
if (clip && MP4) {
  const r = await dev('clip', `&id=${clip.id}`, MP4, 'video/mp4');
  ok(r.ok, 'the clip is taken by the server', (MP4.length / 1024).toFixed(0) + ' KB');
}
const sr = await till('shots/' + CRED);
ok(sr.shots.length === 2 && sr.clips.length === 1 && [...sr.shots, ...sr.clips].every(s => days(s.until) === 122), 'the credit bill: 2 pictures and the clip, kept 122 days',
  `${sr.shots.length} pictures, ${(sr.clips || []).length} clip`);
if (sr.clips && sr.clips[0]) {
  const v = await fetch(BASE + sr.clips[0].url, { headers: { Range: 'bytes=0-999' } });
  ok(v.status === 206 && v.headers.get('content-type') === 'video/mp4' && (await v.arrayBuffer()).byteLength === 1000, 'the clip plays a part at a time (206, video/mp4)');
  const full = await fetch(BASE + sr.clips[0].url);
  fs.writeFileSync(path.join(process.env.TEMP || '.', 'billkeep-clip.mp4'), Buffer.from(await full.arrayBuffer()));
}

// time up: the files go (the test server's own database, made to look old)
const pg = (await import(path.join(here, '../node_modules/pg/lib/index.js').replace(/\\/g, '/').replace(/^([A-Z]):/, 'file:///$1:'))).default;
const db = new pg.Client({ connectionString: env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/sepos_e2e$1') });
await db.connect();
await db.query(`UPDATE files SET keep_until = now() - interval '1 minute' WHERE ref = $1`, [CASH]);
await db.query(`UPDATE files SET keep_until = now() + interval '1 day' WHERE ref = $1`, [CRED]);
await db.end();
// the tidy runs once an hour on the server: a fresh test server has not run it yet past its first ask,
// so it is checked by what the next hourly pass would remove
const { default: pg2 } = { default: pg };
const db2 = new pg2.Client({ connectionString: env.DATABASE_URL.replace(/\/[^/?]+(\?|$)/, '/sepos_e2e$1') }); await db2.connect();
const gone = await db2.query(`SELECT count(*)::int n FROM files WHERE keep_until IS NOT NULL AND keep_until < now() AND ref = $1`, [CASH]);
const kept = await db2.query(`SELECT count(*)::int n FROM files WHERE (keep_until IS NULL OR keep_until >= now()) AND ref = $1`, [CRED]);
await db2.query(`DELETE FROM files WHERE keep_until IS NOT NULL AND keep_until < $1`, [new Date()]);   // the same statement tidy() runs
const left = await db2.query(`SELECT ref, count(*)::int n FROM files WHERE ref IN ($1, $2) GROUP BY ref`, [CASH, CRED]);
await db2.end();
ok(gone.rows[0].n === 2 && kept.rows[0].n === 3, 'past its time: the cash bill\'s pictures are due to go, the credit bill\'s are not');
ok(!left.rows.some(r => r.ref === CASH) && (left.rows.find(r => r.ref === CRED) || {}).n === 3, 'and the tidy removes exactly those', JSON.stringify(left.rows));
console.log(`\n${pass} passed, ${fail} failed`);
