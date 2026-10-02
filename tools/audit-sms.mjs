// Can anything text a number the shop has not allowed?
//   node tools/audit-sms.mjs
//
// While the shop is trying a gateway out it names the only number messages may go to. A
// shop has a book full of real customers' numbers in it, so a limit that holds on one path
// and not another is worse than none: it is believed. This checks the rule itself, and
// then checks that every path which can reach a provider asks it.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const mod = f => import(pathToFileURL(path.resolve(process.cwd(), f)).href);
const { intlPhone, heldByTestMode, whyHeld } = await mod('server/src/lib/phone.js');

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) };

/* ---------- 1. one number, written every way a person writes it ---------- */
const MINE = '0777849964';
for (const shape of ['0777849964', '94777849964', '+94777849964', '077 784 9964', '077-784-9964', '777849964', '+94 77 784 9964'])
  ok(intlPhone(shape) === '94777849964', `"${shape}" is the same number`);

const cfg = { testOnly: MINE };
for (const shape of ['0777849964', '94777849964', '+94777849964', '077 784 9964', '777849964'])
  ok(heldByTestMode(cfg, shape) === false, `a message to "${shape}" goes`);

/* ---------- 2. and nothing else gets through ---------- */
for (const other of ['0771234567', '0712345678', '94761111111', '0777849965', '0777849', ''])
  ok(heldByTestMode(cfg, other) === true, `a message to "${other || '(nothing)'}" is held`);
ok(/only go to 0777849964/.test(whyHeld(cfg, '0771234567') || ''), 'and it says why, naming the number that is allowed');
ok(whyHeld(cfg, MINE) === null, 'the allowed number is not held');

/* ---------- 3. more than one number, and no limit at all ---------- */
const two = { testOnly: '0777849964, 0711111111' };
ok(!heldByTestMode(two, '0777849964') && !heldByTestMode(two, '0711111111'), 'two numbers may both be listed');
ok(heldByTestMode(two, '0722222222'), 'and a third is still held');
for (const empty of [{}, { testOnly: '' }, { testOnly: '   ' }, null, undefined])
  ok(heldByTestMode(empty, '0771234567') === false, 'with nothing set there is no limit');

/* ---------- 4. every path that can reach a provider asks first ---------- */
const bodyOf = (src, startsWith) => {
  const a = src.indexOf(startsWith);
  if (a < 0) return null;
  let i = src.indexOf('{', a), d = 0, end = -1;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { end = i; break } } }
  return end < 0 ? null : src.slice(a, end + 1);
};
const guards = [
  ['server/src/routes/regal.js', 'export async function sendViaProvider', 'heldByTestMode', 'the shop server, texting'],
  ['server/src/routes/regal.js', 'export async function sendViaWhatsApp', 'heldByTestMode', 'the shop server, WhatsApp'],
  ['server/src/services/sms.js', 'export async function sendNow', 'whyHeld', 'the outbox, sending one now'],
  ['server/src/services/sms.js', 'export function startSmsWorker', 'whyHeld', 'the outbox worker, draining the queue'],
  ['app/index.html', 'async function smsSend', 'heldHere', 'the till, when it sends for itself']
];
for (const [file, fn, guard, what] of guards) {
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const body = bodyOf(src, fn);
  if (!body) { ok(false, `${what}: could not find ${fn} in ${file}`); continue }
  ok(body.includes(guard), `${what} asks before it sends`);
}

/* nothing else in the server may call a gateway on its own */
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p);
  }
})('server/src');
const rogue = files.filter(f => {
  const s = fs.readFileSync(f, 'utf8');
  // only a file that calls a gateway ITSELF; one that hands the job to a guarded
  // function (sendNow, sendViaProvider) is already covered by that function
  if (!s.includes('fetch(')) return false;
  if (!/smslenz|send-sms|sender_id/i.test(s)) return false;
  return !/heldByTestMode|whyHeld/.test(s);
});
ok(rogue.length === 0, rogue.length
  ? `these reach a gateway without asking: ${rogue.join(', ')}`
  : 'no other file on the server reaches a gateway on its own');

/* ---------- 5. the two copies of the rule agree ---------- */
const app = fs.readFileSync('app/index.html', 'utf8').replace(/\r\n/g, '\n');
const tillRule = bodyOf(app, 'function heldHere');
const tillIntl = (app.match(/^const intlHere=.*$/m) || [])[0];   // the whole line: it has semicolons inside it
ok(!!tillRule && !!tillIntl, 'the till carries its own copy of the rule');
if (tillRule && tillIntl) {
  const f = new Function(`${tillIntl}\n${tillRule}\nreturn heldHere`)();
  const shapes = ['0777849964', '94777849964', '+94777849964', '077 784 9964', '777849964',
                  '0771234567', '', '0712345678'];
  const same = shapes.every(s => f(cfg, s) === heldByTestMode(cfg, s))
            && shapes.every(s => f({}, s) === heldByTestMode({}, s))
            && shapes.every(s => f(two, s) === heldByTestMode(two, s));
  ok(same, 'and it gives the same answer as the server for every number tried');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
