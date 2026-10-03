// The camera helper: runs on the PC in the shop and hands the till pictures from the cameras.
//   node tools/camera-agent/agent.mjs          (or the "Regal camera helper" startup shortcut)
//
// Why it has to exist: the cameras are on the shop's own network, and regalhw.lk is not. The
// till's PAGE is on that network though — so the page asks this helper, and this helper asks
// the camera. It listens on 127.0.0.1 only, so nothing outside this PC can reach it, and the
// camera password stays here and never goes near the browser or the shop's books.
//
//   GET /health                        is it running, and what is it allowed to reach
//   GET /snap?host=..&port=..&ch=101   one still, as a JPEG
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshot, deviceInfo } from './hik.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readCfg = (f) => { try { return JSON.parse(fs.readFileSync(path.join(here, f), 'utf8').replace(/^﻿/, '')) } catch { return null } };
// config.local.json is this PC's own — the camera password lives there, never in the one that travels with the code
const cfg = Object.assign({ port: 4101, user: 'admin', pass: '', allow: [], cacheMs: 900 },
  readCfg('config.json') || {}, readCfg('config.local.json') || {});

const log = (...a) => console.log(new Date().toLocaleTimeString('en-GB'), ...a);
if (!cfg.pass) log('no camera password set yet — put one in tools/camera-agent/config.local.json');

/* Only the cameras this shop has said are its own. Without this the helper would fetch from
   anything on the network that answered, which is not its business. */
const allowed = (host) => !cfg.allow.length || cfg.allow.includes(String(host));

/* A still is worth keeping for a moment: four tills watching one camera should be four
   pictures a second off the camera, not four hundred. */
const recent = new Map();
const freshFrom = (key) => { const r = recent.get(key); return r && Date.now() - r.at < cfg.cacheMs ? r : null };

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const send = (code, type, body, extra = {}) => {
    res.writeHead(code, Object.assign({
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',          // only this PC can reach us at all; the page may be on any of the shop's addresses
      'Cache-Control': 'no-store'
    }, extra));
    res.end(body);
  };
  if (req.method === 'OPTIONS') return send(204, 'text/plain', '', { 'Access-Control-Allow-Headers': '*' });

  if (u.pathname === '/health') {
    return send(200, 'application/json', JSON.stringify({
      ok: true, helper: 'camera', port: cfg.port,
      ready: !!cfg.pass, cameras: cfg.allow.length || 'any on this network'
    }));
  }

  if (u.pathname === '/snap') {
    const host = u.searchParams.get('host') || '';
    const port = +u.searchParams.get('port') || 80;
    const ch = +u.searchParams.get('ch') || 101;
    if (!host) return send(400, 'application/json', JSON.stringify({ error: 'which camera?' }));
    if (!allowed(host)) return send(403, 'application/json', JSON.stringify({ error: `${host} is not one of this shop's cameras` }));
    if (!cfg.pass) return send(503, 'application/json', JSON.stringify({ error: 'no camera password set in config.local.json' }));

    const key = `${host}:${port}/${ch}`;
    const warm = freshFrom(key);
    if (warm) return send(200, 'image/jpeg', warm);

    const base = (port === 443 ? 'https://' : 'http://') + host + (port === 80 || port === 443 ? '' : ':' + port);
    const s = await snapshot(base, ch, { user: cfg.user, pass: cfg.pass, timeout: 6000 });
    if (!s.ok) { log('no picture from', key, '—', s.error); return send(502, 'application/json', JSON.stringify({ error: s.error })) }
    recent.set(key, { at: Date.now(), buf: s.buf, type: s.type || 'image/jpeg' });
    return send(200, s.type || 'image/jpeg', s.buf);
  }

  if (u.pathname === '/check') {                   // what is at this address, for the setup screen
    const host = u.searchParams.get('host') || '';
    const port = +u.searchParams.get('port') || 80;
    if (!host) return send(400, 'application/json', JSON.stringify({ error: 'which camera?' }));
    const base = (port === 443 ? 'https://' : 'http://') + host + (port === 80 || port === 443 ? '' : ':' + port);
    const d = await deviceInfo(base, { user: cfg.user, pass: cfg.pass, timeout: 6000 });
    return send(d.ok ? 200 : 502, 'application/json', JSON.stringify(d));
  }

  send(404, 'application/json', JSON.stringify({ error: 'not something this helper does' }));
});

srv.listen(cfg.port, '127.0.0.1', () => {
  log(`camera helper on http://127.0.0.1:${cfg.port}`);
  log(cfg.allow.length ? `cameras it may reach: ${cfg.allow.join(', ')}` : 'it may reach any camera on this network');
  if (!cfg.pass) log('it will not fetch anything until a password is set');
});
