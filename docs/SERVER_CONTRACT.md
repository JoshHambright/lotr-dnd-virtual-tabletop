# The self-hosted server's contract

Frozen in Phase 0. Two workstreams build against it without seeing each other's
work — the server itself, and the container that runs it — so everything here
is fixed until the phase closes.

## Entry point and configuration

`packages/server/src/index.ts` starts a server and listens. All configuration
is environment, because a container has nothing else to read.

| Variable       | Default      | Meaning                                              |
| -------------- | ------------ | ---------------------------------------------------- |
| `PORT`         | `8080`       | Port to listen on                                    |
| `DATA_DIR`     | `./data`     | Root of everything that must survive a restart       |
| `TABLE_SECRET` | _(required)_ | Signs GM keys; a server without one refuses to start |
| `LOG_LEVEL`    | `info`       | `debug`, `info`, `warn`, `error`                     |

## What lives on disk

```
$DATA_DIR/
  db/table.sqlite      one file; every table's state
  assets/<hash>        map images, content-addressed
```

Both are created on startup if missing. Nothing else is written outside
`DATA_DIR`, so backing it up is `tar czf` and restoring it is the reverse.

## HTTP surface

The same shape the Cloudflare adapter already serves, so one client talks to
either without knowing which:

| Route                           | Purpose                                                             |
| ------------------------------- | ------------------------------------------------------------------- |
| `POST /api/rooms`               | Open a table; returns `{ code, gmKey }`                             |
| `GET /api/room/:code/exists`    | `{ exists, name }`                                                  |
| `GET /api/room/:code/ws`        | Websocket upgrade; `name`, `key`, `role` in the query               |
| `PUT /api/room/:code/asset`     | GM-only image upload; returns `{ id }`                              |
| `GET /api/room/:code/asset/:id` | Serves an asset, gated exactly as the adapter gates it              |
| `GET /api/room/:code/export`    | GM-only; the whole table as JSON                                    |
| `POST /api/rooms/import`        | GM-only; restores an exported table under a new code                |
| `GET /healthz`                  | `200` once the server is ready to serve — the container healthcheck |

## Behaviour that is not negotiable

- **One process owns a room.** Operations on a table serialize through one
  place, which is what makes two players dragging the same token safe.
- **`authorize` → `reduce` → `projectOp`,** exactly as the adapter does it.
  Role filtering is not reimplemented; it is imported from `@vtt/core`.
- **Every frame is validated** by `@vtt/protocol/schemas` before it reaches the
  reducer.
- **`node scripts/smoke.mjs` passes against it** with `VTT_BASE` pointed at the
  server. Those are the leak assertions, and they are the acceptance test.
