# Jet Horizon engine-neutral architecture

## Status

Checkpoint 1 established the reversible package and adapters. Checkpoint 2 makes the core authoritative for live ship steering, glide, roll, banking, hover, and ship position through the existing `GameManager`.

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

The current Unity wave director, scoring, hazards, pickups, camera, VFX, and UI remain connected during migration. For each remaining feature:

1. been represented in the core;
2. received deterministic tests;
3. been compared against a recorded Three.js/Unity reference run;
4. been connected through a Unity adapter;
5. passed play-mode visual and feel validation.

Only then should the corresponding legacy gameplay code be disabled. Presentation systems can be replaced independently because they consume snapshots and events instead of owning gameplay decisions.

## Next checkpoint

Move the live stage, speed, scoring, and hazard state behind engine-neutral APIs, then add:

- a `ShipDefinition` with explicit thruster sockets;
- a GPU-driven procedural starfield presenter;
- one standard-pylon visual profile;
- a recorded input/replay comparison against the current ship controller.

The shipping scene now consumes the core through `GameManager`; the standalone host remains useful for isolated previews and deterministic tests.

## Revert

The Unity port baseline is preserved separately. Each ownership migration is committed independently so the latest subsystem can be reverted without undoing accepted core work.
