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
