// Try WhatsApp Cloud API credentials before putting them in the till.
//   node tools/wa-check.mjs <PHONE_NUMBER_ID> <ACCESS_TOKEN> [send-to e.g. 0777849964]
// Shows what Meta knows about the number, lists the account's templates, and (with a number)
// sends Meta's built-in hello_world template to it.
const [phoneId, token, sendTo] = process.argv.slice(2);
if (!phoneId || !token) { console.error('usage: node tools/wa-check.mjs <PHONE_NUMBER_ID> <ACCESS_TOKEN> [07XXXXXXXX]'); process.exit(1); }
const G = 'https://graph.facebook.com/v20.0';
const call = async (path, opts = {}) => {
  const r = await fetch(G + path, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || ('HTTP ' + r.status));
  return j;
};
try {
  const n = await call(`/${phoneId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status,name_status,messaging_limit_tier`);
  console.log('Number    :', n.display_phone_number, '·', n.verified_name || '(no display name yet)');
  console.log('Verified  :', n.code_verification_status, '· name', n.name_status, '· quality', n.quality_rating, '· limit', n.messaging_limit_tier);
  const dbg = await call(`/debug_token?input_token=${encodeURIComponent(token)}`);
  const scope = (dbg.data?.granular_scopes || []).find(s => /whatsapp_business/.test(s.scope));
  const waba = scope?.target_ids?.[0];
  console.log('Token     :', dbg.data?.type, '· expires', dbg.data?.expires_at ? new Date(dbg.data.expires_at * 1000).toISOString() : 'never', '· scopes', (dbg.data?.scopes || []).join(', '));
  if (waba) {
    const t = await call(`/${waba}/message_templates?fields=name,status,language,category&limit=200`);
    console.log(`Templates : ${t.data.length} on account ${waba}`);
    for (const x of t.data) console.log('  ', x.status.padEnd(9), x.name, `(${x.language}, ${x.category})`);
  } else console.log('Templates : token has no whatsapp_business_management scope — cannot list');
  if (sendTo) {
    let to = sendTo.replace(/\D/g, ''); if (to.startsWith('0')) to = '94' + to.slice(1);
    const s = await call(`/${phoneId}/messages`, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: 'hello_world', language: { code: 'en_US' } } }) });
    console.log('hello_world sent to', to, '· message id', s.messages?.[0]?.id);
  }
} catch (e) { console.error('FAILED:', e.message); process.exit(2); }
