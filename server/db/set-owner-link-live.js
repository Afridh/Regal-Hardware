// Add the bill's link to the owner's copy of a bill on the LIVE site, so the owner's cash-bill text
// carries a link to see the bill — without touching anything else on the live site.
//
//   node db/set-owner-link-live.js --site https://www.regalhw.lk --user Afridh --pass Afridh123
//   node db/set-owner-link-live.js --site https://www.regalhw.lk --user Afridh --pass Afridh123 --go
//
// Without --go it only looks and reports. With --go it changes one line of wording — the owner's copy
// template — and nothing else. It leaves a template that has already been changed by hand alone.
import 'dotenv/config';
import { pool } from '../src/db.js';   // only so the process ends cleanly; the site is reached over its API

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const site = (opt('--site') || '').replace(/\/$/, ''); const user = opt('--user'); const pass = opt('--pass'); const GO = args.includes('--go');
if (!site || !user || !pass) { console.error('usage: node db/set-owner-link-live.js --site https://your-site --user NAME --pass PASSWORD [--go]'); process.exit(1); }

const OLD = '{shop}: {kind} {invoice} {total} — {customer}, by {by}{balancePart}';
const NEW = OLD + ' — see it at {link}';

const login = await (await fetch(site + '/api/books/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, password: pass }) })).json();
if (!login.ok) { console.error('Could not sign in:', JSON.stringify(login).slice(0, 200)); process.exit(2); }
console.log(`Signed in to ${site} as ${login.j?.user?.name || login.user?.name}`);
const token = login.token;
const cur = await (await fetch(site + '/api/books/regal', { headers: { Authorization: 'Bearer ' + token } })).json();
if (!cur?.data?.CFG?.tpl?.ownerBill) { console.error('The owner-copy template is not on the live site.'); process.exit(3); }
const tpl = cur.data.CFG.tpl.ownerBill;
console.log(`\nLive owner copy now:\n  ${tpl.text}`);
console.log(`owner gets which bills: ${cur.data.CFG.msg?.ownerBills} · texting live: ${cur.data.CFG.msg?.live} · owner # set: ${!!cur.data.CFG.shop?.owner}`);

if (tpl.text.includes('{link}')) { console.log('\nIt already carries the link. Nothing to do.'); await pool.end().catch(() => {}); process.exit(0); }
if (tpl.text !== OLD) { console.log('\nThis wording has been changed by hand, so it is left alone. Add {link} where you want it, e.g. at the end.'); await pool.end().catch(() => {}); process.exit(0); }
console.log(`\nWould become:\n  ${NEW}`);
if (!GO) { console.log('\nLook only — nothing changed. Add --go to apply.'); await pool.end().catch(() => {}); process.exit(0); }

tpl.text = NEW;
if (tpl.vars && !tpl.vars.includes('{link}')) tpl.vars = tpl.vars + ' {link}';
const put = await fetch(site + '/api/books/regal', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ data: cur.data, rev: Number(cur.rev || 0) }) });
const pj = await put.json().catch(() => ({}));
if (!pj.ok) { console.error('Not saved:', put.status, JSON.stringify(pj).slice(0, 200)); process.exit(4); }
console.log(`\nDone — rev ${pj.rev}. The owner's cash-bill text now ends "… see it at <link>".`);
await pool.end().catch(() => {});
