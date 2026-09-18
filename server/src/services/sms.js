// SMS: queue messages into sms_outbox and deliver them with a background worker
// (the web equivalent of SePOSbgWorkerSMS.exe).  Gateway: smslenz.lk-style HTTP API,
// configurable per company in sms_settings.
import { query } from '../db.js';

export function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}

/** Queue a templated SMS if the company's settings enable it. templateKey e.g. 'invoice', 'credit_settlement'. */
export async function queueSms(companyId, mobile, templateKey, vars, { force = false } = {}) {
  if (!mobile) return null;
  const { rows: [s] } = await query(`SELECT * FROM sms_settings WHERE company_id = $1`, [companyId]);
  if (!s || !s.api_url) return null;
  const flags = s.flags || {};
  const enabled = force || flags[`send_${templateKey}_to_customer`] || flags.send_invoice_to_customer;
  if (!enabled) return null;
  const tpl = (s.templates || {})[templateKey];
  if (!tpl) return null;
  const message = renderTemplate(tpl, vars);
  const { rows: [row] } = await query(`INSERT INTO sms_outbox (company_id, mobile, message) VALUES ($1,$2,$3) RETURNING *`, [companyId, mobile, message]);
  return row;
}

/** Send a raw message now (used by "Test Send" in SMS settings). */
export async function sendNow(settings, mobile, message) {
  const url = settings.api_url;
  if (!url) throw new Error('SMS API URL not configured');
  const body = { user_id: settings.sender_id, api_key: settings.api_key, sender_id: settings.sender_id, contact: mobile, message };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

/** Background worker: drains the outbox every `intervalMs`. */
export function startSmsWorker(intervalMs = 15000) {
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const { rows } = await query(`SELECT o.*, s.api_url, s.api_key, s.sender_id FROM sms_outbox o JOIN sms_settings s ON s.company_id = o.company_id
                                    WHERE o.status = 'PENDING' AND o.attempts < 3 ORDER BY o.id LIMIT 20`);
      for (const m of rows) {
        try {
          await sendNow(m, m.mobile, m.message);
          await query(`UPDATE sms_outbox SET status = 'SENT', sent_at = now(), attempts = attempts + 1 WHERE id = $1`, [m.id]);
        } catch (e) {
          await query(`UPDATE sms_outbox SET attempts = attempts + 1, last_error = $2, status = CASE WHEN attempts + 1 >= 3 THEN 'FAILED' ELSE 'PENDING' END WHERE id = $1`, [m.id, e.message]);
        }
      }
    } catch (e) { console.error('sms worker', e.message); }
    finally { busy = false; }
  };
  setInterval(tick, intervalMs).unref();
}
