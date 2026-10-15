// Wrong guesses at a sign-in are counted, so a six-digit code or a password cannot be tried over and
// over by a script. Each sign-in counts against the mobile or user name it is for and against the
// address it comes from; past the limit that one waits a quarter of an hour. A right answer clears
// the count for that mobile or name. Kept in memory: a restart forgives everybody, which is fine.
import { HttpError } from './errors.js';

const WINDOW_MS = 15 * 60 * 1000;
const seen = new Map();                         // key -> { n, since }

function count(key) {
  const x = seen.get(key);
  if (!x) return 0;
  if (Date.now() - x.since > WINDOW_MS) { seen.delete(key); return 0; }
  return x.n;
}

/** Before checking a code or password. `limits` is [[key, max], …]. */
export function stopIfTooMany(limits) {
  for (const [key, max] of limits) if (count(key) >= max)
    throw new HttpError(429, 'Too many wrong tries — please wait 15 minutes, or ring the shop');
}
/** After a wrong one. */
export function wrongTry(limits) {
  for (const [key] of limits) {
    const n = count(key);
    seen.set(key, n ? { ...seen.get(key), n: n + 1 } : { n: 1, since: Date.now() });
  }
  if (seen.size > 20000) for (const [k, v] of seen) if (Date.now() - v.since > WINDOW_MS) seen.delete(k);
}
/** After a right one: that mobile or name starts again (the address keeps its count). */
export function rightTry(key) { seen.delete(key); }

/** Sending a code costs a text and can be used to pester someone: a few per mobile each quarter hour. */
export function sendingCode(phone, ip) {
  const limits = [['send:' + phone, 5], ['sendip:' + ip, 20]];
  stopIfTooMany(limits);
  wrongTry(limits);                            // counted whether or not it is then used
}

/** A texted code: right, or counted as a wrong try (five to a mobile, thirty to an address). */
export function guardCode(phone, ip, isRight) {
  const limits = [['code:' + phone, 5], ['codeip:' + ip, 30]];
  stopIfTooMany(limits);
  if (!isRight()) { wrongTry(limits); throw new HttpError(401, 'That code is not right, or it has expired'); }
  rightTry('code:' + phone);
}
/** A user name and password: eight wrong to a name, thirty to an address. */
export async function guardPassword(user, ip, check) {
  const limits = [['user:' + String(user || '').toLowerCase(), 8], ['passip:' + ip, 30]];
  stopIfTooMany(limits);
  const r = await check();
  if (!r) { wrongTry(limits); return r; }
  rightTry('user:' + String(user || '').toLowerCase());
  return r;
}
