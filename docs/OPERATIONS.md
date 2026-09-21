# Operations

Written for **Josh**, who runs the server. The GM never touches any of this —
they get a URL and a GM key.

> Phase 1 work. The commands below are the target shape, not yet runnable.

## Running it

```bash
cp .env.example .env     # set TABLE_SECRET, nothing else is required
docker compose up -d
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

Stopping first avoids copying SQLite mid-write. Phase 3 adds an in-app JSON
export per table, which is the thing to use if you want one campaign rather than
everything.

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
- **The GM key** — the only real credential, compared in constant time.
- Rate limiting and message size caps (Phase 3).

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
