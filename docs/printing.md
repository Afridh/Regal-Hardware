# Printing from anywhere on the shop's printers

Written for: whoever looks after the Regal server.

The printers are plugged into one PC at the counter — the 80 mm EPSON for receipts and the Canon
for A5 bills. A bill keyed anywhere else has no printer of its own: a phone at the counter, a
second till, the shop's own site on the internet. Those bills are **left on the server as a job**,
and the **print helper** on the PC with the printers takes the next one and prints it.

```
 phone / second till / regalhw.lk ──POST /api/print──▶  server  ──┐
                                                                  │ the helper asks every 2s
 the counter PC  ◀──────────────────── GET /api/print/next ───────┘
        │
        └─▶ renders it with Chrome and hands it to Windows → EPSON TM-T82 / LBP6030w
```

The helper only ever **calls out**, so nothing has to be opened to that PC from outside — no port
forwarding, no fixed address, and it works just as well when the till is the site on the internet.

## Setting it up

One key, the same on both sides.

```
# server/.env  (the shop server, or the hosted one)
PRINT_DEVICE_KEY=make-up-something-long
```

```jsonc
// tools/print-agent/config.json  (the PC the printers are on)
{
  "port": 4100,
  "server": "http://127.0.0.1:4000",   // or https://www.regalhw.lk when the till is the hosted site
  "key": "make-up-something-long",     // the same as PRINT_DEVICE_KEY
  "pollMs": 2000,
  "r80": { "printer": "EPSON TM-T82 Receipt", … },
  "a5":  { "printer": "LBP6030w", … }
}
```

Start it the way it has always been started — the **Regal print helper** shortcut, or
`node tools/print-agent/agent.mjs`. It says on the first line which printers it has and which
server it is watching. With no key set it goes on serving only that PC, as before.

## What happens when a bill prints

1. The till tries the helper **on its own machine** first (`http://localhost:4100`) — nothing to
   wait for, the paper comes out at once. This is what the counter PC does.
2. If there is no helper there — a phone, a tablet, another PC, the site — the bill goes to the
   **shop's queue** and the counter's helper prints it within a couple of seconds. The screen says
   *"… sent to the shop printer"*.
3. If **no helper has asked for work in the last five minutes**, the server refuses the job and the
   browser's own print box opens instead. A queue nobody collects is worse than no queue.

## Watching it

**Settings → Finishing a bill → The shop's printers, from anywhere** shows whether that PC is
listening, which printers it has, how many bills are waiting, and the last few jobs with what
happened to each — printed and on which printer, or failed and why.

## Worth knowing

* Jobs are kept for 48 hours so the owner can see what printed, then tidied away.
* A job a helper took but never finished (the PC was shut down mid-bill) goes back in the queue
  after 90 seconds, so it is not lost.
* Two helpers can watch the same queue — each job is handed to one of them only.
* The key can only take jobs and say how they went. It cannot read the books, the wages or anything
  else, so the counter PC never holds a password.
