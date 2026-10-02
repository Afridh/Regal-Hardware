// Text the link to a bill that already exists, to try out what a customer receives.
//
//   REGAL_USER=Afridh REGAL_PASS=... node tools/send-bill-link.mjs 0777849964
//
//   --bill INV-...   a particular bill, instead of the newest cash one
//   --base URL       another server (default https://regalhw.lk)
//   --dry            show what would be sent, and send nothing
//
// It makes no bill and posts nothing to the ledger: it finds a bill the shop already has,
// builds the same message the till would send, and asks the shop's own server to send it
// with the shop's own provider. The password is read from the environment so it never
// lands in a command history or a file.
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d };
const has = k => args.includes('--' + k);
const to = args.find(a => !a.startsWith('--') && /^\d[\d\s-]{8,}$/.test(a));

const BASE = (flag('base', process.env.REGAL_BASE || 'https://regalhw.lk')).replace(/\/+$/, '');
const USER = process.env.REGAL_USER, PASS = process.env.REGAL_PASS;

if (!to) { console.error('Which number? e.g.  node tools/send-bill-link.mjs 0777849964'); process.exit(1) }
if (!USER || !PASS) { console.error('Set REGAL_USER and REGAL_PASS first — they are read from the environment, not typed here.'); process.exit(1) }

const digits = s => String(s || '').replace(/\D/g, '');
const intl = s => { const d = digits(s); return d.startsWith('94') ? d : d.replace(/^0/, '94') };
if (!/^94\d{9}$/.test(intl(to))) { console.error(`${to} is not a Sri Lankan mobile.`); process.exit(1) }

const money = n => 'Rs ' + Number(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const post = async (path, body, token) => {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body)
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t) } catch {}
  return { status: r.status, body: j, raw: t };
};

/* ---- in ---- */
const login = await post('/api/books/login', { user: USER, password: PASS });
if (!login.body?.token) {
  console.error(`Could not sign in as ${USER} (${login.status}): ${login.body?.error || login.raw.slice(0, 120)}`);
  process.exit(1);
}
const token = login.body.token;
console.log(`signed in to ${BASE} as ${USER}`);

/* ---- the books, read only ---- */
const booksRes = await fetch(BASE + '/api/books/regal', { headers: { Authorization: 'Bearer ' + token } });
const books = await booksRes.json();
const data = books?.data || books;
const S = data?.S || {}, CFG = data?.CFG || {};
if (!Array.isArray(S.sales)) { console.error('The books came back without any bills on them.'); process.exit(1) }

/* ---- which bill ---- */
const want = flag('bill', null);
const bill = want
  ? S.sales.find(s => String(s.no) === want)
  : [...S.sales].reverse().find(s => s.type === 'CASH' && s.link);
if (!bill) { console.error(want ? `No bill ${want}.` : 'No cash bill with a link on it yet — make one at the till first.'); process.exit(1) }
if (!bill.link) { console.error(`${bill.no} has no link on it; it was made before links were added.`); process.exit(1) }

/* ---- the same words the till would send ---- */
const tpl = CFG.msg?.templates?.billLink?.text
  || '{shop}: your bill {invoice} for {total}{balancePart} — {link}';
const link = /^https?:\/\//.test(bill.link) ? bill.link : 'https://' + bill.link;
const message = tpl
  .replace(/{shop}/g, CFG.shop?.name || 'Regal Hardware')
  .replace(/{invoice}/g, bill.no)
  .replace(/{total}/g, money(bill.total))
  .replace(/{balance}/g, money(bill.balance))
  .replace(/{balancePart}/g, +bill.balance > 0.005 ? `, ${money(bill.balance)} still to pay` : '')
  .replace(/{link}/g, link);

console.log(`\n  bill     ${bill.no}  ${bill.date}  ${money(bill.total)}  ${bill.type}`);
console.log(`  link     ${link}`);
console.log(`  to       ${to}  (${intl(to)})`);
console.log(`  message  ${message}\n`);

/* ---- what the shop's own settings will do with it ---- */
const msg = CFG.msg || {};
if (!msg.apiUrl || !msg.apiKey) {
  console.error('The shop has no SMS provider set up (Settings → Messaging), so nothing can go out.');
  process.exit(1);
}
if (!msg.live) console.log('note: live sending is off in Settings → Messaging; sending anyway, as a test.');
if (msg.testOnly && digits(msg.testOnly) !== digits(to))
  console.log(`note: test mode is on and only ${msg.testOnly} is allowed — this will be held.`);

if (has('dry')) { console.log('--dry: nothing sent.'); process.exit(0) }

/* ---- out ---- */
const sent = await post('/api/sms/send', { to, message, test: true }, token);
if (sent.body?.ok) console.log(`sent — the provider said: ${String(sent.body.status || 'ok').slice(0, 120)}`);
else {
  console.log(`not sent (${sent.status}): ${sent.body?.status || sent.body?.error || sent.raw.slice(0, 160)}`);
  process.exit(1);
}
