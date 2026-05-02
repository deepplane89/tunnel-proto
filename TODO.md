# Pre-Launch TODO

Items to address before considering the game "finished."

## Hardening

- [ ] **Formal phase state machine.** Replace scattered `state.phase = '...'` writes with a single `setPhase()` that enforces legal transitions (menu → playing → dying → dead → retrying, etc). Catches state-corruption bugs structurally instead of by hope. Defer until core loop is fully locked — adding new phases costs ~30s each but you can't skip the step. Estimate: 1 new file (~50 lines) + replace ~10-20 call sites. Start in log-only mode, promote to throw after a day of clean fuzz.

- [ ] **Soak test.** Run existing `fuzz/fuzz.js` for 30-60 min instead of 5 to catch slow leaks (memory growth, accumulating timers, listener buildup).

- [ ] **Frame-budget asserts.** Warn if a frame takes >33ms — catches perf regressions early before they become user-visible jank.

- [ ] **Replay/seed recording.** Record RNG seed + input timeline per run so any bug can be deterministically replayed. Heavy lift; only worth it if we keep hitting non-reproducible bugs.
