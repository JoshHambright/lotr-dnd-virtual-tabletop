# Operations

Written for **Josh**, who runs the server. The GM never touches any of this —
they get a URL and a GM key.

## Running it

```bash
cp .env.example .env
openssl rand -hex 32     # paste into TABLE_SECRET
docker compose up -d
```

The app is then on `http://localhost:8080`, bound to loopback on purpose —
nothing outside the house can reach it until you start the tunnel.

The image builds and runs: `docker compose up -d` brings the app up healthy on
Docker 29 with Compose v5, serving the same tables as a run under Node, because
both read `./data` and derive GM keys from the same `TABLE_SECRET`. You can move
between the two without anyone losing their key.

> **One caveat that remains:** this was verified on Docker Desktop for Windows,
> where a bind mount carries no Unix ownership. On a Linux host `/data` arrives
> owned by the host user instead, and the entrypoint chowns it before dropping
> to the unprivileged `table` user — that path is written but has not been run.

## Running it without Docker

Useful when you want to see an error without a container in the way:

```bash
pnpm install
pnpm --filter @vtt/client build
pnpm --filter @vtt/server build
TABLE_SECRET=$(openssl rand -hex 32) \
  CLIENT_DIR=$PWD/packages/client/dist \
  node packages/server/dist/server.js
```

Two volumes hold everything that matters:

| Volume          | Holds                                   |
| --------------- | --------------------------------------- |
| `./data/db`     | SQLite: tables, sheets, bestiary, rolls |
| `./data/assets` | Map images, content-addressed by hash   |

## Reaching it from outside the house

The app is on `localhost:8080`. Players are not.

A **tunnel** is how they reach it: it dials out from your machine to a public
endpoint, so there is no router configuration, no port forwarding, no dynamic
DNS, and TLS is handled. It keeps working when your home IP changes, and it
works behind CGNAT, where port forwarding simply cannot.

The compose file includes a tunnel service. You supply a token; it prints a
stable HTTPS URL. That URL is what the group bookmarks.

**Do not** port-forward 8080 to the internet as a shortcut. That exposes an
unauthenticated admin surface on your home network with no TLS.

## On game night

The table is only up while your machine is. Worth knowing:

- Sleep settings matter more than uptime. A laptop that suspends takes the table
  with it.
- `docker compose ps` before the session is a ten-second check worth making.
- If players want to edit sheets between sessions, the same image runs on a
  small VPS — a deployment change, not a rewrite (D-002).

## Backups

Both volumes are plain directories:

```bash
docker compose stop
tar czf backup-$(date +%F).tgz data/
docker compose start
```

Stopping first avoids copying SQLite mid-write.

For a single campaign rather than everything, the GM can export a table from
its own URL — this is the copy to keep before trying anything risky:

```bash
curl -O -J "http://localhost:8080/api/room/CODE/export?key=YOUR_GM_KEY"
```

Restoring is a POST of that file to `/api/rooms/import`. It opens the table
under a **new code** rather than overwriting anything, so importing a backup
can never destroy the campaign you imported it next to.

## Upgrading

```bash
git pull && docker compose build && docker compose up -d
```

State survives; it lives in the volumes, not the image. Schema changes run
through the migration hook on startup and are logged. Take a backup first if the
release notes mention a migration.

## Security posture

The tunnel puts this on the public internet, so what protects a table is:

- **The table code** — knowing it is what makes you a player.
- **The GM key** — the only real credential. Derived from the table code and
  `TABLE_SECRET` rather than stored, so it survives a restart and a leaked
  database row is not a key by itself. Compared in constant time.
- Message size caps, and schema validation on every frame before it reaches
  the game state. Rate limiting is Phase 3.

Keep `TABLE_SECRET` out of the repository and out of chat. Changing it
invalidates every GM key you have handed out.

There are no user accounts, by design. Anyone with a table code can join as a
player; that's the intent for a group of friends. It also means a code posted
publicly is an open door — so don't.

## When something breaks mid-session

1. `docker compose logs -f app` — the server logs refused operations with the
   reason, which is usually the answer.
2. Players reconnect automatically with backoff; a hard refresh forces a full
   resync from the server's state.
3. If the tunnel drops, the table state is intact on disk. Restart the tunnel
   service alone; the app keeps running.
4. Worst case, `docker compose restart app` loses nothing committed to SQLite.
