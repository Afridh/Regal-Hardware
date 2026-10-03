// A pretend Hikvision, for trying the Cameras page without a camera.
//   node tools/camera-agent/fake-camera.mjs [port]
// It answers ISAPI the way a real one does — digest first, then device info, channels and a
// still that changes every second so it is obvious the picture is live.
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
const PORT = +process.argv[2] || 8099;
const USER = 'admin', PASS = 'Regal@123', REALM = 'IP Camera(C1234)', NONCE = 'n'.repeat(32);
const md5 = v => crypto.createHash('md5').update(v).digest('hex');
const DEV = `<DeviceInfo><deviceName>Pretend NVR</deviceName><model>DS-7608NI-K2</model>
<serialNumber>TEST0001</serialNumber><firmwareVersion>V4.30.085</firmwareVersion>
<deviceType>NVR</deviceType><videoInputPortNums>3</videoInputPortNums><digitalInputPortNums>3</digitalInputPortNums></DeviceInfo>`;
const CHANS = `<InputProxyChannelList>
<InputProxyChannel><id>1</id><name>Counter</name></InputProxyChannel>
<InputProxyChannel><id>2</id><name>Yard gate</name></InputProxyChannel>
<InputProxyChannel><id>3</id><name>Store room</name></InputProxyChannel></InputProxyChannelList>`;
/* A real picture, so a browser can actually show it. A JPEG is awkward to build by hand;
   a PNG is not, and an <img> does not care which it is. The colour walks with the clock, so
   it is obvious at a glance that the page is fetching fresh ones. */
const png = (n) => {
  const W = 320, H = 180;
  const col = [(n * 37) % 256, (n * 83) % 256, (n * 151) % 256];
  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    const off = y * (1 + W * 3);
    raw[off] = 0;
    for (let x = 0; x < W; x++) {
      const p = off + 1 + x * 3;
      raw[p] = col[0]; raw[p + 1] = col[1]; raw[p + 2] = col[2];
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))
  ]);
};
let CRC = null;
function crc32(buf) {
  if (!CRC) { CRC = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff);
}
http.createServer((req, res) => {
  const a = req.headers.authorization || '';
  if (!a) { res.writeHead(401, { 'WWW-Authenticate': `Digest realm="${REALM}", qop="auth", nonce="${NONCE}"` }); return res.end('401') }
  const f = k => (new RegExp(k + '="?([^",]+)"?').exec(a) || [])[1] || '';
  const want = md5(md5(`${USER}:${REALM}:${PASS}`) + ':' + NONCE + ':' + f('nc') + ':' + f('cnonce') + ':auth:' + md5(req.method + ':' + f('uri')));
  if (f('username') !== USER || f('response') !== want) { res.writeHead(401); return res.end('bad password') }
  if (req.url === '/ISAPI/System/deviceInfo') { res.writeHead(200, {'Content-Type':'application/xml'}); return res.end(DEV) }
  if (req.url === '/ISAPI/ContentMgmt/InputProxy/channels') { res.writeHead(200, {'Content-Type':'application/xml'}); return res.end(CHANS) }
  if (/\/ISAPI\/Streaming\/channels\/\d+\/picture$/.test(req.url)) { res.writeHead(200, {'Content-Type':'image/png'}); return res.end(png(Date.now()/1000|0)) }
  res.writeHead(404); res.end('404');
}).listen(PORT, '127.0.0.1', () => console.log(`pretend camera on http://127.0.0.1:${PORT}  (admin / ${PASS})`));
