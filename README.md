# virtual-tabletop

A self-hosted, ruleset-agnostic virtual tabletop for games played over a call:
a shared map with fog of war, tokens everyone can move, dice everybody watches
land, character sheets that stop drifting apart between sessions, and a
bestiary only the GM can see.

Targets **LotR 5e**, the **5e SRD**, and the **MÖRK BORG** family, with the app
skinning itself to whichever is in play. Being built in phases —
[docs/PLAN.md](docs/PLAN.md) is the plan, and Phase 0 is done.

It replaces the parts of a shared Drive folder that were never really working —
the static map screenshots, the three slightly different copies of a character
sheet, the dice roller nobody else can see.

## What it does

**Maps from wherever they came from.** Images, or a page out of a PDF — which
is how published adventures ship their maps. Multi-page PDFs ask which page.
Then drag a box across a few squares you can see on the art and the grid lines
up to it: nobody knows their map is 63.4 pixels to the square, but anyone can
draw a box around three squares.

**One map, everyone on it.** The GM decides which map the table is looking at.
Everyone drags tokens and sees the moves happen live, along with each other's
cursors. Square grid with snapping, and a measuring tool in whatever units the
scene uses.

**Fog of war.** The GM paints with a brush to uncover ground as the company
explores it, or covers it back over when they leave. The GM sees through the
fog to work; players get a wall. A "see it as players do" toggle shows the GM
exactly what the table is looking at.

**Maps staged in advance.** Only the map put _on the table_ reaches players.
Everything else on the shelf — next week's ambush, the map with the secret door
drawn on it — stays on the GM's screen, and the image cannot even be fetched by
a player who knows its address.

**Dice everyone can check.** Rolls resolve on the server, animate the same way
on every screen, and land in a shared log that shows each individual die,
including the ones advantage threw away. Nothing in the client can write to the
log. The GM can roll behind the screen when the table shouldn't see it.

**Character sheets, shared.** LotR 5e sheets: Heroic Culture, Calling, Shadow
and Hope alongside the usual 5e block. Everyone can read everyone's; you edit
your own. Abilities and skills roll straight into the shared log. Sheets save as
you type.

**A bestiary the players never receive.** Stat blocks and grouped encounters
live entirely on the GM's side. Drop a creature onto the map and it arrives
hidden, linked back to its block, with hit points the players can't read until
you say so. Deploy a whole encounter at once and it lands numbered.

## Getting it running

You need a free Cloudflare account. There is no database to provision and no
bucket to create — map images live in the room's own storage.

```bash
npm install
npx wrangler login
npm run deploy
```

That prints a URL. That URL is the whole thing: app, websockets and images on
one origin. Send it to your group.

To work on it locally, `npm run dev` serves the same stack on
`http://localhost:8787`.

Fuller notes, including what the free tier covers for a group this size, are in
[docs/HOSTING.md](docs/HOSTING.md).

## Running a session

The GM opens a table and gets two things: a six-character **table code** to read
out over the call, and a **GM key** kept in that browser. The code is what makes
you a player; the key is what makes you the GM. It is the only credential in the
system — don't paste it in the group chat.

Players open the same URL, type their name and the code, and they're in. The
invite link (click the code to copy it) fills the code in for them.

A rough first session:

1. GM: **Maps → Add map image**, drop in a battle map, **Show** to put it on the
   table.
2. GM: tick **Cover this map**, then **Reveal** and brush open the first room.
3. Players: **Sheets → Create my sheet**, fill it in, **To map** to put a token
   down.
4. GM: **Bestiary → New creature**, write up the orcs, **Drop on map**. They
   arrive hidden — untick _Hidden from players_ when they burst in.
5. Everyone: roll from the **Dice** tab, or straight off a skill on your sheet.

## What it deliberately doesn't do

- **No accounts.** The table code and the GM key are the whole security model.
  Anyone with the code can join as a player, which is the intent — it's a group
  of friends, not a public server.
- **No voice or video.** You're already on Zoom.
- **No rules automation.** It doesn't know what a Calling can do or apply
  damage for you. It shows the dice and keeps the map honest; the table plays
  the game.
- **No dynamic lighting or line of sight.** Fog is painted by the GM, not
  computed from walls.
- **Fog is not proof against a determined player.** The mask is server-side and
  players are never sent the hidden parts of it, so there's no toggle to flip —
  but the map _image_ is delivered whole, so someone reading network traffic
  could see the unexplored corners. Hidden tokens, stat blocks, GM notes,
  staged maps and private rolls have no such gap; those are genuinely never
  transmitted. [docs/FOG_OF_WAR.md](docs/FOG_OF_WAR.md) explains the difference
  and what closing it would take.

## How it's built

A single Cloudflare Worker serves the app and routes each table to its own
Durable Object, which holds that table's state, resolves every dice roll, and
decides what each connection is allowed to see. One object per table means no
coordination between servers and no race when two players grab the same token.

The interesting part is `shared/visibility.ts`, which is why the screen can be
trusted: it decides what a player is sent, and rewrites what a player is allowed
to do. Revealing a hidden token reaches a player as _create_, not as a flag
flipping, because their browser never held the token at all.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) goes through it properly.

## Development

```bash
pnpm install
pnpm verify              # what CI runs: lint, format, types, coverage, build
pnpm test                # 184 unit tests
pnpm dev                 # then, in another shell:
node scripts/smoke.mjs   # 43 end-to-end checks against the running server
```

The smoke test plants marked secrets in staged scenes, hidden tokens, stat
blocks and GM notes, then asserts that none of those strings ever reach a real
player socket. If you change anything about who can see what, run it.

## Licence

MIT. Tolkien's world belongs to the Tolkien Estate and Middle-earth Enterprises;
Free League publishes The Lord of the Rings Roleplaying. This is an unofficial
tool for a private game and ships no licensed content — no stat blocks, no
setting text, no art. You bring your own maps and write your own creatures.
