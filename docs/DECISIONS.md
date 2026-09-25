# Decisions

Architectural decisions and why. Read before changing an approach; don't
re-litigate what's settled here without a reason the entry doesn't already
answer.

---

## D-001 — Node/TypeScript + WebSockets, not .NET + SignalR

**Decided.** Self-hosted server is Node/TS with raw WebSockets.

SignalR was on the table and fits Josh's .NET background. It was not chosen
because SignalR is a .NET abstraction over WebSockets, so adopting it means a C#
server — and the valuable part of this codebase is 1,432 lines of tested,
transport-agnostic TypeScript: the dice engine, the fog mask, the state reducer
and the role-filtering layer that makes the screen trustworthy.

Porting those to C# means rewriting 89 unit tests and 43 end-to-end checks, or
worse, running the rules engine in two languages. Duplicating a reducer across
runtimes is how this becomes the mess we're trying to avoid.

SignalR's advantages over raw WebSockets here are automatic transport fallback
and connection management. We already have reconnection with backoff,
heartbeats and presence, tested. Fallback matters little for six people on
modern browsers.

**Cost accepted:** Josh maintains TypeScript rather than C#.

---

## D-002 — Josh hosts; the GM is a user

**Decided.** Docker on Josh's local machine, reached over a tunnel.

This inverts an assumption in the prototype's docs, which were written for a
self-hosting GM. The GM gets a URL and a GM key and never touches
infrastructure. Operational documentation is written for Josh.

**Consequence:** the table is only up when Josh's machine is. If players want to
update sheets between sessions, that's an argument for a small always-on VPS —
same image, same compose file, so it stays a deployment choice rather than a
rewrite.

---

## D-003 — A tunnel, not port forwarding

**Decided.** Public reachability comes from a tunnel.

Port forwarding needs router configuration, a static or dynamically-updated
address, and TLS termination, and it fails outright behind CGNAT. A tunnel gives
a stable HTTPS URL with none of that, and survives the home IP changing
mid-campaign.

---

## D-004 — Ruleset packs now, not later

**Decided.** The pack system is built before the second ruleset, not retrofitted.

The alternative was shipping LotR first and generalising later. Rejected because
the things that differ between systems — sheet shape, dice semantics, theming —
are exactly the things threaded through the widest parts of the app. Retrofitting
means rewriting them with three packs' worth of behaviour already depending on
the old shape.

**Consequence:** slower to a playable LotR table than the prototype already is.
The prototype still exists at `4bf22b3` and can be run in the meantime.

---

## D-005 — A pack is data, not code

**Decided.** Packs are declarative documents validated against a schema.

They declare theme tokens, a dice profile, a sheet schema, conditions and
optional content. They cannot execute anything — which keeps the door open to
GM-supplied packs later without a sandboxing problem, and means a malformed pack
fails CI rather than a session.

**Consequence:** the sheet renderer must handle every field kind generically,
and anything a pack can't express needs a schema change rather than a quick
patch. That friction is deliberate.

---

## D-006 — A tiny formula grammar, held small on purpose

**Decided.** Derived values use arithmetic, `floor`, `ceil`, `min`, `max`,
`abs`, `clamp` and field references. Nothing else.

No conditionals, no loops, no assignment, and `eval` nowhere near it. Parsed to
an AST and evaluated over a plain object.

The failure mode to avoid is the grammar growing a feature at a time until it's
an untested scripting language embedded in a game tool. Anything needing more
power is a code-level hook, reviewed as code.

---

## D-007 — Bundle open content; ship structure only for the rest

**Decided.** Content ships where the licence allows and nowhere else.

- **5e SRD 5.1/5.2** is CC-BY-4.0. Monsters, spells, conditions and equipment
  may ship with attribution.
- **MÖRK BORG** has a third-party licence that permits compatible work, permits
  and encourages its compatibility logo, and requires a specific attribution
  statement displayed with the product.
- **LotR 5e** is neither. Field structure only — no rules text, no content, not
  branded, marked unofficial.

Licence notices are rendered in the app, not buried in a repository file,
because for two of the three packs display is a condition of use.

---

## D-008 — Homage, never reproduction

**Decided.** Skins evoke a system using openly licensed fonts and original
layout. We ship no publisher's art, typefaces or trade dress.

Where a licence explicitly grants a compatibility logo — as MÖRK BORG's does —
we use that logo and nothing else of theirs.

---

## D-009 — One process, one writer

**Decided.** A room lives in one Node process; no horizontal scaling.

This preserves the property that made the Durable Object design correct: every
operation on a table is serialised through one place, so two players dragging
the same token cannot race.

Scaling out would need Redis pub/sub and a rethink of room ownership. This hosts
one group. **Out of scope, deliberately** — recorded so nobody adds it "while
they're in there".

---

## D-010 — SQLite on a volume, images on disk

**Decided.** State in SQLite, map images as content-addressed files.

The prototype stored images as chunked blobs inside Durable Object storage
because that avoided provisioning R2. On a filesystem that reasoning disappears,
and blobs in a database make backup and inspection worse. Both volumes back up
with a directory copy.

---

## D-011 — Unverifiable rules become pack data

**Decided.** A rule we can't confirm ships as data marked `unverified`, and the
app says so.

The prototype guessed twice: Shadow path per Calling, and whether Weary alters a
d20 test. Both were flagged in prose. As pack data they become one-line
corrections by whoever owns the book, and the interface can admit uncertainty
rather than quietly asserting a rule at the table.

---

## D-012 — Contracts freeze before parallel work

**Decided.** Phase 0 is serial and blocking. Phase 1 fans out only after the
protocol schemas, pack interfaces, formula grammar and database schema are
fixed.

Six agents working against a moving contract invalidate each other's work. The
contracts, not the agents, are what make parallelism safe. During a phase,
contracts are append-only.

---

## D-013 — pnpm workspaces, not npm

**Decided.** The monorepo uses pnpm.

npm workspaces hoist everything into one `node_modules`, so a package can
import a dependency it never declared and nothing complains until the day that
dependency moves. pnpm does not hoist: a package sees only what it declares.

In a repo where several workstreams run in parallel, a phantom dependency is a
cross-workstream coupling nobody chose and nobody can see. The strictness is the
point.

**Cost accepted:** CI needs `pnpm/action-setup`, and `npm ci` no longer works.

---

## D-014 — Validate at the edge, then trust the types

**Decided.** Every frame off the wire is parsed by a zod schema before it
reaches the reducer.

The prototype cast incoming JSON straight to `ClientMessage`. Permissions were
checked, shapes were not — so a client could send `{ t: 'token.move', x: 'over
there' }` and put a string where the reducer expected a number, or a `NaN` that
propagates silently through the canvas.

Authorization answers "may you do this". Validation answers "is this even a
thing". Both have to be asked, and they are separate questions.

Two consequences worth stating:

- The schema union deliberately **omits `roll.add` and `chat.add`**. Those are
  minted by the server; accepting them from a client would let a player write
  their own entry into the log that exists to keep everyone honest.
- Validation lives at `@vtt/protocol/schemas`, not on the package root, so a
  browser importing protocol types does not drag zod into the bundle. Keeping
  them separate is worth 14 KB gzipped, which is how it was found.

---

## D-015 — Two type environments, not one

**Decided.** `pnpm typecheck` runs `tsc` twice: once over the browser and
isomorphic packages, once over the Cloudflare adapter with Workers globals and
no DOM.

A single root config had to declare both `@cloudflare/workers-types` and
`vite/client` ambiently, which meant every package saw both. Client code could
reach for `WebSocketPair` and typecheck cleanly; worker code could reach for
`document` and do the same.

Checking `core`, `dice` and `protocol` a second time under a DOM-free
environment is not duplicated work — it is the thing that proves they are
genuinely isomorphic, which the whole self-host-or-edge plan rests on.

Found when CI failed on a clean install while a local typecheck passed: the
local `node_modules` still held packages hoisted by an earlier npm install.
pnpm's refusal to hoist surfaced a dependency that was never declared, which is
exactly what D-013 bought.

---

## D-016 — LotR 5e is the first pack, not SRD 5e

**Decided.** The pack format is proven against the awkward system first.

The plan had SRD 5e first, on the reasoning that the simplest system exercises
the format on easy ground. Reversed for two reasons: it is the ruleset the
group actually plays, so it is the one that makes the app usable; and Shadow,
Hope, Weary and Callings are exactly the things a 5e-shaped schema might not
express.

If the pack format cannot carry Shadow, that is worth discovering in Phase 1
with one pack written, not in Phase 2 with three.

---

## D-017 — Ownership by id now, tokens later

**Decided.** Players are identified by a display name, but ownership is checked
against an _id_, which is currently derived from that name.

Name-only is right for five friends: one code, type your name, play. Its flaw
is real though — two people typing "Sam" collide, and anyone can claim anyone
else's sheet.

Deferring the fix does not have to mean paying for it twice. Every ownership
check reads `ownerId`, and `identityFor(name)` is the single place a name
becomes one. Issuing per-player invite tokens later changes that function and
the join handshake; it does not change `authorize`, the sheet model, or the
reconnect path.

**Consequence:** a trivial-looking indirection that earns nothing today. That
is the point — it is bought now because it is cheap now.

---

## D-018 — One integration branch

**Decided.** Phase 1 workstreams merge into a single branch as they finish,
gated by CI, and are reviewed once as a working application.

Six PRs landing faster than anyone can read them is not review, it is a queue.
Judging the phase as something that runs is worth more than judging six diffs
that individually look fine.

---

## D-019 — Export and backup in Phase 1

**Decided.** A table can be downloaded as JSON, and restored, before anyone
runs a campaign on it.

This was Phase 3 on the plan. Moved because the gap is real and asymmetric:
the work is small — the state is already one serializable object — and the
thing at risk is a campaign that exists nowhere else. Shipping a tool people
put months into with no way to get the data out is the kind of decision that
only looks cheap before it costs something.

---

## D-020 — Scoped bindings for per-row formulas

**Decided.** One formula serves a whole `abilityBlock` or `skillList`, and the
row it is computing is supplied as extra names in scope: `@score` inside an
ability block, `@mod` and `@rank` inside a skill list. A field's roll macro gets
`@total` — the modifier that field just computed.

The alternative was a formula per ability and per skill. For `lotr5e` that is
twenty-three copies of two expressions, and twenty-three places for a typo that
only shows up as one skill quietly rolling wrong. A pack that wants a genuinely
different formula for one ability is asking for an exception the format should
not grow a feature for; it can use a plain `number` field with its own `derived`.

The binding names are part of the frozen contract, not a convention — they are
written down in RULESET_PACKS.md and a pack referencing `@score` outside an
ability block just gets 0, like any other missing name.

---

## D-021 — A pack may suggest a field's value, never decide it

**Decided.** `select` fields take an optional `suggest: { fromKey, map,
unverified }`. When the source field has a mapped value, the app offers the
mapping; the field stays editable and nothing is filled in silently.

The case that forced it is Shadow path, which follows a character's Calling —
and which we could not verify against the book. Hardcoding the mapping would
have put an unverified rule into a component; dropping it would have left every
player looking it up. A suggestion carrying `unverified: true` is the honest
shape: the app helps, says it is not certain, and a table that plays it
differently edits one object in the pack rather than arguing with the software.

It also generalises past the thing that prompted it — background to skills in
SRD 5e is the same shape — which is the test for whether an addition to a frozen
contract is a feature or a patch.

---

## D-022 — A roll modifier is named before it is applied

**Decided.** The renderer applies a pack's `bonus` modifiers to a roll and only
_names_ `treat-below-as` and `reroll-at-or-below` on it — "Frodo — Stealth
(Weary?)" — until the dice engine can express them.

A bonus is arithmetic the existing engine already does. The other two are
per-die rules `@vtt/dice` has no concept of, and faking them in the client would
put the numbers somewhere the server cannot check, which is the one thing this
whole design is arranged to prevent: every roll is resolved server-side so
nobody can retcon a result.

Naming rather than silently ignoring matters because Weary is also the rule we
could not verify. The table sees that the app knows the condition is on, and
that it is not claiming to know what the book does about it. A question mark is
a cheap, honest interface for exactly that.

When the dice engine grows the two effects, this becomes a pack-data change and
not a component change, which is the test that the format was right.

---

## D-023 — A character is a value bag, and the app keeps only what it needs

**Decided.** `Character` carries `id`, `name`, `ownerName`, `ownerId`,
`portraitAssetId`, `gmNotes` and `values`. Everything the game defines lives in
`values`, keyed by the pack. Schema 4 migrates every existing sheet across.

The five named fields are not a compromise: they are the ones the _app_ uses
regardless of ruleset. It puts a name on a token, checks an owner, shows a
portrait, and hides the GM's notes. A pack has no business defining any of
those, and making them pack fields would mean every pack had to remember to
declare them or lose the feature.

The migration is written out field by field rather than looping over whatever
keys are left. Two of them change shape — hit points and Hope become tracks —
and three are the app's own, so a generic "move everything across" would get
them wrong in a way that only shows up at somebody's table.

`@vtt/core` does not import `@vtt/rulesets`. The room records a pack id as a
plain string and the reducer never resolves it, so a table can hold a pack this
build does not ship without the state layer caring.

---

## D-024 — `seq` counts per connection, and the client acts on it

**Decided.** The operation count on an `ops` batch counts what _that
connection_ has been sent, not what the room has applied. It is therefore
gapless for its recipient, and a client that sees a number it did not expect
throws its copy of the table away and rejoins.

The field existed before this and nothing read it. Counted per room it could
not have been read: the GM's staging produces nothing for a player, so a player
saw legitimate gaps constantly and had no way to tell those from a batch that
went missing. A number that cannot be checked is not a safeguard, it is a
decoration that makes the protocol look safer than it is.

The failure it now catches is the quiet one. A dropped batch does not
disconnect anybody; it leaves one person looking at a token that is not there
or fog that has already lifted, for the rest of the session, and the app looks
to them like it is simply lying. Rejoining is not elegant, but it is the one
path already known to produce a correct picture — the server answers a join
with a snapshot of what is true now — and it reuses the reconnect path rather
than adding a second recovery route that only runs when something is wrong.

All three hosts count per connection: the Node server on the seat, the
Cloudflare adapter in the socket's attachment so it survives hibernation, and
the demo loopback on the viewer. A socket hibernating across the deploy that
added this comes back without a count, is treated as 0, and its client rejoins
once — which is the right outcome, arrived at by the ordinary path.

---

## D-025 — A stat block is a sheet, in the same language

**Decided.** A pack declares `statBlock: SheetSchema` — the same schema type as
the character sheet — and it is required, not optional. `StatBlock` in core
keeps only `id`, `name`, `values`, `color` and `imageAssetId`. Schema 5
migrates.

Giving a creature its own schema language would have meant a second renderer, a
second validator and two places to fix every bug, in exchange for expressing
something the first language already expresses. A stat block _is_ a smaller
sheet: fields in sections, numbers that roll, rows for attacks.

Required rather than optional because a pack that cannot describe a monster
cannot run an encounter, and the alternative is a fallback branch living in the
app forever to serve a pack nobody should ship.

The two namespaces are separate. A creature and a character both having an
`armourClass` is not a collision, it is two value bags, and the validator
checks each sheet's keys against its own.

One thing deliberately _not_ carried across by the migration: the old `attacks`
was a free-text box and is now rows that roll. Each line becomes a row's name
and nothing is parsed out of it. "Scimitar +4 (1d6+2)" could be picked apart
into a to-hit bonus, and would be wrong often enough to be worse than leaving
the GM a number they can read on the line in front of them. Losing what they
wrote would be worse still.
