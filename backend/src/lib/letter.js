// The texts the server sends itself (sign-in codes, the web-order note) laid out like every message
// from the till: the greeting for whoever it goes to, the message, then the shop's sign-off.
// It reads the same settings (Settings → Messages, kept in the books as CFG.msg) — keep it in step
// with letter() in frontend/index.html.
const GREET = { customer: 'Dear Customer,', supplier: 'Dear Supplier,', owner: 'Dear Owner,', staff: 'Dear Team Member,' };

export function letter(CFG, aud, body) {
  const m = (CFG && CFG.msg) || {};
  const shop = String((CFG && CFG.shop && CFG.shop.name) || 'Regal Hardware').replace(/^REGAL HARDWARE$/, 'Regal Hardware');
  if (m.letterOn === false) return `${shop}: ${body}`;
  const greet = String(m['greet' + aud.charAt(0).toUpperCase() + aud.slice(1)] ?? GREET[aud] ?? GREET.customer).trim();
  const sign = String(m.signOff ?? 'Thank you,\n{shop}\n{phone}')
    .replace(/\{shop\}/g, shop).replace(/\{phone\}/g, (CFG && CFG.shop && CFG.shop.phone) || '').trim();
  return (greet ? greet + '\n' : '') + String(body).trim() + (sign ? '\n\n' + sign : '');
}
