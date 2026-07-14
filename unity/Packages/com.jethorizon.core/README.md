# Jet Horizon engine-neutral core

This embedded Unity package is the first reversible architecture slice. Its Runtime assembly has `noEngineReferences` enabled and contains no `UnityEngine` types.

Current scope:

- deterministic 60 Hz simulation;
- production lateral movement and counter-steering values;
- roll-aware collision width and visual bank output;
- deterministic standard-hazard spawning;
- scoring, near misses, and death events;
- allocation-free snapshot and event buffers;
- replay-oriented editor tests.

The existing Unity gameplay remains authoritative until each feature is migrated and parity-tested. The new `CoreSimulationHost` and `CoreTransformPresenter` are opt-in adapters and are not added to the shipping scene by this checkpoint.

## Revert boundary

The package and the two adapter scripts are new files committed separately from the existing port. Reverting the architecture checkpoint removes them without modifying the current game scene or runtime systems.
