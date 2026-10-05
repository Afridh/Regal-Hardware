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
//   GET /live?host=..&port=..&ch=101   moving pictures, while the page is watching
//
// Moving pictures are the same JPEGs one after another, in the form browsers have understood
// since the nineties: multipart/x-mixed-replace, which plays in a plain <img> with no player and
// no library to ship. It has to be done this way round because the recorder sends H.265, which
// browsers largely will not touch — so ffmpeg turns it into JPEGs here, on this PC.
//
// One ffmpeg per camera being watched, stopped the moment the page stops asking: nothing grinds
// away at the recorder, or at this PC, when nobody is looking.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { snapshot, deviceInfo } from './hik.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const readCfg = (f) => { try { return JSON.parse(fs.readFileSync(path.join(here, f), 'utf8').replace(/^﻿/, '')) } catch { return null } };
// config.local.json is this PC's own — the camera password lives there, never in the one that travels with the code
const cfg = Object.assign({ port: 4101, user: 'admin', pass: '', allow: [], cacheMs: 900 },
  readCfg('config.json') || {}, readCfg('config.local.json') || {});

const log = (...a) => console.log(new Date().toLocaleTimeString('en-GB'), ...a);
if (!cfg.pass) log('no camera password set yet — put one in tools/camera-agent/config.local.json');

/* ffmpeg is what turns the recorder's H.265 into JPEGs a browser will show. Where it is found
   does not matter, so it is looked for in the usual places rather than insisted upon in one.
   Without it the stills carry on working and the till is told, rather than being offered moving
   pictures that cannot happen. */
const FFMPEG = (() => {
  const tries = [cfg.ffmpeg, process.env.FFMPEG,
    'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
    'C:/ffmpeg/bin/ffmpeg.exe',
    'C:/Program Files (x86)/HikCentral Access Control/VSM Servers/SYS/ffmpeg.exe',
    'C:/Program Files/HikCentral Access Control/VSM Servers/SYS/ffmpeg.exe',
    'ffmpeg'].filter(Boolean);
  for (const t of tries) {
    try { if (spawnSync(t, ['-hide_banner', '-version'], { timeout: 8000 }).status === 0) return t }
    catch (e) { /* not this one */ }
  }
  return null;
})();
log(FFMPEG ? 'moving pictures: using ' + FFMPEG : 'moving pictures: no ffmpeg found, stills only');

/* Only the cameras this shop has said are its own. Without this the helper would fetch from
   anything on the network that answered, which is not its business. */
const allowed = (host) => !cfg.allow.length || cfg.allow.includes(String(host));

/* A still is worth keeping for a moment: four tills watching one camera should be four
   pictures a second off the camera, not four hundred. */
const recent = new Map();
const freshFrom = (key) => { const r = recent.get(key); return r && Date.now() - r.at < cfg.cacheMs ? r : null };
/* Which cameras somebody is watching, and when they last said so.
   A browser will not let go of a stream like this: taking the <img> off the page, emptying its src,
   even removing the attribute — the connection stays open and this PC keeps working. So the page
   says "still watching" every few seconds instead, and anything that goes quiet is stopped here.
   That also covers the cases a browser could never report: it crashed, the PC slept, the network
   went. Nothing is left grinding because something failed to say goodbye. */
const live = new Map();                            // key -> { ff, seen }
const WATCH_GRACE = 15000;                         // stopped once nobody has claimed it this long

setInterval(() => {
  const now = Date.now();
  for (const [key, w] of live) {
    if (now - w.seen < WATCH_GRACE) continue;
    log('nobody watching', key, '— stopping');
    try { w.ff.kill() } catch (e) {}
    live.delete(key);
  }
}, 5000).unref();

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const send = (code, type, body, extra = {}) => {
    res.writeHead(code, Object.assign({
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',          // only this PC can reach us at all; the page may be on any of the shop's addresses
      'Access-Control-Allow-Private-Network': 'true',   // the till may be opened at regalhw.lk; the pictures still come from this PC
      'Cache-Control': 'no-store'
    }, extra));
    res.end(body);
  };
  if (req.method === 'OPTIONS') return send(204, 'text/plain', '', {
    'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '600' });

  if (u.pathname === '/health') {
    return send(200, 'application/json', JSON.stringify({
      ok: true, helper: 'camera', port: cfg.port,
      ready: !!cfg.pass, cameras: cfg.allow.length || 'any on this network',
      live: !!FFMPEG && !!cfg.pass, watching: live.size
    }));
  }

  /* "still watching" — the page says this every few seconds for the cameras it is showing. */
  if (u.pathname === '/watching') {
    const keys = String(u.searchParams.get('keys') || '').split(',').filter(Boolean);
    const now = Date.now();
    let kept = 0;
    for (const k of keys) { const w = live.get(k); if (w) { w.seen = now; kept++ } }
    return send(200, 'application/json', JSON.stringify({ ok: true, watching: kept }));
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
    if (warm) return send(200, warm.type || 'image/jpeg', warm.buf);

    const base = (port === 443 ? 'https://' : 'http://') + host + (port === 80 || port === 443 ? '' : ':' + port);
    const s = await snapshot(base, ch, { user: cfg.user, pass: cfg.pass, timeout: 6000 });
    if (!s.ok) { log('no picture from', key, '—', s.error); return send(502, 'application/json', JSON.stringify({ error: s.error })) }
    recent.set(key, { at: Date.now(), buf: s.buf, type: s.type || 'image/jpeg' });
    return send(200, s.type || 'image/jpeg', s.buf);
  }

  /* Moving pictures, for as long as the page keeps asking.
     The recorder speaks RTSP and sends H.265; ffmpeg turns that into JPEGs one after another, in
     the multipart form a browser plays in a plain <img>. Nothing is stored and nothing is kept:
     when the page goes away the socket closes, and ffmpeg is stopped with it. */
  if (u.pathname === '/live') {
    const host = u.searchParams.get('host') || '';
    const port = +u.searchParams.get('port') || 80;
    const rtsp = +u.searchParams.get('rtsp') || 554;
    const ch = +u.searchParams.get('ch') || 101;
    // enough to watch a shop by, and little enough that two of them are not a burden on this PC
    const fps = Math.max(1, Math.min(15, +u.searchParams.get('fps') || 8));
    const q = Math.max(2, Math.min(24, +u.searchParams.get('q') || 7));   // 2 is best, 24 is coarsest
    /* These recorders send what Hikvision calls 1080p Lite: 960 across by 1080 down, meant to be
       pulled back out to 16:9 by whatever shows it. Nothing in the picture says so, and a plain
       <img> has nothing to go on — so the shop appears tall and thin, and the recorder's own
       "Camera 01" in the corner is the giveaway, stretched with everything else. The shape is put
       right here, where the pictures are made. */
    const w = Math.max(160, Math.min(1920, +u.searchParams.get('w') || 1280));
    const h = Math.max(120, Math.min(1080, +u.searchParams.get('h') || Math.round(w * 9 / 16)));
    if (!host) return send(400, 'application/json', JSON.stringify({ error: 'which camera?' }));
    if (!allowed(host)) return send(403, 'application/json', JSON.stringify({ error: `${host} is not one of this shop's cameras` }));
    if (!cfg.pass) return send(503, 'application/json', JSON.stringify({ error: 'no camera password set in config.local.json' }));
    if (!FFMPEG) return send(503, 'application/json', JSON.stringify({ error: 'moving pictures need ffmpeg on this PC — the stills still work' }));

    const url = `rtsp://${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.pass)}@${host}:${rtsp}/Streaming/Channels/${ch}`;
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error',
      '-rtsp_transport', 'tcp',          // the shop's network is not always kind to UDP
      '-i', url,
      '-an', '-vf', `scale=${w}:${h}`,
      '-f', 'mpjpeg', '-q:v', String(q), '-r', String(fps), '-']);

    const key = `${host}:${rtsp}/${ch}`;
    const prev = live.get(key);
    if (prev) { try { prev.ff.kill() } catch (e) {} }   // one ffmpeg per camera, not one per reload
    live.set(key, { ff, seen: Date.now() });
    let said = '';
    ff.stderr.on('data', d => { said = String(d).trim().split('\n')[0] });

    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=ffmpeg',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Private-Network': 'true',
      'Cache-Control': 'no-store', 'Connection': 'close',
    });
    ff.stdout.pipe(res);

    let done = false;
    const stop = (why) => {
      if (done) return; done = true;
      if (live.get(key)?.ff === ff) live.delete(key);   // a newer one may have taken this camera over
      try { ff.kill() } catch (e) {}
      try { res.end() } catch (e) {}
      if (why === 'gave up' && said) log('live', key, '—', said);
    };
    req.on('close', () => stop('page left'));
    res.on('error', () => stop('page left'));
    ff.on('error', () => stop('gave up'));
    ff.on('exit', () => stop('gave up'));
    return;
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
