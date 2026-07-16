# Jet Horizon engine-neutral architecture

## Status

The live migration has passed its initial vertical slice. The core is now authoritative for ship motion, progression, campaign direction, standard waves, pickups, angled-wall collision, lightning gameplay, canyon bounds, zipper/slalom patterns, L4/L5 sine corridors, the complete structured-wall field, gate-linked cargo routes, and laser destruction decisions. The Runner GLB placement, thruster attachment points, and exact dual laser muzzle tuning are portable content definitions rather than Unity-scene guesses.

The new code is split into three boundaries:

1. `Packages/com.jethorizon.core/Runtime` — pure deterministic C# with no Unity references.
2. `Packages/com.jethorizon.core/Application` — engine-free save/audio/haptics/analytics/clock/leaderboard ports and event routing.
3. `Assets/JetHorizon/Scripts/Architecture` — Unity composition, input, platform services, and snapshot presentation.

Project tests live in `Assets/JetHorizon/Tests/Architecture` so they are discoverable without modifying the existing package manifest.

## Source-of-truth policy

The GitHub `dev` branch is the behavioral and content reference: it tells us what the game contains, how a sequence feels, and which tuned values are current. It is not an architecture template. Browser globals, Three.js object ownership, and file layout are translated into deterministic domain state, immutable content definitions, application ports, and engine adapters.

When parity and portability conflict, preserve the observed gameplay rule in the core and express engine-specific drawing as a presenter. Record deliberate visual deviations instead of silently changing gameplay.

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
- production-equation lateral acceleration, drift-scaled glide, left-biased dual input, counter-steer, banking, hover fade, and previous-tick knife-edge roll penalty;
- roll-aware ship collision width;
- deterministic standard, fat-cone, lethal-ring, angled-wall, zipper, and slalom spawning;
- score, distance, near miss, pickup awards, final multiplier, collision, and death;
- explicit `WorldFrame` values for temporary engine-owned facts such as intro suspension and overdrive;
- typed `RunDefinition`/`StageDefinition` content mapped from the existing JSON;
- deterministic `StageDirector` with an allocation-free `StageCommandBuffer`;
- live `WaveDirector` adapter for remaining canyon launches;
- typed `HazardSpawn`/`HazardSnapshot` entities with stable registration IDs;
- separate automatic-spawn and hazard-simulation switches for incremental presenter migration;
- engine-neutral cone/AABB, rotated-wall OBB, octagonal-ring, lightning, and canyon-bound collision;
- live pooled coins registered as `PickupSpawn` entities with core collection and score ownership;
- deterministic single/curve/line reward patterns and slalom reward lines;
- portable L4/L5 row definitions with source squeeze, sine, knife-spike, exit, center-cone, delay, and jitter rules;
- portable 6x2x2 structured-wall geometry with source cadence, alternating lean, mesh-center transform, and 20-row lifecycle;
- core-owned lightning targeting, warning/strike phases, lifetime, and narrow hitbox;
- portable `ShipDefinition`, `ThrusterSocketDefinition`, `LaserSocketDefinition`, and `ThrusterEffectDefinition` content;
- source-authored safe, risky, and committed cargo routes that remain capability-bounded and arrive before their linked speed gate;
- a Unity `ShipSocketRig` that creates model-child thruster and dual laser muzzle sockets for the current GLB at runtime;
- core-owned dual-lane laser targeting and destruction events, with pooled Unity-only bolts, impacts, shock rings, lighting, audio, and collection pull-in;
- reused snapshot and event buffers;
- start, pause, reset, and deterministic replay behavior.

## Migration rule

Unity camera, VFX, UI, procedural mesh generation, and device/platform integrations remain presenters or adapters. For each remaining gameplay feature:

1. been represented in the core;
2. received deterministic tests;
3. had its constants, equation order, and boundary conditions checked directly against the GitHub `dev` source;
4. been connected through a Unity adapter;
5. passed play-mode visual and feel validation.

Only then should the corresponding legacy gameplay code be disabled. Presentation systems can be replaced independently because they consume snapshots and events instead of owning gameplay decisions.

## Live ownership map

| Feature | Gameplay owner | Unity responsibility |
| --- | --- | --- |
| Ship steering, roll, bank | Core | input sampling and transform presentation |
| Campaign and speed ladder | Core | stage event presentation and launch adapters |
| Random waves and pickups | Core | pooled meshes, tint, bob, and spin |
| Angled walls | Core random/structured scheduling, identity, source-order geometry, movement, and collision | pooled wall meshes and tint |
| Lightning | Core timing, target, movement, and collision | warning disc, bolt mesh, shake |
| Crystalline canyon | deterministic centerline, widths, spacing, capability validation, collision samples | seam-locked faceted walls, palette, fog/dither fade, reflections |
| Legacy canyon slabs | Core collision decision from value bounds | rollback-only slab path, mesh recycling, entry/exit visuals |
| Zipper, slalom, and sine corridors | Core scheduling, row geometry, random choices, entities, rewards | cone/coin pooling and corridor tint |
| Runner ship and thruster tuning | Engine-neutral content | GLB loading, socket transforms, exhaust drawing |
| Cargo route risk | Core route type, geometry, value, capacity, and collection | pooled pod drawing, pull-in, tint, and audio |
| Laser weapon | Core fire cadence, lane targeting, and destruction | GLB muzzle sockets, bolt/impact VFX, lighting, and audio |
| Structured-wall field | Core 3-second gate, 20-row lifecycle, 6x2x2 transforms, and entities | pooled wall presentation |

## Next checkpoints

1. Replace remaining engine-fed canyon geometry facts with a portable corridor definition, path evaluator, and lifecycle state machine.
2. Retire the now-disabled Unity sine/structured schedulers after a play-mode projection check.
3. Build the aesthetic presentation layer from the same content contract: procedural starfield near the sun, pylon visual profiles, obstacle material profiles, atmosphere, and post-processing.
4. Add build-safe runtime model loading so player builds do not depend on editor-only `AssetDatabase` lookup.

The shipping scene now consumes the core through `GameManager`; the standalone host remains useful for isolated previews and deterministic tests.

## Revert

The Unity port baseline is preserved at `722a5cd`. Each ownership migration is committed independently so the latest subsystem can be reverted without undoing accepted core work. The branch remains local until it is explicitly pushed.
