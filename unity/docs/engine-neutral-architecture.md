# Jet Horizon engine-neutral architecture

## Status

Checkpoint 1 established the reversible package and adapters. Checkpoint 2 made the core authoritative for live ship steering. Checkpoint 3 moved progression and score. Checkpoint 4 moved campaign direction. Checkpoint 5 adds platform ports and persistent run records. Checkpoint 6 connects the live pooled cone/ring hazards to core identity, movement, near-miss, collision, and death.

The new code is split into three boundaries:

1. `Packages/com.jethorizon.core/Runtime` — pure deterministic C# with no Unity references.
2. `Packages/com.jethorizon.core/Application` — engine-free save/audio/haptics/analytics/clock/leaderboard ports and event routing.
3. `Assets/JetHorizon/Scripts/Architecture` — Unity composition, input, platform services, and snapshot presentation.

Project tests live in `Assets/JetHorizon/Tests/Architecture` so they are discoverable without modifying the existing package manifest.

## Dependency rule

Dependencies point inward:

```text
Unity input + world facts -> simulation core -> snapshot + events + commands -> Unity presentation
```

The simulation core must never reference Unity, scenes, prefabs, rendering, audio, input devices, saves, analytics, or platform APIs. Unity code may reference the core.

Platform effects are one-way: simulation events enter the application router, which invokes injected ports. No platform result is allowed to alter a replayed tick. `PlayerPrefsRunProgressStore` is the first live adapter; audio, haptics, analytics, and leaderboards are silent adapters until their real integrations are chosen.

## Implemented first slice

- fixed 60 Hz tick;
- seeded xorshift32 random stream;
- lateral acceleration, glide, counter-steer, banking, and knife-edge roll;
- roll-aware ship collision width;
- deterministic standard-hazard spawning and movement;
- score, distance, near miss, pickup awards, final multiplier, collision, and death;
- explicit `WorldFrame` values for temporary engine-owned facts such as intro suspension and overdrive;
- typed `RunDefinition`/`StageDefinition` content mapped from the existing JSON;
- deterministic `StageDirector` with an allocation-free `StageCommandBuffer`;
- live `WaveDirector` adapter for canyon, sine corridor, walls, slalom, and zipper presenters;
- typed `HazardSpawn`/`HazardSnapshot` entities with stable registration IDs;
- separate automatic-spawn and hazard-simulation switches for incremental presenter migration;
- engine-neutral cone/AABB and octagonal-ring collision with explicit suppression input;
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

Move angled-wall/corridor collision and pickup identity/spawn decisions behind engine-neutral APIs. After that, add:

- a `ShipDefinition` with explicit thruster sockets;
- a GPU-driven procedural starfield presenter;
- one standard-pylon visual profile;
- a recorded input/replay comparison against the current ship controller.

The shipping scene now consumes the core through `GameManager`; the standalone host remains useful for isolated previews and deterministic tests.

## Revert

The Unity port baseline is preserved separately. Each ownership migration is committed independently so the latest subsystem can be reverted without undoing accepted core work.
