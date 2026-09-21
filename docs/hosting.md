# Putting the system on the internet (Vercel + a hosted database)

The pages (shop site, till, suppliers' page) are static files; the API runs as one Vercel
function. What the API needs is a **PostgreSQL database it can reach** — the embedded one on the
shop PC (port 5433) is not reachable from Vercel, so without a hosted database every sign-in
fails with `connect ECONNREFUSED 127.0.0.1:5432`.

## 1. A hosted PostgreSQL (free)

[Neon](https://neon.tech) — sign up, *New project* (region Singapore), copy the **connection
string** (`postgresql://…@….neon.tech/neondb?sslmode=require`). Supabase or Vercel Postgres work
the same way.

## 2. Tell Vercel about it

Vercel → your project → *Settings* → *Environment Variables* (Production):

| Name | Value |
|---|---|
| `DATABASE_URL` | the Neon connection string |
| `JWT_SECRET` | a long random sentence — sign-ins are signed with it |
| `SHOP_TZ` | `Asia/Colombo` |

Then *Deployments* → ⋯ on the latest → **Redeploy**. `https://<site>/api/health` should now say
`"db":"up"`. The tables are created on first use.

## 3. Copy the shop's books up

On the shop PC (the embedded database running):

```
cd sepos-web\server
node db/push-books.js --to "postgresql://…neon.tech/neondb?sslmode=require" --check   # what is where
node db/push-books.js --to "postgresql://…neon.tech/neondb?sslmode=require"           # copy
```

It copies the books (with the last 20 saved versions), product/site pictures, attached files and
website orders. It refuses to overwrite hosted books that are newer than the shop's unless you
add `--force`.

Now sign in at `https://<site>/pos` with the usual staff logins.

## 4. One set of books, not two

After the copy there are two databases with the same books. Whichever the tills write to is the
real one, and the other drifts. Pick one:

- **Recommended — everything on the hosted database.** In `server/.env` on the shop PC set
  `DATABASE_URL` to the Neon string (keep the embedded one as a fallback) and restart the API.
  The tills, the website and the suppliers' page then all read and write the same books; the
  shop PC can be switched off and the site keeps working.
- **Shop PC stays the master.** Keep the tills on the embedded database and run `push-books.js`
  whenever the site should catch up. Website and supplier orders that arrive on the hosted side
  in between are *not* pulled back automatically — only do this if the site is for looking, not
  ordering.

## Custom domain

Vercel → project → *Settings* → *Domains* → add `regalhw.lk` and follow the DNS instructions
(an A record and a CNAME for `www` at the registrar). The pages already refer to the domain
from Settings → The shop site.
