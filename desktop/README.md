# Regal POS for Windows

The till (regalhw.lk/pos) as a Windows program: own window, opens and bills without the internet,
prints by itself, updates itself.

- `npm start` — run it from here (set `REGAL_SHOP=http://localhost:4000` to use a local server)
- Printers: found by name on each PC (Zebra → labels, Epson → 80mm, Canon → A5). Ctrl+Shift+P in the
  program to change them or print a test. Drawing and sending is the print helper's own method
  (`backend/tools/print-agent/print-image.ps1` / `print-raw.ps1`, packed in as resources).
- `REGAL_SELFTEST=<folder>` draws a sample 80mm and A5 bill into that folder and quits — no paper.

## Releasing a new version

1. Raise `version` in package.json.
2. `GH_TOKEN=<github token> npm run release` — builds `dist/Regal-POS-Setup-<version>.exe` and publishes
   it as a GitHub release of Afridh/Regal-Hardware.
3. Every installed copy finds it within half an hour, downloads it, and asks to restart.

Changes to the till itself (frontend/) need no release — the program loads them from regalhw.lk.
