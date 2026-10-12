/* ====================== THE ECHO IN THE OFFICE ======================
   A private Alexa skill, pointed at this server. It answers three kinds of question and reads
   out what is waiting, and the shop decides in Settings which of those it is allowed to do.

   Two things about it are worth saying plainly, because they are the whole of the risk.

   An Echo is a loudspeaker. Whatever it answers is heard by everybody in the room, and it
   cannot tell who asked — Amazon's voice profiles are a convenience, not a lock. So stock and
   prices, which a customer can read off the shelf anyway, are answered to anybody; anything
   about money needs a word said aloud in the same breath, and is refused without it.

   And every question goes to Amazon before it reaches here. Amazon hears the words; this server
   is what turns them into figures. Nothing is sent to Amazon that was not asked for, but a shop
   that does not want its takings spoken over somebody else's wire should leave the money part
   switched off — which is how it ships.

   The skill is kept in development mode on the shop's own devices: no Amazon review, nothing
   published, nobody else can add it. */
import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, HttpError } from '../lib/errors.js';
import { pendingOrders, shopBooks } from './shop.js';

const r = Router();

const money = (n) => 'Rs ' + Math.round(+n || 0).toLocaleString('en-US');
const say = (text, end = true) => ({
  version: '1.0',
  response: { outputSpeech: { type: 'PlainText', text }, shouldEndSession: end },
});

let ready = false;
async function ensureTable() {
  if (ready) return;
  await query(`
    CREATE TABLE IF NOT EXISTS alexa_notes (
      id bigserial PRIMARY KEY,
      kind varchar(24) NOT NULL,
      text varchar(300) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
  ready = true;
}

/** The shop's own settings for this, as the till saved them. Off unless it says otherwise. */
function cfgOf(data) {
  const a = (data?.CFG?.alexa) || {};
  return {
    on: a.on === true,
    word: String(a.word || '').trim().toLowerCase(),
    stock: a.stock !== false,
    price: a.price !== false,
    money: a.money === true,            // off unless the shop turns it on
    news: a.news !== false,
    skillId: String(a.skillId || '').trim(),
    sayOrders: a.sayOrders !== false,
    sayHolds: a.sayHolds !== false,
    sayCheques: a.sayCheques === true,
  };
}

/** Find a product by what somebody said. Amazon sends words, not codes. */
function findItem(S, spoken) {
  const q = String(spoken || '').toLowerCase().trim();
  if (!q) return null;
  const list = (S.products || []).filter(p => p.active !== false);
  const words = q.split(/[^a-z0-9]+/).filter(w => w.length > 2);
  /* Tried in order, each looser than the last. The loosest — any one word turning up anywhere
     inside a name — has to insist on a longer word than the others, because a short one buried in
     a longer word is not a match at all: in a shop of six thousand items, "a thing we have never
     sold" found SOLDER IRON on the strength of "sold". Answering confidently about the wrong item
     is worse than saying it could not be found, so five letters is the price of that last guess. */
  return list.find(p => String(p.code || '').toLowerCase() === q)
      || list.find(p => p.name.toLowerCase() === q)
      || list.find(p => words.length && words.every(w => p.name.toLowerCase().includes(w)))
      || list.find(p => words.some(w => p.name.toLowerCase().split(/\s+/).includes(w)))
      || list.find(p => words.some(w => w.length >= 5 && p.name.toLowerCase().includes(w)))
      || null;
}

const slot = (req, name) => {
  const s = req?.request?.intent?.slots?.[name];
  return s ? String(s.value || '').trim() : '';
};

/* ---------------------------------------------------------------- the skill itself */
r.post('/', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const data = await shopBooks();
  const cfg = cfgOf(data);
  if (!cfg.on) return res.json(say('The shop has not switched this on yet.'));

  /* Only the shop's own skill may use this. Amazon puts the skill's id in every request, and a
     request carrying anything else is somebody else's — or nobody's. */
  const appId = body?.context?.System?.application?.applicationId
             || body?.session?.application?.applicationId || '';
  if (cfg.skillId && appId !== cfg.skillId) throw new HttpError(403, 'Not this shop\'s skill');

  const S = data?.S || {};
  const type = body?.request?.type;

  if (type === 'LaunchRequest')
    return res.json(say('Regal Hardware. Ask me what is in stock, what something costs, or what is waiting.', false));
  if (type === 'SessionEndedRequest') return res.json(say(''));
  if (type !== 'IntentRequest') return res.json(say('I did not catch that.'));

  const intent = body?.request?.intent?.name || '';

  /* ---- what is on the shelf ---- */
  if (intent === 'StockIntent') {
    if (!cfg.stock) return res.json(say('The shop has switched stock off for this.'));
    const p = findItem(S, slot(body, 'item'));
    if (!p) return res.json(say('I could not find that one. Try the name as it is on the shelf.'));
    const left = +p.stock || 0;
    const unit = p.unit || '';
    return res.json(say(left <= 0 ? `${p.name}. None left.`
      : `${p.name}. ${left % 1 ? left.toFixed(2) : left} ${unit}${left <= (+p.min || 0) ? ', which is below the reorder level' : ''}.`));
  }

  /* ---- what it costs. A price is on the shelf anyway, so this is said to anybody. ---- */
  if (intent === 'PriceIntent') {
    if (!cfg.price) return res.json(say('The shop has switched prices off for this.'));
    const p = findItem(S, slot(body, 'item'));
    if (!p) return res.json(say('I could not find that one.'));
    const mrp = +p.mrp > (+p.retail || 0) ? `, marked at ${money(p.mrp)}` : '';
    return res.json(say(`${p.name}. ${money(p.retail)}${mrp}.`));
  }

  /* ---- money, and only with the word ---- */
  if (intent === 'MoneyIntent') {
    if (!cfg.money) return res.json(say('The shop has not switched money questions on.'));
    if (!cfg.word) return res.json(say('No word is set, so I cannot answer that. The shop sets one in settings.'));
    const said = (slot(body, 'word') || '').toLowerCase();
    // the word has to be in the same breath as the question, or there is nothing to stop
    // whoever is standing there asking the same thing after you have gone
    if (said !== cfg.word) return res.json(say('Not without the word.'));

    const today = new Date().toISOString().slice(0, 10);
    const sales = (S.sales || []).filter(s => s.date === today);
    const took = sales.reduce((a, s) => a + (+s.total || 0), 0);
    const what = (slot(body, 'what') || '').toLowerCase();

    if (/owe|outstanding|debtor|credit/.test(what)) {
      let dr = 0, cr = 0;
      for (const j of (S.journal || [])) for (const l of (j.lines || []))
        if (l.ac === '1100' && l.party?.type === 'C') { dr += l.dr; cr += l.cr }
      return res.json(say(`Customers owe ${money(dr - cr)}.`));
    }
    if (/drawer|cash|hand/.test(what)) {
      let d = 0, c = 0;
      for (const j of (S.journal || [])) for (const l of (j.lines || []))
        if (l.ac === '1010') { d += l.dr; c += l.cr }
      return res.json(say(`${money(d - c)} in the drawer.`));
    }
    return res.json(say(`${sales.length} bill${sales.length === 1 ? '' : 's'} today, ${money(took)}.`));
  }

  /* ---- what is waiting. Nothing here is a figure anybody could spend. ---- */
  if (intent === 'NewsIntent') {
    if (!cfg.news) return res.json(say('The shop has switched this off.'));
    await ensureTable();
    const bits = [];

    if (cfg.sayOrders) {
      const waiting = await pendingOrders();
      if (waiting.length) bits.push(`${waiting.length} website order${waiting.length === 1 ? '' : 's'} waiting`);
    }
    if (cfg.sayHolds) {
      const { rows } = await query(
        `SELECT text FROM alexa_notes WHERE kind = 'hold' AND created_at > now() - interval '12 hours' ORDER BY id DESC LIMIT 5`);
      if (rows.length) bits.push(rows.length === 1 ? `one bill on hold, ${rows[0].text}`
        : `${rows.length} bills on hold`);
    }
    if (cfg.sayCheques) {
      const today = new Date().toISOString().slice(0, 10);
      const due = (S.cheques || []).filter(c => c.dir === 'ISSUED'
        && ['ISSUED', 'PRINTED'].includes(c.status) && String(c.date).slice(0, 10) === today);
      if (due.length) bits.push(`${due.length} of our cheque${due.length === 1 ? '' : 's'} dated today`);
    }
    return res.json(say(bits.length ? bits.join(', ') + '.' : 'Nothing waiting.'));
  }

  if (/^AMAZON\.(Stop|Cancel)Intent$/.test(intent)) return res.json(say('Right you are.'));
  if (intent === 'AMAZON.HelpIntent')
    return res.json(say('Ask me how many of something there are, what it costs, or what is waiting.', false));

  return res.json(say('I did not catch that.'));
}));

/* ---------------------------------------------------------------- what the till reports
   A bill put on hold never reaches the books — it belongs to the till it was keyed on and is
   stripped before saving. So the till says so here, and the note keeps itself tidy. */
r.post('/note', asyncHandler(async (req, res) => {
  const data = await shopBooks();
  if (!cfgOf(data).on) return res.json({ ok: true, ignored: true });
  const kind = String(req.body?.kind || '').slice(0, 24);
  const text = String(req.body?.text || '').slice(0, 300);
  if (!['hold'].includes(kind) || !text) throw new HttpError(400, 'kind and text');
  await ensureTable();
  await query(`INSERT INTO alexa_notes (kind, text) VALUES ($1, $2)`, [kind, text]);
  await query(`DELETE FROM alexa_notes WHERE created_at < now() - interval '2 days'`).catch(() => {});
  res.json({ ok: true });
}));

export default r;
