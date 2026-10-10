#!/usr/bin/env bash
# Safe deploy for regalhw.lk — back up, pull, install, self-test, restart, health-check, and roll
# back if anything fails. Run it from the repo root on the server:
#
#   bash deploy.sh
#
# What it does, in order:
#   1. backs up the books to db/backups (aborts if that fails — never deploy without a backup)
#   2. remembers the current commit so it can roll back
#   3. git pull (fast-forward only)
#   4. npm install in server/
#   5. syntax-checks every server .js file
#   6. restarts the app (Passenger: touches server/tmp/restart.txt)
#   7. waits for /api/health to say the database is up
#   8. if the pull, install, self-test or health check fails, puts the old code back and restarts
#
# Override the health URL if needed:  HEALTH_URL=https://regalhw.lk/api/health bash deploy.sh
set -u
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
APP="$ROOT/server"
NODE="${NODE:-node}"
HEALTH_URL="${HEALTH_URL:-https://regalhw.lk/api/health}"
say(){ printf '\n\033[1m%s\033[0m\n' "$*"; }
die(){ printf '\n\033[31mDEPLOY STOPPED: %s\033[0m\n' "$*" >&2; exit 1; }

restart(){ mkdir -p "$APP/tmp"; touch "$APP/tmp/restart.txt"; }
health(){ # returns 0 when the app answers db:up within ~40s
  for i in $(seq 1 20); do
    body="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
    case "$body" in *'"db":"up"'*) return 0;; esac
    sleep 2
  done
  return 1
}

say "1/7  Backing up the books…"
( cd "$APP" && "$NODE" db/backup-books.js --tag predeploy ) || die "backup failed — nothing was changed"

PREV="$(git rev-parse HEAD)" || die "not a git repo"
say "2/7  Current commit is $PREV"

rollback(){
  say "Rolling back to $PREV…"
  git reset --hard "$PREV" >/dev/null 2>&1
  ( cd "$APP" && npm install --no-audit --no-fund >/dev/null 2>&1 )
  restart
  die "$1 — rolled back to the previous version."
}

say "3/7  Pulling the latest code…"
git pull --ff-only || die "git pull failed (no changes made)"

say "4/7  Installing server dependencies…"
( cd "$APP" && npm install --no-audit --no-fund ) || rollback "npm install failed"

say "5/7  Syntax-checking the server…"
bad=0
while IFS= read -r f; do "$NODE" --check "$f" || { echo "  bad: $f"; bad=1; }; done \
  < <(find "$APP/src" "$APP/db" -name '*.js' 2>/dev/null)
[ "$bad" = 0 ] || rollback "a server file did not pass the syntax check"

say "6/7  Restarting the app…"
restart

say "7/7  Waiting for the shop to come back…"
if health; then
  say "Deployed. The shop is up ($HEALTH_URL)."
else
  rollback "the shop did not come back healthy after the restart"
fi
