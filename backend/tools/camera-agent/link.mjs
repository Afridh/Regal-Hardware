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
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { snapshot, channels, deviceInfo, parseChallenge, digestHeader, tag, isapi } from './hik.mjs';
import { sadpSearch } from './recorder.mjs';

/* "20261027T182142" — the recorder's clock, which is this PC's local time; Hikvision wants a Z after it */
const recStamp = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;

export function startLink({ cfg, here, log, recorder, ffmpeg }) {
  const printCfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, '../print-agent/config.local.json'), 'utf8').replace(/^﻿/, '')) } catch { return {} } })();
  const SERVER = String(cfg.server || printCfg.server || '').replace(/\/+$/, '');
  const KEY = cfg.key || printCfg.key || '';
  if (!SERVER || !KEY) { log('remote: no server or key — the cameras are seen on this PC only'); return; }
  // where the recorder is right now — found by its serial, never a written-down address
  const base = () => recorder.base() || 'http://0.0.0.0';
  const snap = async (ch) => { const s = await snapshot(base(), ch, auth); if (s.ok) recorder.ok(); else recorder.missed(); return s; };
  const auth = { user: cfg.user, pass: cfg.pass, timeout: 8000 };
  const api = (p, q = '') => `${SERVER}/api/cams/${p}?key=${encodeURIComponent(KEY)}${q}`;
  const post = (p, body, q = '', type = 'application/json') => fetch(api(p, q), { method: 'POST', headers: { 'Content-Type': type },
    body: type === 'application/json' ? JSON.stringify(body) : body, signal: AbortSignal.timeout(20000) });

  /* ---- what the server should know: the recorder and its cameras ---- */
  let cams = [];
  const status = async () => {
    try {
      await recorder.ready();
      const d = await deviceInfo(base(), auth);
      /* a recorder's video inputs are its cameras — each with the name set on the recorder, and an input
         with nothing plugged in says "NO VIDEO" and is left out. Its list of streams (101, 102, 201 …) is
         not the whole story: it can name two cameras where fourteen are recording. */
      const vi = await isapi(base(), '/ISAPI/System/Video/inputs/channels', auth);
      const blocks = vi.status === 200 ? (vi.buf.toString('utf8').match(/<VideoInputChannel[\s>][\s\S]*?<\/VideoInputChannel>/gi) || []) : [];
      cams = blocks.map(b => ({ n: +tag(b, 'id'), name: tag(b, 'name'), res: tag(b, 'resDesc') }))
        .filter(x => x.n > 0 && !/no\s*video/i.test(x.res)).map(x => ({ ch: String(x.n * 100 + 1), name: x.name || ('Camera ' + String(x.n).padStart(2, '0')) }));
      if (!cams.length) {
        const list = await channels(base(), auth);
        // a camera on its own lists its streams: the main one (101) is the camera
        cams = list.filter(c => c.ch % 100 === 1).map(c => ({ ch: String(c.ch), name: c.name || ('Camera ' + String(Math.floor(c.ch / 100)).padStart(2, '0')) }));
      }
      await post('status', { recorder: d.ok ? { model: d.model, name: d.name, serial: recorder.serial() } : null, cameras: cams, terminals: terminals.map(t => (t.model ? t.model + ' ' : '') + (t.host || t.serial)) });
    } catch (e) { log('remote: status not sent —', e.message) }
  };
  status(); setInterval(status, 5 * 60 * 1000);

  /* ---- a credit bill's clip ----
     Made from the recorder's own recording of the bill's moment (so it can be made a little later, or
     after this PC was off — for as long as the recorder still has it): played back, shrunk to a small
     H.264 MP4 a browser plays anywhere, and sent to be kept with the bill. One at a time, so the
     recorder and this PC are never asked for more than one playback by this. */
  const clipping = new Set(), clipQueue = [];
  let clipBusy = false;
  const nextClip = async () => {
    if (clipBusy || !clipQueue.length) return;
    clipBusy = true;
    const c = clipQueue.shift();
    const tell = (q, body) => fetch(api('clip', `&id=${c.id}${q}`), { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: body || '', signal: AbortSignal.timeout(120000) }).catch(() => {});
    const out = path.join(os.tmpdir(), `regal-clip-${c.id}.mp4`);
    try {
      if (!ffmpeg) { await tell('&fail=' + encodeURIComponent('no ffmpeg on the shop PC')); return; }
      await recorder.ready();
      if (!recorder.host) throw new Error('recorder not found');
      const secs = Math.max(5, Math.min(120, +c.secs || 30));
      const url = `rtsp://${encodeURIComponent(cfg.user)}:${encodeURIComponent(cfg.pass)}@${recorder.host}:${cfg.rtsp || 554}/Streaming/tracks/${c.ch}?starttime=${recStamp(new Date(c.start))}Z`;
      // 854×480 at 10 a second: a face and a hand at the counter, in well under a megabyte or two
      let said = '';
      const ok = await new Promise((done) => {
        const ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', url, '-t', String(secs), '-an',
          '-vf', 'scale=854:480,fps=10', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart', '-fs', '9000000', '-y', out]);
        ff.stderr.on('data', d => { said = String(d).trim().split('\n')[0].replaceAll(encodeURIComponent(cfg.pass), '***').replaceAll(cfg.pass, '***').slice(0, 150) });
        const kill = setTimeout(() => { try { ff.kill() } catch {} }, (secs + 90) * 1000);
        ff.on('exit', (code) => { clearTimeout(kill); done(code === 0) });
        ff.on('error', () => { clearTimeout(kill); done(false) });
      });
      const size = ok && fs.existsSync(out) ? fs.statSync(out).size : 0;
      // "400" for a moment under half an hour old: the recorder has not put it out for playback yet — asked again later
      if (size < 1000 && /\b400\b/.test(said) && Date.now() - new Date(c.start) < 30 * 60000) throw new Error('the recorder has not got it ready yet — again later');
      if (size < 1000) { await tell('&fail=' + encodeURIComponent('the recorder had nothing to play then' + (said ? ' — ' + said : ''))); log('clip', c.ref, '— nothing from the recorder', said); }
      else { const r = await tell('', fs.readFileSync(out)); log('clip', c.ref, (size / 1024).toFixed(0) + ' KB', r && r.ok ? 'kept' : 'not taken by the server'); }
    } catch (e) { log('clip', c.ref, '—', e.message); clipping.delete(c.id); }   // asked for again in ten minutes
    finally { try { fs.unlinkSync(out) } catch {} clipBusy = false; setTimeout(nextClip, 1000); }
  };

  /* ---- what is wanted now ---- */
  /* The shop reaches regalhw.lk from one address; every 2.5 s here (0.7 s while watched), with the tills
     and the print helper, was blocked by the hosting firewall as a bot (30 Oct 2026). Now every 6 s, every
     1.5 s while someone watches, and further apart — up to 2 minutes — while the server is failing. */
  let alertsOn = false, bad = 0, failing = 0;
  const backoff = () => Math.min(120000, 6000 * 2 ** Math.min(++failing, 5));
  const taking = new Set();
  const loop = async () => {
    let wait = 6000;
    try {
      const r = await fetch(api('jobs'), { signal: AbortSignal.timeout(15000) });
      if (r.status === 403) { if (bad++ % 40 === 0) log('remote: the server refused the key — check "key" (the same as PRINT_DEVICE_KEY on the server)'); wait = 30000; }
      else if (r.status === 404) { if (bad++ % 40 === 0) log('remote: the server does not have the cameras part yet — restart the app there'); wait = 60000; }
      else if (!r.ok) wait = backoff();                  // the server erroring: ask less often
      else if (r.ok) {
        bad = 0; failing = 0;
        const j = await r.json();
        if (j.alerts && !alertsOn) { alertsOn = true; listenAlarms(); }
        for (const ch of j.watch || []) {
          const s = await snap(ch);
          if (s.ok) await fetch(api('frame', '&ch=' + ch), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: s.buf, signal: AbortSignal.timeout(15000) }).catch(() => {});
        }
        if ((j.watch || []).length) wait = 1500;
        for (const job of j.shots || []) {
          if (taking.has(job.id)) continue; taking.add(job.id);
          (async () => {           // a few stills a moment apart, without holding up the watching
            for (let i = 0; i < job.left; i++) {
              const s = await snap(job.ch);
              if (s.ok) await fetch(api('frame', `&ch=${job.ch}&shot=${job.id}`), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: s.buf, signal: AbortSignal.timeout(15000) }).catch(() => {});
              await new Promise(r => setTimeout(r, 1500));
            }
            setTimeout(() => taking.delete(job.id), 60000);
          })();
        }
        for (const c of j.clips || []) if (!clipping.has(c.id)) { clipping.add(c.id); clipQueue.push(c); }
        nextClip();
      }
    } catch (e) { wait = backoff(); /* the shop's internet blinked, or the server is out of reach — ask again, later each time */ }
    setTimeout(loop, wait);
  };
  loop();
  recorder.ready().then(() => log(`remote: linked to ${SERVER}, recorder ${recorder.host || '(still looking)'}`));

  /* ---- the recorder's alarms ---- */
  const lastSaid = new Map();
  async function listenAlarms() {
    const pathA = '/ISAPI/Event/notification/alertStream';
    for (;;) {
      try {
        await recorder.ready();
        const first = await fetch(base() + pathA, { signal: AbortSignal.timeout(8000) });
        const ch = parseChallenge(first.headers.get('www-authenticate'));
        try { first.body?.cancel(); } catch {}
        const r = await fetch(base() + pathA, { headers: ch ? { Authorization: digestHeader({ user: cfg.user, pass: cfg.pass, method: 'GET', uri: pathA, challenge: ch }) } : {} });
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
  /* The terminals are found the way the recorder is: by serial, or — with "terminals": "auto" — every
     Hikvision access-control terminal (the DS-K… models) that answers the device search. An address in
     the settings is only a first guess. Looked for again every ten minutes. */
  const wantTerms = (cfg.terminals === 'auto' || cfg.terminals === undefined) ? 'auto' : (Array.isArray(cfg.terminals) ? cfg.terminals.filter(t => t && (t.host || t.serial)) : []);
  let terminals = Array.isArray(wantTerms) ? wantTerms.map(t => ({ ...t })) : [];
  const findTerminals = async () => {
    if (wantTerms !== 'auto' && !wantTerms.some(t => t.serial)) return;
    const all = await sadpSearch();
    if (wantTerms === 'auto') {
      const found = all.filter(d => /^DS-K/i.test(d.model));
      const had = terminals.map(t => t.host).join();
      terminals = found.map(d => ({ host: d.ip, port: d.http || 80, serial: d.sn, model: d.model }));
      if (terminals.map(t => t.host).join() !== had) log('attendance: terminals', terminals.length ? terminals.map(t => t.model + ' at ' + t.host).join(', ') : 'none found');
    } else for (const t of terminals) { const d = t.serial && all.find(x => x.sn === t.serial); if (d && d.ip !== t.host) { log(`attendance: ${t.serial} is at ${d.ip}`); t.host = d.ip; t.port = d.http || 80; } }
  };
  if (wantTerms === 'auto' || terminals.length) {
    findTerminals(); setInterval(findTerminals, 10 * 60 * 1000);
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
    const tick = async () => { for (const t of terminals.filter(x => x.host)) { try { await readTerminal(t) } catch (e) { log('attendance', t.host, '—', e.message); findTerminals(); } } };
    tick(); setInterval(tick, 60000);
    log(`attendance: reading ${wantTerms === 'auto' ? 'every terminal it finds' : terminals.map(t => t.serial || t.host).join(', ')} every minute`);
  }
}
