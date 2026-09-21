# Hosting

## Deploying

```bash
npm install
npx wrangler login      # opens a browser; a free Cloudflare account is enough
npm run deploy
```

`npm run deploy` builds the client and pushes the Worker. It prints a URL like
`https://middle-earth-vtt.<your-subdomain>.workers.dev`. That single URL is the
app, the websockets and the map images — send it to your group and you're done.

There is nothing else to provision. No database, no storage bucket, no
environment variables, no secrets. Map images are stored as chunked blobs in
each table's own Durable Object storage, which is why R2 — and therefore adding
a payment method — never comes into it.

To change the name in the URL, edit `name` in `wrangler.toml` before deploying.

## Does the free plan cover this?

For one group, comfortably.

- **Workers** free plan: 100,000 requests a day. A four-hour session with six
  people is a few thousand, most of it websocket frames that don't count as
  requests.
- **Durable Objects** free plan covers SQLite-backed objects, which is what this
  uses — hence `new_sqlite_classes` in the migration. The older key-value
  objects are paid; don't switch the migration to them.
- **Storage**: 5 GB. Maps are resized to 3000px on the longest edge and
  re-encoded to WebP before upload, so a typical battle map lands well under a
  megabyte. You would need hundreds of maps to notice.
- **Duration**: websockets use the hibernation API, so a table left open while
  everyone talks on the call is not billed for sitting there.

The one limit worth knowing: a single upload is capped at 12 MB, and the client
shrinks images before sending, so a phone photo of a hand-drawn map is fine.

## Custom domain

Optional. In the Cloudflare dashboard, Workers & Pages → your worker → Settings
→ Domains & Routes → Add custom domain. Nothing in the app needs changing; it
derives its websocket URL from wherever it is being served.

## Local development

```bash
npm run dev
```

Serves the whole stack on `http://localhost:8787` with a local Durable Object
and local storage. State lives in `.wrangler/` and survives restarts; delete
that directory to start clean.

To try it as two people, open a normal window and a private one — the GM key is
kept in local storage, so the private window joins as a player.

## Backups, and what happens to old tables

Each table's state lives in its own Durable Object, keyed by its code, and
persists indefinitely. Nothing expires on its own.

There is no export yet. If a campaign matters, the honest answer today is that
it lives in one place with no backup, and adding a "download this table as JSON"
button is a small piece of work worth doing before you rely on it for a long
campaign. The state is already one serializable object, so it is mostly a route
and a link.

A table code cannot be reused once taken: opening a table with a code that
already exists returns 409 rather than clobbering it.

## Upgrading

`npm run deploy` again. State survives deploys — the Durable Object's storage is
independent of the Worker's code. If you change the shape of `RoomState` in a
way old data doesn't satisfy, existing tables will need migrating in
`TableRoom`'s `#migrate`, which today only creates tables and is the right place
for it.
