// Find the Hikvision gear on this network and say exactly what is there.
//
//   node tools/camera-agent/find.mjs --user admin --pass yourpassword
//   node tools/camera-agent/find.mjs --host 192.168.1.64 --user admin --pass ...
//
//   --host IP      just this one, no searching
//   --range 192.168.1   search this network instead of the ones this PC is on
//   --ports 80,8080      ports to knock on (default 80, 8080, 443)
//   --out DIR      where to put the test stills (default beside this file)
//
// It reads and nothing else: no setting is changed on any camera or recorder. Run it on the
// PC in the shop — the cameras are on the shop's own network and nothing outside can see them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { deviceInfo, channels, snapshot } from './hik.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i >= 0 ? process.argv[i + 1] : d };
const user = arg('user', 'admin'), pass = arg('pass', '');
const auth = { user, pass, timeout: 6000 };
const OUT = path.resolve(arg('out', here));
const PORTS = String(arg('ports', '80,8080,443')).split(',').map(n => +n.trim()).filter(Boolean);

if (!pass) {
  console.log('Give the camera password:  node tools/camera-agent/find.mjs --user admin --pass yourpassword');
  console.log('(the same one you use in the Hikvision app or the recorder\'s own screen)');
  process.exit(1);
}

/* ---------- which networks this PC is on ---------- */
function myNetworks() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ name, ip: a.address, base: a.address.split('.').slice(0, 3).join('.') });
    }
  }
  return out;
}

/* ---------- is anything listening there? ---------- */
const knock = (host, port, ms = 450) => new Promise(res => {
  const s = new net.Socket();
  let done = false;
  const end = ok => { if (done) return; done = true; s.destroy(); res(ok) };
  s.setTimeout(ms);
  s.once('connect', () => end(true));
  s.once('timeout', () => end(false));
  s.once('error', () => end(false));
  s.connect(port, host);
});

async function sweep(base, ports) {
  const hosts = [];
  const jobs = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${base}.${i}`;
    jobs.push((async () => {
      for (const p of ports) if (await knock(ip, p)) { hosts.push({ ip, port: p }); return }
    })());
  }
  await Promise.all(jobs);
  return hosts.sort((a, b) => +a.ip.split('.')[3] - +b.ip.split('.')[3]);
}

/* ---------- look at one ---------- */
async function look({ ip, port }) {
  const base = (port === 443 ? 'https://' : 'http://') + ip + (port === 80 || port === 443 ? '' : ':' + port);
  const info = await deviceInfo(base, auth);
  if (!info.ok) return { base, ip, port, ...info };
  const chans = await channels(base, auth);
  const list = chans.length ? chans : [{ ch: 101, name: '' }];
  const shots = [];
  for (const c of list.slice(0, 16)) {
    const s = await snapshot(base, c.ch, auth);
    if (s.ok) {
      const f = path.join(OUT, `camera-${ip.replace(/\./g, '_')}-${c.ch}.jpg`);
      try { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(f, s.buf) } catch {}
      shots.push({ ...c, ok: true, bytes: s.bytes, file: f });
    } else shots.push({ ...c, ok: false, why: s.error });
  }
  return { base, ip, port, ...info, shots };
}

/* ---------- go ---------- */
const only = arg('host', null);
let targets = [];
if (only) {
  targets = [{ ip: only, port: +arg('port', 80) }];
  console.log(`looking at ${only}\n`);
} else {
  const nets = arg('range', null)
    ? [{ name: 'given', ip: '', base: arg('range') }]
    : myNetworks();
  if (!nets.length) { console.log('This PC is not on any network I can see.'); process.exit(1) }
  for (const n of nets) {
    console.log(`searching ${n.base}.1-254 on ports ${PORTS.join(', ')}${n.ip ? `  (this PC is ${n.ip})` : ''} …`);
    const found = await sweep(n.base, PORTS);
    console.log(`  ${found.length} thing${found.length === 1 ? '' : 's'} answered`);
    targets = targets.concat(found);
  }
  console.log('');
}

const hik = [];
for (const t of targets) {
  const r = await look(t);
  if (!r.ok) {
    if (r.status === 401) console.log(`  ${r.ip}:${r.port}  Hikvision, but the password was refused`);
    continue;                                   // everything else on the network is not our business
  }
  hik.push(r);
  console.log(`\n=== ${r.ip}${r.port === 80 ? '' : ':' + r.port}`);
  console.log(`    ${r.kind || 'device'}  ${r.model || ''}  ${r.name ? '"' + r.name + '"' : ''}`);
  console.log(`    firmware ${r.firmware || '?'}${r.released ? ' (' + r.released + ')' : ''}   serial ${r.serial || '?'}`);
  if (r.analog || r.digital) console.log(`    ${r.analog} analog and ${r.digital} network camera inputs`);
  console.log(`    channels: ${r.shots.length}`);
  for (const s of r.shots) {
    console.log(s.ok
      ? `      ${String(s.ch).padEnd(5)} ${(s.name || '(no name)').padEnd(22)} picture ok, ${Math.round(s.bytes / 1024)} KB  →  ${path.basename(s.file)}`
      : `      ${String(s.ch).padEnd(5)} ${(s.name || '(no name)').padEnd(22)} no picture — ${s.why}`);
  }
}

if (!hik.length) {
  console.log('\nNothing Hikvision answered.');
  console.log('Worth trying:  --user and --pass as used in the app; --ports 80,8080,8000;');
  console.log('and running this on the PC in the shop, since the cameras cannot be seen from outside it.');
  process.exit(1);
}

console.log('\n\n---- paste this back and the system can be told about them ----\n');
console.log(JSON.stringify({
  cameras: hik.flatMap(d => d.shots.filter(s => s.ok).map(s => ({
    host: d.ip, port: d.port, channel: s.ch,
    name: s.name || `${d.model || 'Camera'} ${s.ch}`,
    device: d.model || '', kind: d.kind || ''
  })))
}, null, 2));
console.log(`\nand the test stills are in ${OUT}`);
