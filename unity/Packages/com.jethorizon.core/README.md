# Jet Horizon engine-neutral core

This embedded package is the engine-neutral gameplay layer used by the live Unity project. Its Runtime assembly has `noEngineReferences` enabled and contains no `UnityEngine` types.

Current scope:

- deterministic 60 Hz simulation;
- production lateral movement and counter-steering values;
- roll-aware collision width and visual bank output;
- deterministic standard-hazard spawning;
- scoring, near misses, and death events;
- live-run distance, passive score, pickup awards, and final score multiplier;
- engine-supplied world facts represented as value-only `WorldFrame` input;
- allocation-free snapshot and event buffers;
- replay-oriented editor tests.

The shipping `GameManager` now feeds player/world input into the core and mirrors its snapshot into the legacy `RunSession` while the stage director and specialized obstacle families are migrated. Unity still owns rendering, audio, input devices, and platform services.

## Revert boundary

Each ownership change is committed separately from the port baseline. Revert the newest architecture commit to restore the previous ownership boundary without deleting the accepted core.
