# Jet Horizon engine-neutral core

This embedded package is the engine-neutral gameplay layer used by the live Unity project. Its Runtime assembly has `noEngineReferences` enabled and contains no `UnityEngine` types.

The separate `JetHorizon.Application` assembly defines platform ports and routes simulation events to saves, audio, haptics, analytics, clocks, and leaderboards without allowing those services to affect deterministic gameplay.

Current scope:

- deterministic 60 Hz simulation;
- production lateral movement and counter-steering values;
- roll-aware collision width and visual bank output;
- deterministic random-wave, zipper, and slalom scheduling;
- typed cone/ring/wall/corridor hazard identities with external register/remove APIs;
- core-owned hazard movement, stable IDs, collision suppression, rotated-wall geometry, lightning phases, and canyon-bound collision;
- registered pickup identities with core-owned movement, collection, score awards, and events;
- scoring, near misses, and death events;
- live-run distance, passive score, pickup awards, and final score multiplier;
- engine-supplied world facts represented as value-only `WorldFrame` input;
- validated run/stage content with typed stage and corridor definitions;
- stage timing, speed ladder, spawn policy, quiet windows, mechanic commands, and endless rotation;
- portable ship model placement, named thruster sockets, and exhaust-style content definitions;
- allocation-free snapshot and event buffers;
- replay-oriented editor tests.

The shipping `GameManager` feeds player/world input into the core and mirrors its snapshot into the legacy `RunSession`. `WaveDirector` realizes the remaining presentation launch commands, while pooled Unity systems project core hazard and pickup snapshots onto render objects. Unity still owns rendering, audio, input devices, and platform services. The L4/L5 sine generator and structured-wall burst scheduler are the next large gameplay systems still owned by Unity.

## Revert boundary

Each ownership change is committed separately from the port baseline. Revert the newest architecture commit to restore the previous ownership boundary without deleting the accepted core.
