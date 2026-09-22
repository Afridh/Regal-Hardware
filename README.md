# Regal Hardware — shop system (SePOS Web)

The **Regal Hardware** front-end (`app/index.html`) is the primary website: the till in three styles, bill recall,
quotes and delivery notes, customers and receipts, suppliers and their orders, purchases and returns, stock, stock
take, barcode labels, cheques in and out, expenses, drawer counts, accounting and reports, attendance & pay with the
embedded Shift Board, the customer and supplier portals, the online shop, messaging — plus the features brought
across from SePOS: **loyalty points, gift vouchers, locations & stock transfers**.

Behind it is a **Node.js (Express) + PostgreSQL** server. The books are kept in PostgreSQL and shared by every till;
sign-in is checked by the server; each save is versioned so two tills cannot overwrite each other, and the owner
can roll back.

```
sepos-web/
├── app/                    THE WEBSITE
│   ├── index.html          Regal Hardware system (single page)
│   ├── regal-bridge.js     talks to the server: books in PostgreSQL, sign-in, sync between tills, SMS relay
│   ├── regal-ext.js        loyalty points · gift vouchers · locations & stock transfers
│   └── reports/            day sheets published by the Shift Board (created on demand)
├── server/                 Node.js + Express API
│   ├── db/schema.sql       PostgreSQL schema (books store + the relational SePOS tables)
│   ├── db/local-pg.js      self-contained PostgreSQL for development (port 5433, UTF-8)
│   └── src/routes/
│       ├── regal.js        /api/books/*  (login, load, save with revisions, history, restore) · /api/sms/send
│       ├── shiftApi.js     /shift-api.php  (the Shift Board's own API, in Node)
│       └── …               the earlier SePOS relational API (/api/sales, /api/stock … still available)
├── tools/
│   ├── check-app.mjs       syntax-checks every script inside app/index.html
│   └── e2e.mjs             headless end-to-end test: three tills against the live server (jsdom)
└── client/                 the earlier React UI — retired; served at /react only if built
```

## Two front doors

| Address | Who | What |
|---|---|---|
| **`/`** (regalhw.lk) | customers | `app/shop.html` — the shop site: browse and search the live catalogue, basket, checkout with delivery or collection, sign in by mobile + SMS code, track orders, "Ask us". Talks only to `/api/shop/*`; never sees the books. |
| **`/pos`** (regalhw.lk/pos) | staff | `app/index.html` — the whole system behind the lock screen. The site's header and footer carry a **Staff sign in →** link here. |

**How an online order reaches the shop.** The site writes it to its own table (`shop_orders`, number `ONL-00001`…). Every till already polls the server; when the server reports orders waiting, the till pulls the books with the orders merged in (new customer created from the mobile number if needed, bell rings, *Online orders* lists it) and saves — that save is what marks the order imported. So the shared books are still only ever written by a till, and an order can't be lost to a save conflict. The shop then accepts / picks / despatches it in *Online orders* exactly as before, and the customer sees each status on the site. Accepted orders hold their stock on the site.

**Sign-in codes.** `POST /api/shop/otp` texts a 6-digit code through the provider set under *Settings → Messaging*. Until that is switched on, the code comes back in the reply and the site shows it on screen — fine for testing, so turn SMS on before going live.

## Run it (this PC)

Node is at `C:\Program Files\nodejs` (add to PATH: `$env:Path = "C:\Program Files\nodejs;$env:Path"`).

```powershell
cd sepos-web
npm run install:all                 # once (npm may ask you to approve embedded-postgres' install script:
                                    #   cd server; npm install-scripts approve @embedded-postgres/windows-x64; npm rebuild)
# terminal 1 — database (leave running)
cd server; npm run db:local         # PostgreSQL 18 in server/.pgdata, port 5433, UTF-8
# once
cd server; npm run db:setup         # tables + Shift Board logins
# terminal 2 — the website
cd server; npm run dev              # http://localhost:4000
```

Open **http://localhost:4000/pos** (the shop site is at **http://localhost:4000**). The first browser to sign in seeds the demo shop and pushes the books to the server.

**Signing in** — the lock screen lists the staff. Demo passwords are the first name + `123`
(`afridh123`, `asaathkp123`, `raslan123`, `kasun123`, `fathima123`). Change them under *Users and what they may do*.
The **Shift Board** (Attendance & pay → Open the Shift Board app) has its own login: `admin / admin123`
(supervisor: `supervisor / supervisor123`).

## What the server adds to the Regal app

| Concern | How it works now |
|---|---|
| Where the books live | PostgreSQL table `books` (key `regal`), one JSON document with `S` (data) and `CFG` (settings). Every save is a new revision; the last 200 are kept in `books_history` (owner can restore: `POST /api/books/regal/restore/:rev`). |
| Sign-in | `POST /api/books/login` checks the password against the users inside the books — the same hashes the browser makes (`'regal|'+password`, SHA-256 or FNV-1a fallback). Before any books exist it accepts the demo convention / `SEED_ADMIN_PASSWORD` once, so the first till can push the seed. Returns a JWT (12 h). |
| Several tills | `regal-bridge.js` replaces `localStorage` with the API. Every change saves itself (400 ms after the last one, and only when the shared books actually changed), polls `/api/books/regal/rev` every 12 s and pulls newer books — never while a bill is being keyed or a dialog is open. A save against a stale revision gets **409** and the newer copy is loaded. Per-till state (signed-in user, the bill on the screen, the till's location, which page is open) never enters the shared books. |
| Bill numbers | unchanged from Regal: `INVM-<till>-<cashier id>-<running number>`, so two tills never issue the same number. |
| SMS | `POST /api/sms/send` — the server makes the smslenz.lk call with the settings from Settings → Messaging, so the browser never talks to the provider. |
| Shift Board | `/shift-api.php?action=…` implemented in Node (`shift_users` table, state in `books` key `shiftboard`, day sheets published under `/reports/`). The board inside the frame points itself at the parent's server. |
| Offline | The browser keeps a local copy; if the server is unreachable the till keeps working and the header says so. |

## Bringing the old SePOS data across

`npm run import:sepos` reads the old SePOS database (SQL Server `Semicolans_Regalhardware` on this PC, Windows
authentication) and reports what it would bring; `npm run import:sepos -- --write` replaces the business data in the
books with it (the previous books are saved under `server/db/backups/` first). It brings customers, suppliers,
products with prices (no stock — the old system never kept it, so stock starts at zero and the shop is marked as not
tracking it), bank accounts, staff and logins, pending cheques, the last 90 days of bills (`--days 180` for more) as
settled history, and **what each customer owes tied to their actual invoices**: the old till settled the oldest bills
first, so the balance is laid on the newest open credit invoices, which come across as real unpaid bills with their
dates and lines (any part-payment noted). Each supplier's balance comes as one *Balance brought forward* bill. Older
bills stay in SQL Server. Bank balances are not brought across (never reconciled) — enter them from the statements. Runs again any time; each run replaces the
previous import.

## Printing without a print box

`tools/print-agent` is a small helper that runs on the till PC (`start.cmd`, also in the Startup folder as *Regal
print helper*). The till sends each bill to it (`http://localhost:4100/print`) and it prints on the printer set for
that format in `config.json` — 80mm receipts on the EPSON TM-T82, A5 bills on the Canon LBP6030w — rendering the
bill with the Chrome on the PC and handing the image to Windows, so no print box ever appears. If the helper is not
running the browser's print box opens instead, page already sized. *Settings → Finishing a bill → Printing* shows
whether the helper is up and has test buttons for both sizes.

## The two questions at the end of a bill

Once the money is settled and before the bill is written, the till can ask two things — both switched on or off under
*Settings → Finishing a bill → What is asked once the money is taken*, and both skipped with **Esc** so the bill still
goes straight out.

* **Customer's number** (on by default) — key a mobile and the bill goes in that customer's name; a number nobody is on
  offers to add them there and then. Left empty, it stays a walk-in sale, which is the point: the cashier never has to
  answer. Putting a name on the bill is what earns the loyalty points and lets the e-Bill be texted.
* **Who sold it** (off by default) — the salesperson the bill counts towards, the same attribution F3 sets before the
  bill. Salespeople are listed first; Enter on its own leaves the bill with the cashier alone.

Neither question moves a price. By the time they come up the bill is agreed and paid, so a customer picked here only
adds the name — no line is repriced and the total does not change. A bill that already has its customer (anything on
account, which asks earlier) or a salesperson picked with F3 is not asked again.

## Approvals

Some changes need the owner's say-so before they happen: switching a customer's or supplier's portal on/off, changing a
customer's credit limit or price level, removing a customer, taking an amount off a customer or supplier bill (returns,
discounts, write-offs), and changing product prices/cost. The owner — and anyone given the *Approve requests* right
under Users — makes these changes straight away. Everyone else's attempt becomes a **request**: it appears under
*People → Approvals* (with a badge), rings the owner's bell, and nothing changes until the owner approves it (a note can
go back either way; the person who asked is told in their bell). *Settings → Approvals* chooses which changes need asking.
Requests travel with the books, so a cashier can ask from one till and the owner decide on another.

## Features brought across from SePOS

* **Loyalty points** — earned on bills to a named customer (Settings → *Loyalty & vouchers*: points per Rs 100, rupee value, minimum to spend). Spent on the payment screen with **L**. Posts to `6110 Loyalty points redeemed`. Adjust a customer's points from their page.
* **Gift vouchers** — Money → *Gift vouchers*: sell (cash/card/bank → `2060 Gift vouchers not yet used`), print, void. Spent on the payment screen with **V** by code; partial use allowed.
* **Locations & stock transfers** — Stock → *Stock transfers*: stock is counted per location, a till sells from its own (Settings → *Locations*). Transfers move stock without touching the ledger total; a sale is refused when the till's location is short even if the shop holds it elsewhere.

Not carried across: SePOS' FIFO price-link batches. Regal keeps one moving-average cost per item, which is what its ledger, P&L and margins are built on; batch costing would contradict them.

## Checks

```powershell
npm run check       # every script in app/index.html parses
npm run test:e2e    # in its OWN database (sepos_e2e) and port (4010) — never touches the real books; needs db:local running
npm run shot -- out.png 1366 768 [hits]   # screenshot of the till in Chrome/Edge (needs the server; add "hits" to open the match list)
cd server; npm run db:clear-books   # wipe the books (next sign-in seeds the demo shop again)
```

## Deploy to Vercel

`vercel.json` serves `app/` as the static site and runs the Express API as one serverless function
(`api/index.js` → `server/src/app.js`) behind `/api/*`, `/shift-api.php` and `/reports/*`.
Vercel has no PostgreSQL of its own, so the books need a hosted database:

1. Create a PostgreSQL database — e.g. **Neon** (free tier) or Vercel Marketplace → Neon/Supabase. It must be UTF-8 (they are by default). Copy its connection string (`postgresql://…?sslmode=require`).
2. Create the tables and Shift Board logins from this PC, once:
   `cd server; $env:DATABASE_URL="<that string>"; npm run db:setup`
3. In the Vercel project → Settings → Environment Variables set
   `DATABASE_URL`, `JWT_SECRET` (long random string), `SEED_ADMIN_PASSWORD` (first sign-in / Shift Board admin), `CORS_ORIGIN` (your Vercel URL), and optionally `PUBLIC_URL`.
4. Import the GitHub repo (framework preset: *Other*) and deploy. The first browser to sign in seeds the demo shop into the database.

Limits on Vercel: the Shift Board's published day sheets are written to `/tmp` and disappear when the function is recycled (use the on-screen reports instead); the background SMS worker does not run — texts are still sent, on request, through `/api/sms/send`.

## Production notes

* Put the server behind HTTPS (nginx/IIS), set a long `JWT_SECRET`, restrict `CORS_ORIGIN`, set `PUBLIC_URL` (used in Shift Board report links).
* Use a proper PostgreSQL (not `db:local`), created **UTF-8** (`CREATE DATABASE … ENCODING 'UTF8' TEMPLATE template0` — Windows' default WIN1252 cannot store the Sinhala shop name; `npm run db:utf8` fixes an existing dev database).
* Back up: `books` + `books_history` hold the shop; `shift_users` the board logins.
