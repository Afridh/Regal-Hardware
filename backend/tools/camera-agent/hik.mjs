/* Talking to Hikvision gear over ISAPI, its own HTTP interface.

   Two things make this more than a fetch() call:

   · Digest authentication. Hikvision will not take a plain user and password in a header;
     it answers 401 with a challenge, and the real request has to carry an answer worked out
     from the challenge, the credentials, the method and the path. fetch() does not do this,
     so it is done here.

   · Everything comes back as XML, with no namespace worth parsing properly. The few values
     that are wanted are pulled out by name.

   Nothing in this file writes anywhere or changes a camera: it reads device information,
   lists channels and takes stills. */
import crypto from 'node:crypto';

const md5 = s => crypto.createHash('md5').update(s).digest('hex');

/** Parse a WWW-Authenticate: Digest ... header into its parts. */
export function parseChallenge(header) {
  const h = String(header || '');
  if (!/^\s*digest/i.test(h)) return null;
  const out = {};
  // key=value, the value either quoted or bare
  for (const m of h.slice(h.toLowerCase().indexOf('digest') + 6).matchAll(/(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g))
    out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  return out.realm !== undefined || out.nonce !== undefined ? out : null;
}

/** The Authorization header that answers a challenge. RFC 2617, qop=auth. */
export function digestHeader({ user, pass, method, uri, challenge, nc = 1, cnonce }) {
  const c = challenge || {};
  const realm = c.realm || '', nonce = c.nonce || '', opaque = c.opaque;
  const algo = (c.algorithm || 'MD5').toUpperCase();
  const qop = (c.qop || '').split(',').map(s => s.trim()).includes('auth') ? 'auth' : (c.qop || '');
  const cn = cnonce || crypto.randomBytes(8).toString('hex');
  const ncv = String(nc).padStart(8, '0');

  let ha1 = md5(`${user}:${realm}:${pass}`);
  if (algo === 'MD5-SESS') ha1 = md5(`${ha1}:${nonce}:${cn}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${ncv}:${cn}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const bits = [`username="${user}"`, `realm="${realm}"`, `nonce="${nonce}"`, `uri="${uri}"`,
    `response="${response}"`];
  if (algo && algo !== 'MD5') bits.push(`algorithm=${c.algorithm}`);
  if (qop) bits.push(`qop=${qop}`, `nc=${ncv}`, `cnonce="${cn}"`);
  if (opaque !== undefined) bits.push(`opaque="${opaque}"`);
  return 'Digest ' + bits.join(', ');
}

/**
 * One ISAPI request, answering a digest challenge if one comes back.
 * Returns { status, headers, buf, text } — never throws for an HTTP status.
 */
export async function isapi(base, path, { user, pass, timeout = 6000, method = 'GET' } = {}) {
  const url = base.replace(/\/+$/, '') + path;
  const go = (headers) => fetch(url, { method, headers, signal: AbortSignal.timeout(timeout) });
  let r;
  try { r = await go({ Accept: '*/*' }); }
  catch (e) { return { status: 0, error: e.name === 'TimeoutError' ? 'no answer' : e.message } }

  if (r.status === 401 && user) {
    const ch = parseChallenge(r.headers.get('www-authenticate'));
    if (ch) {
      const auth = digestHeader({ user, pass, method, uri: path, challenge: ch });
      try { r = await go({ Accept: '*/*', Authorization: auth }); }
      catch (e) { return { status: 0, error: e.message } }
    } else if (/basic/i.test(r.headers.get('www-authenticate') || '')) {
      const auth = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
      try { r = await go({ Accept: '*/*', Authorization: auth }); }
      catch (e) { return { status: 0, error: e.message } }
    }
  }
  const buf = Buffer.from(await r.arrayBuffer());
  const type = r.headers.get('content-type') || '';
  return { status: r.status, type, buf, text: /image/i.test(type) ? '' : buf.toString('utf8').slice(0, 4000) };
}

/** Pull one tag's text out of a lump of XML, without pretending to parse XML. */
export const tag = (xml, name) => {
  const m = new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'i').exec(xml || '');
  return m ? m[1].trim() : '';
};
export const tagsAll = (xml, name) =>
  [...String(xml || '').matchAll(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'gi'))].map(m => m[1].trim());

/** What this device is. */
export async function deviceInfo(base, auth) {
  const r = await isapi(base, '/ISAPI/System/deviceInfo', auth);
  if (r.status !== 200) return { ok: false, status: r.status, error: r.error || (r.status === 401 ? 'user or password refused' : 'not an ISAPI device') };
  const x = r.text;
  /* A 200 is not enough. Plenty of things on a shop network answer 200 to any path at all —
     a printer, a router, a web page — and would otherwise be written down as cameras. This
     has to look like Hikvision's own answer before it is believed. */
  if (!/<DeviceInfo/i.test(x) && !(tag(x, 'model') || tag(x, 'serialNumber') || tag(x, 'deviceType')))
    return { ok: false, status: r.status, error: 'answered, but it is not a camera' };
  return {
    ok: true,
    name: tag(x, 'deviceName'), model: tag(x, 'model'), serial: tag(x, 'serialNumber'),
    firmware: tag(x, 'firmwareVersion'), released: tag(x, 'firmwareReleasedDate'),
    kind: tag(x, 'deviceType'), mac: tag(x, 'macAddress'),
    analog: +tag(x, 'videoInputPortNums') || 0, digital: +tag(x, 'digitalInputPortNums') || 0
  };
}

/** Which channels it has, as the numbers a still is asked for by (101, 201, …). */
export async function channels(base, auth) {
  const out = [];
  for (const path of ['/ISAPI/ContentMgmt/InputProxy/channels', '/ISAPI/Streaming/channels']) {
    const r = await isapi(base, path, auth);
    if (r.status !== 200) continue;
    const ids = tagsAll(r.text, 'id').map(Number).filter(n => n > 0);
    const names = tagsAll(r.text, 'name');
    ids.forEach((id, i) => {
      // a recorder lists channels as 1,2,3 and wants 101,201,301; a camera lists 101 already
      const ch = id >= 100 ? id : id * 100 + 1;
      if (!out.some(c => c.ch === ch)) out.push({ ch, name: names[i] || '' });
    });
    if (out.length) break;
  }
  return out;
}

/** A still from one channel. Returns the JPEG, or why not. */
export async function snapshot(base, ch, auth) {
  const r = await isapi(base, `/ISAPI/Streaming/channels/${ch}/picture`, auth);
  if (r.status === 200 && /image/i.test(r.type || '')) return { ok: true, bytes: r.buf.length, buf: r.buf, type: r.type };
  return { ok: false, status: r.status, error: r.error || (r.status === 401 ? 'user or password refused' : (r.text || '').slice(0, 160) || 'no picture') };
}
