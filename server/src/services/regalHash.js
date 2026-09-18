// Password hashes exactly as the Regal front-end computes them (see hashPass / hashSync in app/index.html):
//   's' + sha256hex('regal|' + password)              when the browser has WebCrypto
//   'f' + FNV-1a-64 hex('regal|' + password)          fallback
// The server must accept both so a user created in the browser can sign in here.
import { createHash } from 'node:crypto';

export function sha(str) {
  return 's' + createHash('sha256').update('regal|' + str, 'utf8').digest('hex');
}

export function fnv(str) {
  const txt = 'regal|' + str;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < txt.length; i++) {
    h ^= BigInt(txt.charCodeAt(i) & 0xff);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return 'f' + h.toString(16).padStart(16, '0');
}

/** true when `given` matches a stored Regal user record ({passHash} or legacy {pass}). */
export function matches(user, given) {
  if (!user || typeof given !== 'string') return false;
  if (user.passHash) return user.passHash === sha(given) || user.passHash === fnv(given);
  return !!user.pass && user.pass === given;
}

/** The demo seed convention: first name lower-cased letters + '123' (only used before the books hold real users). */
export function demoPassword(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '') + '123';
}
