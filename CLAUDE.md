# CLAUDE.md — virtual-tabletop

Guidance for Claude Code working in this repository.

## What this is

A self-hosted, ruleset-agnostic virtual tabletop for games played over a call.
Shared map with fog of war, tokens everyone can move, dice everybody watches
land, character sheets, and a bestiary only the GM can see.

Read [docs/PLAN.md](docs/PLAN.md) first. Then
[docs/DECISIONS.md](docs/DECISIONS.md) — do not re-litigate what is settled
there without a reason the entry does not already answer.

## The rule that matters most

**`packages/core/src/visibility.ts` is why the screen can be trusted.** It
decides what a player is sent and rewrites what a player may do. Players are
never sent staged scenes, hidden tokens, bestiary entries, GM notes or private
rolls — not obscured, _absent_.

If you touch it, or anything about who-sees-what:

```bash
pnpm build && pnpm --filter @vtt/adapter-cloudflare exec wrangler dev --port 8787 &
node scripts/smoke.mjs
```

Those 43 checks plant marked secrets and assert none reach a real player
socket. They are a security test, not a nicety. Never skip them, never make
them advisory, never delete a case to get green.

## Frozen contracts

Phase 1 runs several workstreams in parallel. What makes that safe is not the
agents, it is the contracts:

| Contract                     | Lives in                        |
| ---------------------------- | ------------------------------- |
| Wire protocol and validation | `packages/protocol/src/`        |
| Ruleset pack format          | `packages/rulesets/src/pack.ts` |
| Formula grammar              | `packages/formula/src/`         |
| Room schema and migrations   | `packages/core/src/state.ts`    |

**Append-only during a phase.** A breaking change invalidates work already in
flight. If you think one needs to break, stop and raise it — that is a serial
decision, not an agent's call.

## Working in parallel

1. **One workstream, one directory tree.** Needing to edit outside your tree is
   a contract change (see above), not a quick fix.
2. Each agent works in its own git worktree and opens its own PR.
3. The full gate suite runs per PR, not at integration time.

## The demo

`pnpm demo` builds a standalone bundle in `packages/client/dist-demo`: the real
UI and the real rules engine against a server running in the same tab
(`packages/client/src/demo/`). It is not a mock — it calls the same
`authorize`, `reduce`, `projectOp` and dice roller the real server calls, over
the same protocol. What it leaves out is the network, storage and other people.

Its seat switch is the point: flipping to a player rebuilds what the browser
has been _sent_, so the staged map and the hidden ambusher are not hidden, they
are gone. Keep that honest — if the demo ever has to special-case something to
look right, the filtering is wrong, not the demo.

## Commands

```bash
pnpm install
pnpm verify          # lint, format, types, coverage, build — what CI runs
pnpm test            # unit tests
pnpm coverage        # with thresholds; core is gated at 90% lines
pnpm dev             # the Cloudflare adapter, on :8787
pnpm demo            # build the standalone demo
```

## Conventions

- **Validate at the edge, then trust the types.** Everything off the wire goes
  through `@vtt/protocol/schemas` first. Authorization answers "may you do
  this"; validation answers "is this even a thing". Both get asked.
- **Optional inputs on public functions take `?: T | undefined`**, not bare
  `?: T`. `exactOptionalPropertyTypes` makes a bare optional reject an explicit
  `undefined`, and callers legitimately hold absent values.
- **zod stays out of the browser bundle.** Import validation from
  `@vtt/protocol/schemas`, never from the package root.
- **Two type environments, on purpose.** `tsconfig.json` covers the browser and
  isomorphic packages; `tsconfig.worker.json` covers the Cloudflare adapter with
  Workers globals and no DOM. The shared packages are checked under both, which
  is what proves they are isomorphic rather than quietly leaning on a browser
  API. `pnpm typecheck` runs both — a single environment would let client code
  reach for a Workers global and still pass.
- **Verify against a clean install before trusting green.** `pnpm` does not
  hoist, so leftover `node_modules` from an earlier tool can hide a missing
  dependency that CI will find.
- **A rule we cannot verify ships as pack data marked `unverified`**, so the app
  can say it is unsure rather than quietly asserting a rule at someone's table.
- **Homage, never reproduction.** Skins evoke a system with openly licensed
  fonts and original layout. No publisher's art, typefaces or trade dress. Where
  a licence grants a compatibility logo, that logo is the only mark we use.

## The VM is ephemeral — commit and push often

Cloud sessions lose their filesystem when the container is reclaimed.
Conversation history survives; uncommitted work does not. Push at every
meaningful checkpoint. A WIP commit that survives beats perfect work that
doesn't.

```bash
git status -sb   # clean tree? branch in sync? if not, you are not done
```
