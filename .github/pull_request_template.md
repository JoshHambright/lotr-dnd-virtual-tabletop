## What changed

<!-- The change in a sentence or two. -->

## Why

<!-- Link the phase, workstream or decision this serves (docs/PLAN.md, docs/DECISIONS.md). -->

## Contract impact

<!-- Phase 1 runs several workstreams in parallel against frozen contracts.
     Tick one. -->

- [ ] No contract change — stays inside this workstream's directory
- [ ] Additive contract change (safe mid-phase)
- [ ] **Breaking contract change** — needs agreement before merge, invalidates in-flight work

## Verification

<!-- What you actually ran, not what CI will run. -->

- [ ] `npm run verify` passes locally
- [ ] Leak assertions still pass if anything touched who-sees-what
- [ ] Checked in a browser, if it touched the UI
