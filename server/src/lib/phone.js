/* Mobile numbers, and the one place that decides whether a message may go out.

   While the shop is trying the gateway out it sets a number — or a few — in
   Settings → Messaging, and nothing may be sent to anybody else. That is not a convenience:
   a shop testing a new gateway has a book full of real customers' numbers in it, and one
   loop over the wrong list texts every one of them at the shop's expense.

   So the rule lives here, on its own, and every path that can reach a provider asks it.
   Anything that sends without asking is a bug, and tools/audit-sms.mjs will say so. */

/** A Sri Lankan mobile in the form the gateways want: 94XXXXXXXXX. */
export function intlPhone(to) {
  let d = String(to || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '94' + d.slice(1);
  if (d.length === 9) d = '94' + d;
  return d;
}

/**
 * Is this message held back by test mode?
 * An empty setting means no limit. Otherwise only the numbers listed may be sent to,
 * whichever way any of them happens to be written.
 */
export function heldByTestMode(cfg, to) {
  const list = String(cfg?.testOnly || '').split(/[,\s;]+/).map(intlPhone).filter(Boolean);
  return list.length ? !list.includes(intlPhone(to)) : false;
}

/** The same question, phrased for a person: why it was held, or null if it was not. */
export function whyHeld(cfg, to) {
  return heldByTestMode(cfg, to)
    ? `Held — while testing, messages only go to ${cfg.testOnly}`
    : null;
}
