# Jet Horizon — Unity Port

A ground-up Unity 6 (URP) rebuild of the core game: ship physics, the full 33-stage
Death Run sequence, canyons, sine corridors, zipper/slalom/walls/rings, the synthwave
visual stack (sun, water, bloom, neon shaders), and a clean state-machine UI shell
(Title → Playing → Paused → Dead).

All tuning values were extracted from the shipping three.js build — see `spec/*.md`
for the full extraction (constants, formulas, source line references). Those three
files are the design document for this port.

## Opening the project

**Option A — open this folder directly (simplest)**
1. Unity Hub → Add → select this `unity/` folder (use **Unity 6 / 6000.x**, any recent 6.x).
2. Open it and let it import (`Packages/manifest.json` pulls URP + glTFast + UGUI).
3. Menu bar → **Jet Horizon → Build Game Scene**. This generates all materials,
   the post-processing volume, lights, water, sun, ship, systems, and UI, then saves
   `Assets/JetHorizon/Scenes/JetHorizon.unity`. It also creates and assigns a URP
   pipeline asset automatically if the project isn't URP yet.
4. Press **Play**.

**Option B — existing URP project**
Copy `Assets/JetHorizon/` into your project, install `com.unity.cloud.gltfast`
(for the ship GLBs), then run **Jet Horizon → Build Game Scene**.

## Controls

- **A/D or ←/→** — steer (digital, same as web build)
- **↑/↓ (hold)** — knife-edge roll (narrows the hitbox 1.5 → 0.8, penalty after 2 s)
- **Touch** — hold left/right screen half to steer, swipe up = roll (latched), swipe down = cancel
- **Space / tap** — start, retry
- **Esc** — pause

## Architecture (the point of this rewrite)

```
GameManager (composition root)
 ├─ GameStateMachine     — validated transitions Boot/Title/Tutorial/Playing/Paused/Dead
 ├─ RunSession           — ALL per-run state in one object, reset in ONE method
 ├─ fixed-step loop      — 60 Hz accumulator, rawDt clamp 50 ms (same as web build)
 ├─ JetHorizonSimulation — engine-neutral authority for ship, stages, hazards,
 │  pickups, sine corridors, zipper/slalom, lightning, and structured walls
 └─ Unity presenters — CameraRig → WaveDirector/CanyonSystem → pooled wall,
    obstacle, lightning, pickup, VFX, audio, and UI adapters
```

Key fixes over the JS architecture:
- **No shared mutable tuner.** Each canyon activation gets a fresh immutable
  `CanyonPreset` — the entire class of "preset leaked into next canyon" bugs is gone.
- **Events, not globals.** Systems talk via `GameEvents` (SpeedChanged, StageChanged,
  VibeChanged, KlaxonCountdown…). UI listens; it never reaches into gameplay.
- **Data-driven sequence.** The 33-stage run script lives in
  `Resources/dr_sequence.json` — edit stages/speeds/durations without touching code.
- **One reset path.** `RunSession.ResetForNewRun()` + each system's `ResetSystem()`
  replaces the ~90 scattered reset fields audited in `RUN_RESET_AUDIT.md`.
- Portable gameplay constants and formulas live in `Packages/com.jethorizon.core`;
  Unity-only presentation tuning remains in `Scripts/Core/Tuning.cs`.

## What's ported vs deferred

Ported and faithful: lateral physics (accel 38.44, decel glide 0.49/s, max vel 16.31,
counter-steer ×3), knife-edge roll + tilt penalty, banking/yaw/pitch/hover, camera
(FOV 78 + 32° speed kick ^1.4, death orbit, retry sweep), the full DR sequence with
deferred speed bumps / pre-canyon quiet / klaxon, canyons (T4A/T4B/L3-knife: slab
pools, stateless sine corridor functions, entrance reveal at −210, 0.4 s entry ramp,
4 s drift exit), L4/L5 sine corridors (exact ramps incl. the L4 knife spike rows
370–395), zipper, slalom, angled walls (rotated-OBB), lethal octagon rings (exact
tube-path collision), coins, lightning, near-miss scoring, endless rotation, all
8 vibe palettes, sun + corona + horizon seam, black scrolling water with amber streak,
bank-water wake (verbatim shader port), holographic GHOST material (verbatim port),
thruster exhaust cones (neonRamp shader), explosion + bloom spike, ACES + bloom +
vignette + chromatic aberration.

Deferred (hooks in place): powerups/shields/magnet (`RunSession` fields + JS spec ready),
bonus fuel rings (`PickupSystem.WipeBonusRings` stub), audio (add `AudioSource`s driven
by `GameEvents` — native audio means the iOS Web Audio pain simply doesn't exist here),
tutorial content (state exists), planar water reflection (current shader fakes it well
at gameplay angles; add a URP planar reflection feature if you want the true mirror),
meta/shop/leaderboard.

## Ship model & skins

`Assets/JetHorizon/Models/Ships/spaceship_01.glb` is imported by glTFast; the
bootstrap instantiates it and applies the RUNNER skin by material-slot name
(`ShipFactory.ApplySkin` — RUNNER / GHOST / BLACK MAMBA / CIPHER all defined).
If glTFast isn't installed, a placeholder dart ship is used so the game still runs.

## Feel-tuning checklist (first play session)

1. Ship response should feel identical: tap-steer glides a long way (decel is tiny).
2. Bloom: URP's intensity scale ≠ Unreal's — `EnvironmentController.Apply` multiplies
   vibe bloomStrength ×2.0; adjust to taste against the web build.
3. If the camera feels close/wide, check FOV per-platform values in `Tuning.cs`
   (78 desktop / 60 landscape / 79 portrait in the original).
4. iOS build: IL2CPP + Metal defaults are fine; no special audio session work needed.
