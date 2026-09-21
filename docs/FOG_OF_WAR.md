# Fog of war

## How it works now

Each scene carries a mask: a grid of cells over the map, each either revealed or
hidden, run-length encoded so a mostly-unexplored map costs almost nothing to
store or send. Cell size is per-scene — fine (16px), normal (32px) or coarse
(64px) — and changing it re-cuts the mask while keeping what was uncovered.

The mask lives on the server. Only the GM can paint it. When a GM brushes a
room open, the operation goes to the Durable Object, the mask is updated there,
and the new mask is broadcast.

Players are sent the mask. That sounds backwards until you notice the mask only
ever states what **is** revealed — it says nothing about what is under the
covered cells. There is no "fog: off" for a player to flip, because their
browser holds no information about the hidden ground beyond its shape.

The GM sees the covered area as a translucent slate veil and can work through
it. Players get an opaque wall. The GM's _see it as players do_ toggle renders
the player's version so you can check what the table is actually looking at
before you describe it.

Painting stamps circles along the pointer's path rather than at each event, so a
fast drag leaves a solid stroke rather than a dotted line. The brush tests each
cell's centre, so clipping a corner doesn't flip a whole cell and leave a ragged
edge.

## The honest limitation

**The map image is delivered whole.** A player's browser downloads the entire
picture and then covers part of it. Someone who opens devtools, or reads the
network tab, can look at the parts their character hasn't reached.

This is worth being clear about because the _other_ secrets have no such gap.
Hidden tokens, bestiary entries, encounters, GM notes on scenes and sheets,
private rolls, and maps that aren't on the table are never transmitted to a
player at all — not obscured, not flagged, absent. Those are enforced in
`shared/visibility.ts` and asserted by the smoke test, which plants marked
strings in each and checks that none reach a player socket.

Fog is the one place where the client is trusted to draw something over data it
holds. For a group of friends that's the right trade: it keeps the table honest
without anyone having to be. If you want it airtight, below is what that takes.

## Closing the gap: server-gated tiles

The fix is to stop sending the picture and start sending the parts of it.

1. **On upload**, the GM's browser slices the map into tiles — 256px square is a
   reasonable starting point — and uploads each as its own asset. The scene
   records the tile grid rather than one image id. Slicing is about thirty lines
   of canvas work and happens once per map.

2. **Fog cells align to tiles**, or to a whole-number division of them. The mask
   becomes the index of which tiles a player may have.

3. **The Durable Object gates tile requests** the way it already gates whole
   assets in `#assetVisibleToPlayers`: a tile is fetchable by a player only if
   the covering fog cell is revealed. That check already exists in spirit — it's
   what stops a player fetching a staged map by id.

4. **The client draws revealed tiles** and leaves the rest black. A finer visual
   fog layer can still soften the edges on top; the security boundary is the
   tile, the soft edge is decoration.

The cost is granularity. A 256px tile on a 70px grid is about three and a half
squares, so reveals become chunkier than a brush stroke. Smaller tiles buy back
precision at the price of more requests — a 4000×3000 map at 128px is roughly
730 tiles, which is fine for HTTP but worth batching.

The cost is also complexity: uploads get a slicing step, scenes get a tile grid,
and the asset route needs a per-tile visibility check. That's why it isn't here
yet. The mask, the ops and the visibility layer are all already shaped for it —
this is an upgrade to how pixels are delivered, not a redesign.

## What is deliberately not planned

**Dynamic line of sight.** Drawing walls and computing what each token can see
is a genuinely different feature, and a much larger one: wall geometry, a
visibility polygon per token, per-player rendering, and a GM spending the
session drawing walls instead of running the game. Painted fog is cruder and
takes ten seconds to set up. For a table that wants "they can see the room
they're standing in", that's the better trade.
