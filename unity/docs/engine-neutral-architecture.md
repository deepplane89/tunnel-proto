# Jet Horizon engine-neutral architecture

## Status

Checkpoint 1 establishes a reversible vertical slice. It does not replace or alter the current `GameManager`, `RunSession`, scene, GLB setup, VFX, UI, or obstacle systems.

The new code is split into three boundaries:

1. `Packages/com.jethorizon.core/Runtime` — pure deterministic C# with no Unity references.
2. `Assets/JetHorizon/Scripts/Architecture/CoreSimulationHost.cs` — Unity input and fixed-tick adapter.
3. `Assets/JetHorizon/Scripts/Architecture/CoreTransformPresenter.cs` — snapshot-to-Transform presentation adapter.

Project tests live in `Assets/JetHorizon/Tests/Architecture` so they are discoverable without modifying the existing package manifest.

## Dependency rule

Dependencies point inward:

```text
Unity input/timing -> simulation core -> snapshot + events -> Unity presentation
```

The simulation core must never reference Unity, scenes, prefabs, rendering, audio, input devices, saves, analytics, or platform APIs. Unity code may reference the core.

## Implemented first slice

- fixed 60 Hz tick;
- seeded xorshift32 random stream;
- lateral acceleration, glide, counter-steer, banking, and knife-edge roll;
- roll-aware ship collision width;
- deterministic standard-hazard spawning and movement;
- score, near miss, collision, and death;
- reused snapshot and event buffers;
- start, pause, reset, and deterministic replay behavior.

## Migration rule

The existing Unity implementation remains authoritative until a feature has:

1. been represented in the core;
2. received deterministic tests;
3. been compared against a recorded Three.js/Unity reference run;
4. been connected through a Unity adapter;
5. passed play-mode visual and feel validation.

Only then should the corresponding legacy gameplay code be disabled. Presentation systems can be replaced independently because they consume snapshots and events instead of owning gameplay decisions.

## Next checkpoint

Create an isolated preview scene that uses the new host and presenter, then add:

- a `ShipDefinition` with explicit thruster sockets;
- a GPU-driven procedural starfield presenter;
- one standard-pylon visual profile;
- a recorded input/replay comparison against the current ship controller.

The shipping `JetHorizon.unity` scene should remain untouched until that preview slice is accepted.

## Revert

This checkpoint contains only new files. Reverting its commit removes the package, adapters, tests, and this document without deleting or rewriting the pre-existing Unity port.
