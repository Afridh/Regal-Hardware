/* Finding the recorder by what it IS, not where it was.

   The router hands out addresses and may hand the recorder a new one any day — that is how the shop's
   cameras went blank when it moved from 192.168.1.2 to .152. So nothing here keeps an address as the
   truth. The recorder is known by its serial number, and its address is asked for with Hikvision's own
   device search (SADP: a question shouted on the local network at 239.255.255.250:37020, which every
   Hikvision recorder and camera answers with its serial, model and address — the same search their
   SADP tool and Hik-Connect's "add device" use). When pictures stop coming, it is asked again.

   The first time, with no serial written down, the one Hikvision recorder that answers is taken and
   its serial kept (in recorder.json beside this file), so from then on it is that one, wherever it goes. */
import dgram from 'node:dgram';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Everything Hikvision on this network, as it describes itself. */
export function sadpSearch(ms = 3000) {
  return new Promise((done) => {
    const found = new Map();
    let s;
    try { s = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch { return done([]); }
    const pick = (x, t) => ((x.match(new RegExp('<' + t + '>([^<]*)</' + t + '>', 'i')) || [])[1] || '').trim();
    s.on('message', (m, r) => {
      const x = m.toString('utf8');
      if (!/ProbeMatch/i.test(x)) return;
      const sn = pick(x, 'DeviceSN');
      found.set(sn || r.address, { ip: pick(x, 'IPv4Address') || r.address, sn, mac: pick(x, 'MAC').toLowerCase(),
        model: pick(x, 'DeviceDescription'), http: +pick(x, 'HttpPort') || 80, type: pick(x, 'DeviceType') });
    });
    s.on('error', () => { try { s.close() } catch {} done([...found.values()]); });
    s.bind(0, () => {
      try { s.setBroadcast(true); s.setMulticastTTL(2); } catch {}
      const probe = `<?xml version="1.0" encoding="utf-8"?><Probe><Uuid>${crypto.randomUUID().toUpperCase()}</Uuid><Types>inquiry</Types></Probe>`;
      for (let i = 0; i < 3; i++) setTimeout(() => { try { s.send(probe, 37020, '239.255.255.250') } catch {} }, i * 400);
      setTimeout(() => { try { s.close() } catch {} done([...found.values()]); }, ms);
    });
  });
}

/** The shop's recorder: where it is now, found again whenever it stops answering. */
export function makeRecorder({ cfg, here, log }) {
  const file = path.join(here, 'recorder.json');
  const saved = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} } })();
  const want = { serial: (cfg.recorder && cfg.recorder.serial) || saved.serial || '', mac: ((cfg.recorder && cfg.recorder.mac) || saved.mac || '').toLowerCase() };
  // where it was last time, to start with — or an address written in the settings, as a first guess only
  let cur = saved.host ? { host: saved.host, port: saved.port || 80 } : (cfg.recorder && cfg.recorder.host ? { host: cfg.recorder.host, port: cfg.recorder.port || 80 } : null);
  let finding = null, lastFind = 0, misses = 0;
  const keep = (d) => { try { fs.writeFileSync(file, JSON.stringify({ serial: d.sn, mac: d.mac, model: d.model, host: d.ip, port: d.http, at: new Date().toISOString() }, null, 2)) } catch {} };
  async function find(why) {
    if (finding) return finding;
    lastFind = Date.now();
    finding = (async () => {
      const all = await sadpSearch();
      const recs = all.filter(d => d.ip);
      let d = want.serial ? recs.find(x => x.sn === want.serial) : null;
      if (!d && want.mac) d = recs.find(x => x.mac === want.mac);
      if (!d && !want.serial && !want.mac) {
        // nothing written down yet: the recorder is the one that is a recorder (DS-7…/DS-9…, or "DVR"/"NVR")
        const r = recs.filter(x => /^(DS|iDS)-[79]/i.test(x.model) || /dvr|nvr/i.test(x.model));
        d = r.length === 1 ? r[0] : (recs.length === 1 ? recs[0] : null);
        if (!d && recs.length) log('recorder: more than one Hikvision device answers — put its serial in config.local.json ("recorder": { "serial": … }):', recs.map(x => `${x.model} ${x.sn} ${x.ip}`).join(' | '));
      }
      if (d) {
        const moved = !cur || cur.host !== d.ip || +cur.port !== +d.http;
        cur = { host: d.ip, port: d.http || 80 };
        want.serial = d.sn; want.mac = d.mac; keep(d); misses = 0;
        if (moved) log(`recorder: ${d.model} (${d.sn}) is at ${d.ip}${why ? ' — ' + why : ''}`);
      } else if (all.length === 0) log('recorder: nothing Hikvision answered the search — is the recorder on, and on this network?');
      return cur;
    })().finally(() => { finding = null; });
    return finding;
  }
  find('starting');
  setInterval(() => find(), 10 * 60 * 1000).unref();      // and now and then anyway, in case it moved quietly
  return {
    get host() { return cur && cur.host },
    get port() { return (cur && cur.port) || 80 },
    base() { return cur ? 'http://' + cur.host + (+cur.port !== 80 ? ':' + cur.port : '') : null },
    ready() { return finding || Promise.resolve(cur) },
    /** pictures did not come: after a few in a row, look for it again (not more than twice a minute) */
    missed() { if (++misses >= 3 && Date.now() - lastFind > 30000) find('it had stopped answering'); },
    ok() { misses = 0; },
    serial() { return want.serial },
  };
}
