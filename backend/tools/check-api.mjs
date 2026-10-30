// Every API route, called once: none may crash (5xx) or hang, and none that needs a sign-in may answer without one.
//  · reads the routes straight from backend/src/routes/*.js and the mount points from app.js, so a new route is in it
//  · GETs are called signed in (the till's token and the old API's token) and signed out
//  · POST / PUT / DELETE are sent an empty body: a missing field must be a 4xx, never a crash
//  · anything that would text, mail, post, call the AI or flip maintenance is left alone
//   node backend/tools/run-e2e.mjs --keep        (the test server on :4010, the tests' sample shop)
//   node backend/tools/check-api.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const BASE = process.env.BASE || 'http://localhost:4010';
const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
let pass = 0, fail = 0; const bad = [];
const ok = (c, m, x = '') => { c ? pass++ : (fail++, bad.push(m + (x ? '  ' + x : ''))); if (!c || process.env.V) console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  ' + x : '')) };

// the mount points, from app.js
const app = fs.readFileSync(path.join(src, 'app.js'), 'utf8');
const imports = Object.fromEntries([...app.matchAll(/import\s+(?:\{?\s*(?:default as\s+)?)?(\w+)[^'"]*from\s+['"]\.\/routes\/(\w+)\.js['"]/g)].map(m => [m[1], m[2]]));
const mounts = [];
for (const m of app.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(?:(authenticate)\s*,\s*)?(\w+)\s*\)/g)) if (imports[m[3]]) mounts.push({ base: m[1], file: imports[m[3]], legacy: !!m[2] });
// master.js mounts several routers of its own
const routes = [];
for (const { base, file, legacy } of mounts) {
  const t = fs.readFileSync(path.join(src, 'routes', file + '.js'), 'utf8');
  const sub = Object.fromEntries([...t.matchAll(/r\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g)].map(m => [m[2], m[1]]));
  for (const m of t.matchAll(/^\s*(\w+)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]\s*,([^\n]*)/gm)) {
    const pre = m[1] === 'r' || m[1] === 'router' ? '' : (sub[m[1]] ?? null); if (pre === null) continue;
    const open = !/regalAuth|supAuth|custAuth|shopAuth|shiftAuth|requirePerm|mayFlip/.test(m[4]) && !legacy;
    routes.push({ method: m[2].toUpperCase(), path: (base + pre + m[3]).replace(/\/+$/, '') || '/', file, legacy, open, line: m[4] });
  }
  // the lists made by crudRouter (categories, suppliers, customers …): a list, and one of them
  for (const m of t.matchAll(/r\.use\(\s*['"]([^'"]+)['"]\s*,\s*crudRouter\(/g))
    for (const p of ['', '/:id']) routes.push({ method: 'GET', path: base + m[1] + p, file, legacy, open: false, line: '' });
}
console.log(`${routes.length} routes in ${mounts.length} files`);

// left alone: they send something to the outside world, or change the whole shop
const SKIP = [/\/sms\/(test|send)$/, /\/wa\/(send|templates\/create)$/, /\/social\/post$/, /\/mail\/(send|test)$/, /^\/api\/ai\/ask$/, /^\/api\/alexa/,
  /^\/api\/maintenance$/, /\/books\/:key$/, /\/restore\//, /\/invite(-all|\/)/, /\/otp(-send|-login)?$/, /\/forgot$/, /\/ask-code$/, /^\/api\/dues\/(run|one)$/,
  /\/books\/(login|pin-login|shift-login|shift-pin|shift-otp|refresh)$/, /^\/api\/auth\/login$/, /\/(signin|login)$/, /\/change-password$/, /\/password$/, /^\/api\/print$/];

const fill = p => p.replace(/:key/g, 'regal').replace(/:screen/g, '1').replace(/:day/g, new Date().toISOString().slice(0, 10)).replace(/:ch/g, '1').replace(/:\w+/g, '1');
const call = async (method, url, tok, body) => {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 15000);
  try {
    const r = await fetch(BASE + url, { method, signal: ac.signal, headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    const txt = await r.text(); return { s: r.status, txt: txt.slice(0, 160) };
  } catch (e) { return { s: 0, txt: e.name === 'AbortError' ? 'timed out (15 s)' : e.message } } finally { clearTimeout(t) }
};

// signed in, both ways
const books = await (await fetch(BASE + '/api/books/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: 'Afridh', password: 'Afridh123' }) })).json();
ok(books.token, 'the till signs in', books.error || '');
let legacy = null;
for (const [u, p] of [['admin', 'admin123'], ['admin', process.env.SEED_ADMIN_PASSWORD || 'admin123']]) {
  const r = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) })).json().catch(() => ({}));
  if (r.token) { legacy = r.token; break }
}
ok(legacy, 'the old API signs in (admin)');

for (const rt of routes) {
  const url = fill(rt.path), name = `${rt.method} ${rt.path}`;
  if (SKIP.some(x => x.test(rt.path))) { if (process.env.V) console.log('SKIP ' + name); continue }
  const tok = rt.legacy ? legacy : books.token;
  if (rt.method === 'GET') {
    const r = await call('GET', url, tok);
    ok(r.s && r.s < 500, name + ' signed in', `${r.s} ${r.s >= 500 || !r.s ? r.txt : ''}`);
    if (!rt.open) { const o = await call('GET', url, null); ok(o.s === 401 || o.s === 403, name + ' needs a sign-in', `${o.s} ${o.s < 400 ? o.txt : ''}`) }
  } else {
    const r = await call(rt.method, url, tok, {});
    ok(r.s && r.s < 500, name + ' with an empty body', `${r.s} ${r.s >= 500 || !r.s ? r.txt : ''}`);
    if (!rt.open) { const o = await call(rt.method, url, null, {}); ok(o.s === 401 || o.s === 403, name + ' needs a sign-in', `${o.s} ${o.s < 400 ? o.txt : ''}`) }
  }
}
// and the pages
for (const p of ['/', '/pos', '/shift', '/count1', '/driver', '/stockup', '/supplier', '/my', '/b/x']) { const r = await call('GET', p); ok(r.s === 200, 'page ' + p, String(r.s)) }
console.log(`\n${pass} passed, ${fail} failed`); if (bad.length) console.log(bad.map(b => '  ✗ ' + b).join('\n'));
