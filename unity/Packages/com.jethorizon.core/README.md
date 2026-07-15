# Jet Horizon engine-neutral core

This embedded package is the engine-neutral gameplay layer used by the live Unity project. Its Runtime assembly has `noEngineReferences` enabled and contains no `UnityEngine` types.

The separate `JetHorizon.Application` assembly defines platform ports and routes simulation events to saves, audio, haptics, analytics, clocks, and leaderboards without allowing those services to affect deterministic gameplay.

Current scope:

- deterministic 60 Hz simulation;
- production lateral movement and counter-steering values;
- roll-aware collision width and visual bank output;
- deterministic random-wave, zipper, slalom, L4/L5 sine-corridor, and structured-wall scheduling;
- typed cone/ring/wall/corridor hazard identities with external register/remove APIs;
- core-owned hazard movement, stable IDs, collision suppression, source-order rotated-wall geometry, lightning phases, and canyon-bound collision;
- registered pickup identities with core-owned movement, collection, score awards, and events;
- scoring, near misses, and death events;
- live-run distance, passive score, pickup awards, and final score multiplier;
- explicit total-simulation and score-eligible run ticks;
- immutable, idempotent run finalization with leaderboard eligibility flags;
- engine-supplied world facts represented as value-only `WorldFrame` input;
- validated run/stage content with typed stage and corridor definitions;
- stage timing, speed ladder, spawn policy, quiet windows, mechanic commands, and endless rotation;
- portable ship model placement, named thruster sockets, and exhaust-style content definitions;
- allocation-free snapshot and event buffers;
- direct formula and deterministic replay tests.

The shipping `GameManager` feeds player/world input into the core and mirrors its snapshot into the legacy `RunSession`. `RunCompletionService` is the idempotent boundary for records, persistence, analytics, and leaderboard publication; Unity currently supplies a durable local leaderboard outbox that can be drained when the player-profile/network adapter is connected. `WaveDirector` realizes the remaining canyon presentation commands, while pooled Unity systems project core hazard and pickup snapshots onto render objects. Unity still owns rendering, audio, input devices, platform services, and canyon slab presentation/lifecycle. Sine corridors and structured-wall fields are core gameplay; their old Unity schedulers are legacy fallback code, not live authorities.

## Revert boundary

Each ownership change is committed separately from the port baseline. Revert the newest architecture commit to restore the previous ownership boundary without deleting the accepted core.
