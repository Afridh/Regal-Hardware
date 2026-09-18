// Syntax-checks every inline <script> in app/index.html (including the shift board source kept in
// the text/plain block) so an edit to the 12k-line file cannot silently break the page.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.resolve(here, '../app/index.html'), 'utf8');

const blocks = [];
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m;
while ((m = re.exec(html))) blocks.push({ attrs: m[1], code: m[2], at: html.slice(0, m.index).split('\n').length });

let bad = 0;
for (const b of blocks) {
  if (/src=/.test(b.attrs)) continue;
  if (/type="application\/json"/.test(b.attrs)) { try { JSON.parse(b.code); } catch (e) { console.log(`JSON block at line ${b.at}: ${e.message}`); bad++; } continue; }
  let code = b.code;
  let label = `script at line ${b.at}`;
  if (/type="text\/plain"/.test(b.attrs)) {
    // the shift board: an HTML document; check its own inline scripts
    const inner = code.split('@@SHIFTBOARD_CLOSE_TAG@@').join('</script');
    const re2 = /<script([^>]*)>([\s\S]*?)<\/script>/g; let m2;
    while ((m2 = re2.exec(inner))) {
      if (/application\/json/.test(m2[1])) continue;
      try { new vm.Script(m2[2], { filename: 'shiftboard.js' }); console.log(`ok   shift board script (${m2[2].length} chars)`); }
      catch (e) { console.log(`FAIL shift board script: ${e.message}\n${e.stack.split('\n').slice(0, 3).join('\n')}`); bad++; }
    }
    continue;
  }
  try { new vm.Script(code, { filename: 'app.js' }); console.log(`ok   ${label} (${code.length} chars)`); }
  catch (e) {
    bad++;
    // vm reports the line inside the block; translate to the html line
    const mm = /app\.js:(\d+)/.exec(e.stack || '');
    const line = mm ? b.at + Number(mm[1]) - 1 : '?';
    console.log(`FAIL ${label}: ${e.message}  (index.html line ~${line})`);
    console.log((e.stack || '').split('\n').slice(0, 4).join('\n'));
  }
}
console.log(bad ? `\n${bad} problem(s)` : '\nall scripts parse');
process.exitCode = bad ? 1 : 0;
