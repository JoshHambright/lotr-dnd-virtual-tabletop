# Plan

Turning the working single-ruleset prototype into a self-hosted, multi-ruleset
virtual tabletop, built in phases that several agents can work in parallel.

Status of what exists: a complete, tested LotR-5e-only VTT on Cloudflare
Workers — commit `4bf22b3`. Map, tokens, fog, dice, sheets, bestiary, 89 unit
tests, 43 end-to-end checks. It works. It is also shaped around one ruleset and
one host, which is what this plan changes.

## The four decisions this plan is built on

| Decision | Choice                                                  | Why                                                                               |
| -------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Stack    | Node/TypeScript + WebSockets, Docker-first              | Keeps 4,690 lines of tested core and UI. Only 562 lines were Cloudflare-specific. |
| Hosting  | Josh hosts on a local machine, reached through a tunnel | The GM is a _user_, not an operator. Ops docs are written for Josh.               |
| Rulesets | Pack system built now, all three                        | Retrofitting would mean rewriting the sheet model, dice semantics and theming.    |
| Content  | Bundle open content where licensed                      | 5e SRD is CC-BY. MÖRK BORG has a third-party license. LotR 5e has neither.        |

Recorded with fuller reasoning in [DECISIONS.md](DECISIONS.md).

## Target architecture

```
packages/
  core/         pure TS — room state, ops, reducer, visibility, fog, geometry
  dice/         expression parser + roller (no ruleset knowledge)
  formula/      tiny safe arithmetic evaluator for derived sheet values
  protocol/     wire messages + zod schemas + version negotiation
  rulesets/     pack format, loader, validator, and the three packs
  server/       Fastify + ws + SQLite + asset store
  client/       React app, renders whatever the pack declares
  adapter-cf/   optional Cloudflare Durable Object adapter (Phase 4)
infra/
  docker/       Dockerfile, compose, tunnel config
```

**One process, one writer.** A room lives in a single Node process, which is the
same guarantee the Durable Object gave us — no races on a token, no coordination
between servers. Horizontal scaling would need Redis pub/sub and is explicitly
out of scope; this hosts one group.

**SQLite on a volume** for state, **files on a volume** for maps. Both survive
`docker compose down` and both back up with a directory copy. Map images move
out of the database and onto disk, content-addressed by hash.

**The visibility layer does not change.** `core/visibility.ts` is the reason the
screen can be trusted and it is transport-agnostic already. It moves package,
untouched, with its tests.

## Ruleset packs

A pack is data, not code. The client renders whatever a pack declares, so adding
a fourth system means writing a pack, not touching the app.

A pack declares: identity and licence notice, theme tokens, a dice profile, a
sheet schema, conditions, token defaults, and optionally bundled content.

Full contract in [RULESET_PACKS.md](RULESET_PACKS.md). That document is frozen
at the end of Phase 0 and is the interface every parallel workstream codes
against.

The three packs:

- **`srd5e`** — 5e SRD 5.1/5.2, CC-BY-4.0. Parchment skin. Can bundle monsters,
  spells and conditions with attribution.
- **`lotr5e`** — structure only. No rules text, no bundled content, marked
  unofficial. The vellum skin the prototype already wears.
- **`morkborg`** — d20 against a Difficulty Rating, four abilities, Omens.
  Black-and-yellow brutalist skin. Published under the MÖRK BORG Third Party
  License, which permits the compatibility logo and requires a specific
  attribution statement.

**Homage, not reproduction.** Skins evoke each system's feel using openly
licensed fonts and original layout. We do not ship anyone's art, typefaces or
trade dress. Where a licence grants a compatibility logo, we use that logo and
nothing else of theirs.

**Unverifiable rules become pack data, not code.** The prototype has two places
where a rule was set from what could be verified rather than from the book
(Shadow paths per Calling; whether Weary modifies a d20 test). Under the pack
format these are one-line data corrections rather than code changes — which is
the strongest practical argument for doing this now.

## Phases

### Phase 0 — Foundations and quality gates _(serial, small, blocking)_

Nothing parallel starts until this lands, because everything else codes against
the contracts frozen here.

- Monorepo restructure to pnpm workspaces; existing code moved into `core`,
  `dice`, `client` with tests still green
- **Contracts frozen**: protocol zod schemas, the pack TypeScript interfaces,
  the formula grammar, the SQLite schema
- CI/CD and quality gates (below)
- `schemaVersion` on room state plus a migration hook, before there is any data
  worth migrating

**Delivered.** pnpm workspace with eight packages; 4,690 lines moved with
history preserved and all tests still green. Contracts frozen: the wire
protocol with zod validation, the pack format, the formula grammar with
executable conformance vectors, and room schema versioning with a migration
chain. 184 tests, up from 151. `pnpm verify` passes from a clean clone.

### Phase 1 — Parallel build _(six independent workstreams)_

| ID   | Workstream     | Owns                                                                                                   | Depends on           |
| ---- | -------------- | ------------------------------------------------------------------------------------------------------ | -------------------- |
| A ✅ | Node server    | `packages/server` — Fastify, ws, room actors, SQLite, assets, export/restore (D-019)                   | protocol, core       |
| B ✅ | Ruleset engine | `packages/rulesets` + `packages/formula` — format, loader, validator, evaluator, `lotr5e` pack (D-016) | pack contract        |
| C ✅ | Dynamic sheet  | `client/sheet/**` — renders any SheetSchema                                                            | pack contract        |
| D ✅ | Theming        | `client/theme/**` + three skins                                                                        | theme token contract |
| E ✅ | Docker & ops   | `infra/**` + operations docs                                                                           | nothing              |
| F ✅ | Test harness   | multi-client e2e against the Node server                                                               | protocol             |

**B is done.** The formula grammar has a parser and an evaluator that pass every
frozen conformance vector; `validatePack` rejects a malformed pack at build
time, including cross-references a schema cannot see; `lotr5e` exists as pack
data and the registry resolves it. A table now records which pack it plays
(`settings.rulesetId`, schema 3), which is the hook C renders from.

**C is done.** `CharacterSheet` renders `pack.sheet.sections` and knows nothing
about Middle-earth; `deriveSheet` in `@vtt/rulesets` does the arithmetic, so what
a skill modifier comes to is testable without rendering anything. Sheets are a
value bag (schema 4), and the wire schema bounds it instead of passing arbitrary
JSON straight into room storage.

**F is done**, in two layers. `packages/core/test/convergence.test.ts` runs a
table in-process and checks the property that decides whether anyone's screen
can be trusted: a client that was here the whole time, having applied every
operation it was sent, holds exactly what a client joining right now would be
handed. `packages/server/test/concurrency.test.ts` does the same over real
websockets against a real Fastify server and SQLite store, with clients talking
over each other. Both were checked by sabotage — break a projection and they go
red.

That turned up `seq`: the protocol carried an operation count on every batch
and nothing anywhere read it, so a dropped batch left a browser quietly wrong
for the rest of the session. It now counts per connection rather than per room,
which makes it gapless for its recipient, and the client rejoins when it sees a
number it did not expect.

Nothing in the app is LotR-shaped any more. The bestiary followed the character
sheet onto the pack format (D-025), and `lotr5e-legacy.ts` is gone.

These touch disjoint directories on purpose. The contracts frozen in Phase 0 are
what let six agents work without stepping on each other.

Exit: `docker compose up` serves a working table with the `lotr5e` pack; the
leak-assertion e2e suite passes against the Node server; a table can be
exported and restored.

Workstreams merge into one integration branch as they finish, each gated by
the full suite, and the phase is reviewed once as a running application
(D-018).

### Phase 2 — The other two packs

- `srd5e` pack — the second system, which is where the format either holds
  or does not
- `morkborg` pack: d20-vs-DR dice profile, four abilities, Omens track, skin
- SRD content ingestion: monsters, spells and conditions as loadable data
- Import of the prototype's existing rooms, if any are worth keeping

Exit: all three packs selectable at table creation; switching packs reskins the
app and reshapes the sheets.

### Phase 3 — Hardening for real sessions

- Reconnection tested against genuine network loss, not a clean socket close
- ✅ Per-player invite tokens, replacing name-derived ids (D-017, done in D-031)
- ✅ Rate limiting, message size caps, abuse resistance on a public tunnel (D-032)
- ✅ Load check: six clients, sustained token dragging (in `concurrency.test.ts`)
- Accessibility pass: keyboard navigation, focus order, contrast in all three skins

Exit: a full session played on it without anyone noticing the software.

### Phase 4 — Optional and stretch

- Cloudflare adapter, so the same code can deploy to the edge as an alternative
- Server-gated fog tiles, closing the one honest gap in the fog model
- Initiative tracker, handouts, in-app player invites

## Quality gates

Every gate runs in CI on every push, and every one of them blocks merge.

| Gate            | Threshold                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Typecheck       | `tsc --noEmit`, strict, `exactOptionalPropertyTypes`                                                                            |
| Lint & format   | eslint + prettier, zero warnings                                                                                                |
| Unit tests      | vitest; **90% line coverage on `packages/core`**, 70% overall                                                                   |
| Leak assertions | the e2e suite that plants marked secrets and proves none reach a player socket — **non-negotiable, treated as a security test** |
| Docker          | image builds; `compose up` passes a healthcheck                                                                                 |
| Dependencies    | `npm audit` clean of high and critical                                                                                          |
| Static analysis | CodeQL on JS/TS                                                                                                                 |

Pack authoring gets its own gate: every pack must validate against the schema
and every formula in it must parse, so a malformed pack fails CI rather than a
session.

## Running this with parallel agents

The phases are drawn so that Phase 1's six workstreams can run as six agents at
once. What makes that safe is not the agents, it is Phase 0: frozen contracts
and disjoint directory ownership.

Rules for parallel work:

1. **One workstream, one directory tree.** Anything needing a change outside its
   tree is a contract change, which is a serial decision, not an agent's call.
2. **Each agent runs in its own git worktree** and opens its own PR against the
   integration branch.
3. **Contracts are append-only during a phase.** Breaking one mid-phase
   invalidates work already in flight — that is precisely the mess to avoid.
4. **The full gate suite runs per PR**, not at integration time.

## What could still go wrong

Named here so they are watched rather than discovered.

- **The sheet schema proves too rigid** for MÖRK BORG's Omens or LotR's Shadow.
  Mitigated by building the LotR pack first (D-016): it is the awkward one,
  so the format meets its hardest case in Phase 1, while only one pack has
  been written against it.
- **The formula evaluator grows into a language.** Held to arithmetic, `floor`,
  `ceil`, `min`, `max`, `abs` and field references. Anything needing more is a
  code-level pack hook, not a bigger grammar.
- **Tunnel reliability on game night.** Phase 3 has a rehearsal, and the
  fallback is documented rather than improvised mid-session.
- **The repo name.** `lotr-dnd-virtual-tabletop` stops being accurate the moment
  there are three packs. Renaming is a one-click GitHub operation that keeps
  redirects working — your call, worth doing before anyone bookmarks it.
