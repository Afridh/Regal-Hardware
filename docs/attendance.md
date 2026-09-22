# The attendance system, joined to the shop system

Written for: whoever looks after the Regal server.

The shop already ran a Shift Board of its own — `shift-api.php` on the web hosting, with the
staff punching in on their phones and a fingerprint machine at the door. That board is now one
of three things reading and writing **the same records**:

| What | Where it writes |
|---|---|
| The Shift Board the staff use | `?action=state` / `?action=day` |
| The fingerprint machine at the door | `?action=punches` (device key) |
| Attendance & pay inside the shop system | the same two, using the till's own sign-in |

Nothing is exported or pasted between them any more, and pay is worked out from whatever the
three of them agree on.

## Where the records live

By default they live on the shop's own server — the same Node server the till uses — and the
addresses above are served at `/shift-api.php`, exactly as the PHP one was. A shop that keeps
its board on web hosting can leave that in place instead: **Settings → Attendance → Attendance
server** takes the full address of `shift-api.php`, and **Sign in to an outside server** stores
a token for it on that PC.

## Signing in

**The board inside the shop system has no sign-in of its own.** It is opened from behind the
till's lock screen, which has already decided who this is, so a second login was only ever a
door to get past. The board takes the till's token and sends it as `Authorization: Bearer …`
on every call, alongside the `X-Shift-Token` header it has always used.

* The **till's own sign-in** is what the server checks. An Owner (or anyone with *payroll* or
  *settings*) counts as the board's owner; everyone else counts as a supervisor.
* A supervisor is given the attendance **with the wages taken out on the server** — rates, pay
  type, advances, the ledger and the money settings never leave it. Hiding them on the page
  would not be the same thing. Removing the board's own login changed none of that: the
  server still decides what it hands over.
* A **Salesman** is not given the board at all. *Attendance & pay* shows them their own
  punches and their own hours, with no rates and nobody else on the page.
* If the server cannot be reached, the board carries on against the records kept on that
  device rather than putting a sign-in up.
* `?action=login` is still there on the server for a board hosted on its own, away from the
  till.

## The fingerprint machine

Set a key on the server and use the same one on the shop PC:

```
# server/.env
SHIFT_DEVICE_KEY=make-up-something-long
SHIFT_PHOTO_DAYS=120          # how long clock-in snapshots are kept
```

Then, after the machine's software has written its log:

```
node tools/finger-sync.mjs --file "C:\ZKTeco\attlog.txt"
node tools/finger-sync.mjs --file attlog.txt --date 2026-09-22
node tools/finger-sync.mjs --file attlog.txt --url https://regalhw.lk/shift/shift-api.php
node tools/finger-sync.mjs --file attlog.txt --dry        # read the file, send nothing
```

Run it from Task Scheduler every evening, or whenever the machine is read.

* The key can post punches and **nothing else** — it cannot read wages or settings, so the shop
  PC never holds anyone's password.
* A reader is matched to a person by the **Fingerprint machine ID** on their card in
  Attendance & pay → The roll. Readers nobody owns are listed back so they can be added.
* The day is built the way the board always built it: the first read is the arrival, the last
  the departure, pairs in between are breaks matched to the nearest scheduled break, and a
  second read within two minutes is the same punch.
* **A day already written or corrected by hand is never overwritten.**

## Snapshots

`?action=photo` keeps the picture taken as someone clocks in or out. They go in the database
rather than a folder, so they work on hosted servers too, and they are deleted after
`SHIFT_PHOTO_DAYS` days. They are never part of the shared records, so the records stay small.

## Inside the shop system

* **Settings → Attendance** — where the records live, whether to sync by itself, send the roll
  up, sign in to an outside server.
* **Attendance & pay** pulls the punches down as it opens, and a punch made there goes straight
  up, so the board and the machine see it within seconds.
* A person on the roll can be linked to a **till sign-in**. When they sign in at the till and
  have not clocked in yet, they are asked once whether to clock in — no walk to the board.
* Pay is still worked out from the board's own rules: start time and grace, paid breaks with
  their allowance, a standard day from opening to closing, overtime past it at the multiplier.

## Moving off the PHP

Nothing has to move. If you do want the records on this server instead:

1. Open the old board, **Settings → Backup**, and save the JSON.
2. In the shop system: Attendance & pay → **Paste an export**, then **Send the roll up**.
3. Point the fingerprint script's `--url` at this server and clear
   Settings → Attendance → Attendance server so the till uses its own.

The old `shift-api.php` can then be deleted. One thing to do either way: **the smslenz API key
that was in that file should be rotated** — it has been shared around. In this system the key
lives in Settings → Messaging on the server, not in a file on the web hosting.
