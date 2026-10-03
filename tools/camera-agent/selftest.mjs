// Can we talk Hikvision's language? Checked without a camera.
//   node tools/camera-agent/selftest.mjs
//
// Digest authentication is the part that silently fails: the camera answers 401, and an
// answer worked out even slightly wrong gets another 401 and looks exactly like a wrong
// password. So it is checked against the worked example in RFC 2617, and then the whole
// exchange is run against a pretend Hikvision that behaves like the real one.
import http from 'node:http';
import crypto from 'node:crypto';
import { parseChallenge, digestHeader, isapi, deviceInfo, channels, snapshot, tag, tagsAll } from './hik.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ok   ' + m)) : (fail++, console.log('  FAIL ' + m)) };

/* ---------- 1. the challenge, as a camera writes it ---------- */
const HDR = 'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"';
const ch = parseChallenge(HDR);
ok(ch && ch.realm === 'testrealm@host.com', 'the realm is read out of the challenge');
ok(ch && ch.nonce === 'dcd98b7102dd2f0e8b11d0f600bfb0c093', 'and the nonce');
ok(ch && ch.opaque === '5ccc069c403ebaf9f0171e9517f40e41', 'and the opaque, which has to come back untouched');
ok(parseChallenge('Basic realm="x"') === null, 'a Basic challenge is not mistaken for a Digest one');
ok(parseChallenge('') === null, 'and neither is nothing at all');

/* ---------- 2. the answer, against the worked example in the RFC ---------- */
const hdr = digestHeader({ user: 'Mufasa', pass: 'Circle Of Life', method: 'GET',
  uri: '/dir/index.html', challenge: ch, nc: 1, cnonce: '0a4f113b' });
ok(/response="6629fae49393a05397450978507c4ef1"/.test(hdr),
   'the answer matches the one printed in RFC 2617 — the sums are right');
ok(/qop=auth(,|\s|$)/.test(hdr), 'it offers qop=auth, picked out of the two the camera listed');
ok(/nc=00000001/.test(hdr), 'with the count written as eight digits, as the standard insists');
ok(/opaque="5ccc069c403ebaf9f0171e9517f40e41"/.test(hdr), 'and hands the opaque back');
ok(/uri="\/dir\/index\.html"/.test(hdr), 'and names the path it is for');

/* ---------- 3. a pretend Hikvision, behaving like one ---------- */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(900, 7), Buffer.from([0xff, 0xd9])]);
const DEV = `<?xml version="1.0" encoding="UTF-8"?>
<DeviceInfo version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<deviceName>Regal NVR</deviceName><deviceID>abc</deviceID><model>DS-7608NI-K2</model>
<serialNumber>DS-7608NI-K20420210101</serialNumber><macAddress>44:47:cc:11:22:33</macAddress>
<firmwareVersion>V4.30.085</firmwareVersion><firmwareReleasedDate>build 210222</firmwareReleasedDate>
<deviceType>NVR</deviceType><videoInputPortNums>8</videoInputPortNums><digitalInputPortNums>8</digitalInputPortNums>
</DeviceInfo>`;
const CHANS = `<?xml version="1.0" encoding="UTF-8"?>
<InputProxyChannelList version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<InputProxyChannel><id>1</id><name>Counter</name></InputProxyChannel>
<InputProxyChannel><id>2</id><name>Yard gate</name></InputProxyChannel>
<InputProxyChannel><id>3</id><name>Store room</name></InputProxyChannel>
</InputProxyChannelList>`;

let served = 0, challenged = 0;
const srv = http.createServer((req, res) => {
  served++;
  const a = req.headers.authorization || '';
  if (!a) {                                                   // exactly what a camera does first
    challenged++;
    res.writeHead(401, { 'WWW-Authenticate': `Digest realm="IP Camera(C1234)", qop="auth", nonce="${'n'.repeat(32)}", opaque="0000002a", stale="FALSE"` });
    return res.end('<html>401 Unauthorized</html>');
  }
  // work out what the answer should have been, exactly as a camera does, so a wrong
  // password is actually refused and this test can tell a right answer from a shaped one
  const f = k => (new RegExp(k + '="?([^",]+)"?').exec(a) || [])[1] || '';
  const md5 = v => crypto.createHash('md5').update(v).digest('hex');
  const NONCE = 'n'.repeat(32);
  const ha1 = md5('admin:IP Camera(C1234):Regal@123');
  const ha2 = md5(req.method + ':' + f('uri'));
  const want = md5(ha1 + ':' + NONCE + ':' + f('nc') + ':' + f('cnonce') + ':auth:' + ha2);
  if (f('username') !== 'admin' || f('response') !== want) {
    res.writeHead(401); return res.end('bad');
  }
  if (req.url === '/ISAPI/System/deviceInfo') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(DEV) }
  if (req.url === '/ISAPI/ContentMgmt/InputProxy/channels') { res.writeHead(200, { 'Content-Type': 'application/xml' }); return res.end(CHANS) }
  if (/^\/ISAPI\/Streaming\/channels\/(\d+)\/picture$/.test(req.url)) {
    const c = +RegExp.$1;
    if (c === 301) { res.writeHead(403, { 'Content-Type': 'application/xml' }); return res.end('<ResponseStatus><statusString>Invalid Operation</statusString></ResponseStatus>') }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' }); return res.end(JPEG);
  }
  res.writeHead(404); res.end('<html>404</html>');
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + srv.address().port;
const auth = { user: 'admin', pass: 'Regal@123', timeout: 4000 };

const info = await deviceInfo(base, auth);
ok(challenged > 0, 'the camera asked who we were, as a real one does');
ok(info.ok, 'and let us in on the second try, which is the whole point of digest');
ok(info.model === 'DS-7608NI-K2' && info.kind === 'NVR', `it says what it is — ${info.kind} ${info.model}`);
ok(info.name === 'Regal NVR', 'and what it is called');
ok(info.firmware === 'V4.30.085', 'and its firmware');
ok(info.analog === 8 && info.digital === 8, 'and how many cameras it can take');

const list = await channels(base, auth);
ok(list.length === 3, `three channels found — ${list.map(c => c.name).join(', ')}`);
ok(list[0].ch === 101 && list[1].ch === 201, 'a recorder numbers them 1, 2, 3 and a still is asked for as 101, 201 — translated');
ok(list[0].name === 'Counter', 'with the names the shop gave them');

const s1 = await snapshot(base, 101, auth);
ok(s1.ok && s1.bytes === JPEG.length, `a still comes back, ${s1.bytes} bytes`);
ok(s1.buf[0] === 0xff && s1.buf[1] === 0xd8, 'and it really is a JPEG, not an error page with the wrong label');

const s3 = await snapshot(base, 301, auth);
ok(!s3.ok, 'a channel with nothing plugged into it does not pretend to have a picture');
ok(/Invalid Operation/.test(s3.error || ''), `and says what the recorder said — "${(s3.error || '').slice(0, 40)}"`);

/* ---------- 4. the wrong password looks like the wrong password ---------- */
const bad = await deviceInfo(base, { user: 'admin', pass: 'wrong', timeout: 4000 });
ok(!bad.ok && bad.status === 401, 'a wrong password is refused');
ok(/password/i.test(bad.error || ''), `and says so plainly — "${bad.error}"`);

/* ---------- 5. something that is not a camera at all ---------- */
const other = http.createServer((q, s) => { s.writeHead(200, { 'Content-Type': 'text/html' }); s.end('<html>a printer</html>') });
await new Promise(r => other.listen(0, '127.0.0.1', r));
const notCam = await deviceInfo('http://127.0.0.1:' + other.address().port, auth);
ok(!notCam.ok, 'something else on the network is not taken for a camera');
await new Promise(r => other.close(r));

/* ---------- 6. nothing there at all ---------- */
const dead = await isapi('http://127.0.0.1:9', '/ISAPI/System/deviceInfo', { ...auth, timeout: 800 });
ok(dead.status === 0 && dead.error, `a address with nothing on it gives up quietly — "${dead.error}"`);

/* ---------- 7. reading XML without pretending to parse it ---------- */
ok(tag(DEV, 'model') === 'DS-7608NI-K2', 'a value is read out by name');
ok(tag(DEV, 'notThere') === '', 'and a missing one is empty, not a crash');
ok(tagsAll(CHANS, 'name').join() === 'Counter,Yard gate,Store room', 'and every one of a repeated tag');

await new Promise(r => srv.close(r));
console.log(`\n  ${pass} passed, ${fail} failed   (${served} requests to the pretend camera)`);
process.exitCode = fail ? 1 : 0;   // let node close its own handles; exiting mid-close upsets it on Windows
