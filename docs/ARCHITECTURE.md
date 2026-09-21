# Architecture

## Shape

One Cloudflare Worker serves the built client and routes `/api/*`. Every table
is a Durable Object — one object per table code, addressed by
`idFromName('room:CODE')`.

```
browser ──HTTP──▶ Worker ──▶ TableRoom (Durable Object)
   │                              ├─ authoritative room state
   └───websocket─────────────────▶├─ dice (server-side CSPRNG)
                                  ├─ role filtering
                                  └─ map images (chunked blobs in its SQLite)
```

The object holds the state, resolves rolls, decides what each connection sees,
and stores the images. One object per table means there is nothing to
coordinate between servers and no race when two players grab the same token:
every operation on a table is serialized through one place.

Images are chunked into 64 KiB rows in the object's own SQLite storage. That's
why the project needs no R2 bucket, and so no billing setup at all.

Websockets use the hibernation API, so a table left open while everyone talks
costs nothing until a piece moves.

## State and operations

`shared/state.ts` defines the room and a `reduce(state, op)` that advances it.
The same reducer runs on the server and in every browser.

The server is the authority. A client sends _intents_: move this token, roll
this expression, save this sheet. The server validates, applies, and broadcasts.
Clients replay the identical function to stay in step.

Two things are applied locally before the echo:

- **Token drags**, for everyone. The piece follows the pointer at full frame
  rate while the room gets a throttled trickle; the server's echo corrects
  anything it refuses.
- **The GM's own operations.** Every operation a client can send is idempotent
  and the GM is authorized for all of them, so there is nothing to roll back —
  and without it a GM's own checkbox visibly flips back for a round trip before
  the echo restores it.

Unknown ids are ignored rather than thrown on: a delete racing a move is normal
traffic, not an error.

## Role filtering

`shared/visibility.ts` is why the screen can be trusted, and it is worth reading
before changing anything about who sees what.

**`projectState`** builds what a role may hold: for a player, the active scene
only, its visible tokens only, sanitized sheets, no bestiary, no encounters, no
private rolls or whispers.

**`projectOp`** translates one applied operation into what each role is told.
Most pass through or vanish. Two change shape:

- _Switching the active scene_ expands into a teardown of the old scene, the new
  scene, and its visible tokens — a player has never seen the new one.
- _Revealing a hidden token_ becomes a `token.create`, and concealing one
  becomes a `token.delete`, because a player's copy never held the token at all.
  A flag they could flip would not be a secret.

A token that stays visible has its patch **re-derived from the sanitized token**
rather than forwarded, so a concealed hit point total cannot slip through in a
partial update.

**`authorize`** returns a _rewritten operation_ rather than a boolean. A player
editing a token gets a patch narrowed to damage and conditions; a player saving
a sheet gets ownership taken from their connection rather than the payload, and
the GM's private notes preserved. Returning the op means a caller cannot forget
to sanitize: whatever comes back is what gets applied.

## Rendering

The map canvas draws in an animation frame reading client state directly, not
through React. A token dragged by another player is a position change sixteen
times a second, and reconciling a component tree that often would spend the
frame budget on reconciliation.

The client exposes two subscription channels. React panels listen on the
_structural_ one, which token moves and cursors do not touch. The canvas reads
live.

Fog is drawn by painting the mask into an offscreen canvas one pixel per cell
and scaling it up with smoothing on — soft edges for almost nothing, where
stroking thousands of rectangles would cost real time.

## Dice

Rolls resolve in the Durable Object using the platform CSPRNG. The result
carries a seed; clients use it to drive the tumble, so the die that skitters
left on one screen skitters left on all of them and lands on the face the server
already chose. The animation cannot change the number — it is handed the
finished dice.

## Security model

The GM key is the only credential. Holding it makes you the GM of that table;
the table code alone makes you a player. Keys are compared in constant time.

A key the server rejects doesn't lock anyone out: the client rejoins as a player
and says so, because a stale key left over from a table that has since been
reopened should not end someone's game night at the door.

Asset downloads are gated the same way state is. A player may fetch the map on
the table, a visible token's image, or a sheet portrait. A staged map returns
404 even with its exact id.

## Testing

`npm test` — 89 unit tests over the dice parser, the fog mask, the reducer, and
role filtering. The visibility suite is the one that matters.

`node scripts/smoke.mjs` against a running server — 43 end-to-end checks. Unit
tests prove the filtering functions are right; this proves the wiring is, by
planting marked secrets and asserting none of them ever reach a real player
socket over a real websocket.
