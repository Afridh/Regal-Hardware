/* The camera helper's line OUT to the shop's server — so the cameras can be seen, and heard from,
   anywhere, without opening anything on the shop's router. The helper asks the server what is wanted;
   the server never reaches in.

     · Watching from anywhere: about once a second the helper asks which cameras somebody is looking
       at, and sends one still of each. When nobody is looking, nothing is sent.
     · A bill's pictures: when a bill is made the till asks for the counter camera; the helper takes
       a few stills a moment apart and sends them to be kept with that bill.
     · Alarms: the recorder's own event stream (movement, a line crossed, a camera covered, a disk
       fault …) is listened to, and each alarm is passed on — at most once a minute for one camera
       and one kind, so the stream's chatter does not become a flood.
     · Attendance: a Hikvision face/fingerprint terminal, if one is set in config.local.json, is
       read every minute and its check-ins are posted to the attendance board, matched by the
       Device ID on each person's card.

   Where the server is, and the key, come from config.local.json ("server", "key") or else from the
   print helper's, which already has both. The recorder is "recorder": { "host", "port" }. */
import fs from 'node:fs';
import path from 'node:path';
import { snapshot, channels, deviceInfo, parseChallenge, digestHeader, tag, isapi } from './hik.mjs';

export function startLink({ cfg, here, log }) {
  const printCfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, '../print-agent/config.local.json'), 'utf8').replace(/^﻿/, '')) } catch { return {} } })();
  const SERVER = String(cfg.server || printCfg.server || '').replace(/\/+$/, '');
  const KEY = cfg.key || printCfg.key || '';
  const rec = cfg.recorder || (cfg.allow && cfg.allow[0] ? { host: cfg.allow[0], port: 80 } : null);
  if (!SERVER || !KEY) { log('remote: no server or key — the cameras are seen on this PC only'); return; }
  if (!rec || !rec.host) { log('remote: no recorder set ("recorder": { "host": … } in config.local.json)'); return; }
  const base = 'http://' + rec.host + (rec.port && +rec.port !== 80 ? ':' + rec.port : '');
  const auth = { user: cfg.user, pass: cfg.pass, timeout: 8000 };
  const api = (p, q = '') => `${SERVER}/api/cams/${p}?key=${encodeURIComponent(KEY)}${q}`;
  const post = (p, body, q = '', type = 'application/json') => fetch(api(p, q), { method: 'POST', headers: { 'Content-Type': type },
    body: type === 'application/json' ? JSON.stringify(body) : body, signal: AbortSignal.timeout(20000) });

  /* ---- what the server should know: the recorder and its cameras ---- */
  let cams = [];
  const status = async () => {
    try {
      const d = await deviceInfo(base, auth);
      /* a recorder's video inputs are its cameras — each with the name set on the recorder, and an input
         with nothing plugged in says "NO VIDEO" and is left out. Its list of streams (101, 102, 201 …) is
         not the whole story: it can name two cameras where fourteen are recording. */
      const vi = await isapi(base, '/ISAPI/System/Video/inputs/channels', auth);
      const blocks = vi.status === 200 ? (vi.buf.toString('utf8').match(/<VideoInputChannel[\s>][\s\S]*?<\/VideoInputChannel>/gi) || []) : [];
      cams = blocks.map(b => ({ n: +tag(b, 'id'), name: tag(b, 'name'), res: tag(b, 'resDesc') }))
        .filter(x => x.n > 0 && !/no\s*video/i.test(x.res)).map(x => ({ ch: String(x.n * 100 + 1), name: x.name || ('Camera ' + String(x.n).padStart(2, '0')) }));
      if (!cams.length) {
        const list = await channels(base, auth);
        // a camera on its own lists its streams: the main one (101) is the camera
        cams = list.filter(c => c.ch % 100 === 1).map(c => ({ ch: String(c.ch), name: c.name || ('Camera ' + String(Math.floor(c.ch / 100)).padStart(2, '0')) }));
      }
      await post('status', { recorder: d.ok ? { model: d.model, name: d.name } : null, cameras: cams, terminals: (cfg.terminals || []).map(t => t.host) });
    } catch (e) { log('remote: status not sent —', e.message) }
  };
  status(); setInterval(status, 5 * 60 * 1000);

  /* ---- what is wanted now ---- */
  let alertsOn = false, bad = 0;
  const taking = new Set();
  const loop = async () => {
    let wait = 2500;
    try {
      const r = await fetch(api('jobs'), { signal: AbortSignal.timeout(15000) });
      if (r.status === 403) { if (bad++ % 40 === 0) log('remote: the server refused the key — check "key" (the same as PRINT_DEVICE_KEY on the server)'); wait = 30000; }
      else if (r.status === 404) { if (bad++ % 40 === 0) log('remote: the server does not have the cameras part yet — restart the app there'); wait = 60000; }
      else if (r.ok) {
        bad = 0;
        const j = await r.json();
        if (j.alerts && !alertsOn) { alertsOn = true; listenAlarms(); }
        for (const ch of j.watch || []) {
          const s = await snapshot(base, ch, auth);
          if (s.ok) await fetch(api('frame', '&ch=' + ch), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: s.buf, signal: AbortSignal.timeout(15000) }).catch(() => {});
        }
        if ((j.watch || []).length) wait = 700;
        for (const job of j.shots || []) {
          if (taking.has(job.id)) continue; taking.add(job.id);
          (async () => {           // a few stills a moment apart, without holding up the watching
            for (let i = 0; i < job.left; i++) {
              const s = await snapshot(base, job.ch, auth);
              if (s.ok) await fetch(api('frame', `&ch=${job.ch}&shot=${job.id}`), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: s.buf, signal: AbortSignal.timeout(15000) }).catch(() => {});
              await new Promise(r => setTimeout(r, 1500));
            }
            setTimeout(() => taking.delete(job.id), 60000);
          })();
        }
      }
    } catch (e) { /* the shop's internet blinked — ask again */ }
    setTimeout(loop, wait);
  };
  loop();
  log(`remote: linked to ${SERVER}, recorder ${rec.host}`);

  /* ---- the recorder's alarms ---- */
  const lastSaid = new Map();
  async function listenAlarms() {
    const pathA = '/ISAPI/Event/notification/alertStream';
    for (;;) {
      try {
        const first = await fetch(base + pathA, { signal: AbortSignal.timeout(8000) });
        const ch = parseChallenge(first.headers.get('www-authenticate'));
        try { first.body?.cancel(); } catch {}
        const r = await fetch(base + pathA, { headers: ch ? { Authorization: digestHeader({ user: cfg.user, pass: cfg.pass, method: 'GET', uri: pathA, challenge: ch }) } : {} });
        if (!r.ok || !r.body) throw new Error('alert stream ' + r.status);
        log('alarms: listening to the recorder');
        const reader = r.body.getReader(); let buf = '';
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          buf += Buffer.from(value).toString('utf8');
          let end;
          while ((end = buf.indexOf('</EventNotificationAlert>')) >= 0) {
            const x = buf.slice(0, end + 25); buf = buf.slice(end + 25);
            const kind = tag(x, 'eventType'), state = tag(x, 'eventState').toLowerCase();
            if (!kind || state !== 'active') continue;          // the stream's heartbeat is an "inactive" video loss
            const chNo = tag(x, 'dynChannelID') || tag(x, 'channelID') || tag(x, 'inputIOPortID') || '';
            const camCh = chNo ? String(+chNo >= 100 ? chNo : +chNo * 100 + 1) : null;
            const k = kind + '/' + camCh;
            if (Date.now() - (lastSaid.get(k) || 0) < 60000) continue;
            lastSaid.set(k, Date.now());
            post('event', { kind, ch: camCh, text: tag(x, 'eventDescription') || '' }).catch(() => {});
          }
          if (buf.length > 200000) buf = buf.slice(-20000);
        }
      } catch (e) { log('alarms:', e.message, '— trying again in a minute') }
      await new Promise(r => setTimeout(r, 60000));
    }
  }

  /* ---- a Hikvision attendance terminal ---- */
  const terminals = Array.isArray(cfg.terminals) ? cfg.terminals.filter(t => t && t.host) : [];
  if (terminals.length) {
    const stateFile = path.join(here, 'link-state.json');
    const state = (() => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')) } catch { return {} } })();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+05:30`;
    const postDigest = async (tbase, p, body, a) => {
      const url = tbase + p, opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) };
      let r = await fetch(url, opts);
      if (r.status === 401) { const ch = parseChallenge(r.headers.get('www-authenticate')); try { r.body?.cancel() } catch {}
        r = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: digestHeader({ user: a.user, pass: a.pass, method: 'POST', uri: p, challenge: ch }) } }); }
      return r.json();
    };
    const readTerminal = async (t) => {
      const tbase = 'http://' + t.host + (t.port && +t.port !== 80 ? ':' + t.port : '');
      const a = { user: t.user || cfg.user, pass: t.pass || cfg.pass };
      const since = state[t.host] ? new Date(state[t.host]) : new Date(Date.now() - 12 * 3600e3);
      const reads = []; let pos = 0;
      for (let page = 0; page < 20; page++) {
        const j = await postDigest(tbase, '/ISAPI/AccessControl/AcsEvent?format=json', { AcsEventCond: { searchID: 'regal' + Date.now(), searchResultPosition: pos, maxResults: 30,
          major: 5, minor: 0, startTime: iso(since), endTime: iso(new Date(Date.now() + 60000)) } }, a);
        const list = j?.AcsEvent?.InfoList || [];
        for (const e of list) if (e.employeeNoString && e.time) reads.push({ id: String(e.employeeNoString), at: new Date(e.time) });
        pos += list.length;
        if (!list.length || j?.AcsEvent?.responseStatusStrg !== 'MORE') break;
      }
      const fresh = reads.filter(x => !isNaN(x.at) && x.at > since);
      if (!fresh.length) return;
      const byDay = new Map();
      for (const x of fresh) { const d = `${x.at.getFullYear()}-${pad(x.at.getMonth() + 1)}-${pad(x.at.getDate())}`;
        if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push({ id: x.id, time: `${pad(x.at.getHours())}:${pad(x.at.getMinutes())}` }); }
      for (const [date, events] of byDay) {
        const r = await fetch(`${SERVER}/shift-api.php?action=punches`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: KEY, date, events }), signal: AbortSignal.timeout(20000) });
        const j = await r.json().catch(() => ({}));
        log(`attendance ${t.host} ${date}: ${r.ok ? `${j.written || 0} written${(j.unmatched || []).length ? ', no one has Device ID ' + j.unmatched.join(', ') : ''}` : (j.error || r.status)}`);
      }
      state[t.host] = new Date(Math.max(...fresh.map(x => +x.at))).toISOString();
      fs.writeFileSync(stateFile, JSON.stringify(state));
    };
    const tick = async () => { for (const t of terminals) { try { await readTerminal(t) } catch (e) { log('attendance', t.host, '—', e.message) } } };
    tick(); setInterval(tick, 60000);
    log(`attendance: reading ${terminals.map(t => t.host).join(', ')} every minute`);
  }
}
