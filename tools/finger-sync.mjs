// Sends a day's reads from the fingerprint machine to the attendance server.
// The machine's own software exports the reads; point this at that file and it posts them.
// Nothing else is sent, and this PC never holds anyone's password — only the device key.
//
//   node tools/finger-sync.mjs --file "C:\ZKTeco\attlog.txt"
//   node tools/finger-sync.mjs --file attlog.txt --date 2026-09-22          just that day
//   node tools/finger-sync.mjs --file attlog.txt --url https://regalhw.lk/shift/shift-api.php
//   node tools/finger-sync.mjs --file attlog.txt --dry                       show, do not send
//
// The file may be the usual ZKTeco tab/space log (id, date time, …) or a simple CSV with
// an id, a date and a time in any order of columns, one read per line. The key comes from
// SHIFT_DEVICE_KEY in the environment or --key.
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d };
const file = opt('--file'), only = opt('--date'), dry = args.includes('--dry');
const url = (opt('--url') || process.env.SHIFT_API_URL || 'http://127.0.0.1:4000/shift-api.php').replace(/\/$/, '');
const key = opt('--key') || process.env.SHIFT_DEVICE_KEY || '';
if (!file) { console.error('usage: node tools/finger-sync.mjs --file <export from the machine> [--date YYYY-MM-DD] [--url …] [--key …] [--dry]'); process.exit(1) }
if (!key && !dry) { console.error('No device key. Set SHIFT_DEVICE_KEY here and on the server, or pass --key.'); process.exit(1) }

const text = fs.readFileSync(file, 'utf8');
const days = new Map();                                   // date -> [{id, time}]
let bad = 0;
for (const raw of text.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || /^#/.test(line)) continue;
  const parts = line.split(/[\t,;]+|\s{2,}|\s(?=\d{4}-\d{2}-\d{2})/).map(s => s.trim()).filter(Boolean);
  const date = (line.match(/(\d{4}[-/]\d{2}[-/]\d{2})/) || [])[1];
  const time = (line.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/) || [])[0];
  const id = parts.find(p => /^[A-Za-z0-9._-]+$/.test(p) && p !== date && !/^\d{1,2}:\d{2}/.test(p));
  if (!date || !time || !id) { bad++; continue }
  const d = date.replace(/\//g, '-');
  if (only && d !== only) continue;
  if (!days.has(d)) days.set(d, []);
  days.get(d).push({ id, time: time.length === 4 ? '0' + time : time });
}
if (!days.size) { console.error(`Nothing readable in ${file}${only ? ' for ' + only : ''} (${bad} lines skipped)`); process.exit(2) }

for (const [date, events] of [...days].sort()) {
  if (dry) { console.log(`${date}: ${events.length} reads — ${[...new Set(events.map(e => e.id))].join(', ')}`); continue }
  try {
    const r = await fetch(`${url}?action=punches`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, date, events }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) { console.error(`${date}: ${j.error || 'HTTP ' + r.status}`); continue }
    console.log(`${date}: ${j.written} written, ${j.skipped} left as they were${(j.unmatched || []).length ? `, no one owns ${j.unmatched.join(', ')}` : ''}`);
  } catch (e) { console.error(`${date}: could not reach ${url} — ${e.message}`) }
}
if (bad) console.log(`${bad} line(s) in the file were not reads and were skipped.`);
