// Maintenance mode from the server's command line — for when the till cannot be reached.
//   node tools/maintenance.mjs status
//   node tools/maintenance.mjs on [--all] [--msg "Stock-taking tonight"] [--until 2026-10-28T09:00]
//   node tools/maintenance.mjs off
//   node tools/maintenance.mjs intro shutter|fade|none     how the page opens
// --all stops the tills and the shift board too; without it only the website stops. The running server
// sees the change within two seconds — no restart.
import { mxState, mxSave, MX_FILE, INTROS } from '../src/lib/maintenance.js';

const [cmd = 'status', ...rest] = process.argv.slice(2);
const opt = n => { const i = rest.indexOf('--' + n); return i < 0 ? undefined : (rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : true) };
const show = s => {
  console.log(s.on ? `ON  · ${s.scope === 'all' ? 'everything (website, tills, shift board)' : 'the website only'} · since ${s.since}${s.until ? ' · back by ' + s.until : ''}` : 'OFF');
  if (s.msg) console.log('message: ' + s.msg);
  if (s.on && s.key) console.log('preview link (lets one browser in): /?mx=' + s.key);
  console.log('file: ' + MX_FILE);
};
if (cmd === 'on') show(mxSave({ on: true, scope: opt('all') ? 'all' : 'site', msg: typeof opt('msg') === 'string' ? opt('msg') : mxState().msg, until: typeof opt('until') === 'string' ? opt('until') : '', by: 'server' }));
else if (cmd === 'off') show(mxSave({ on: false }));
else if (cmd === 'intro' && INTROS.includes(rest[0])) { mxSave({ intro: rest[0] }); show(mxState()); console.log('the page opens with: ' + rest[0]) }
else if (cmd === 'status') show(mxState());
else { console.error('use: status | on [--all] [--msg "…"] [--until 2026-10-28T09:00] | off | intro shutter|fade|none'); process.exit(1) }
