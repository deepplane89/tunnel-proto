# Jet Horizon Unity Control Room

## Purpose

The Control Room is the project-owner-facing authoring layer for Jet Horizon. It uses real Unity scenes, serialized components, materials, URP post-processing, imported GLB hierarchies, Scene handles, prefabs, mesh assets, and profiling tools. It is not an in-game settings menu.

All Control Room code lives under `Assets/JetHorizon/Editor`, so Unity excludes it from player builds.

## Opening it

In Unity, choose:

`Jet Horizon > Control Room`

The shortcut is `Command/Ctrl + Shift + J`.

On first open, Unity creates:

- `Assets/JetHorizon/Generated/Authoring/JetHorizonAuthoringProfile.asset`
- `Assets/JetHorizon/Generated/Authoring/DefaultCanyonPath.asset`

These are ordinary versionable Unity assets. They can be duplicated, reviewed, reverted, or committed like other project content.

## Normal owner workflow

1. Open the Control Room.
2. Click **Open Game Scene**.
3. Choose the subsystem tab.
4. Change properties in Edit Mode for static composition or press **Play** for motion.
5. Use **Capture New** before an experiment.
6. Use **Apply** to restore any captured look.
7. Click **Save** when the result is accepted.

Every supported spatial or serialized edit uses Unity Undo.

## Tabs

### Home

- opens the shipping scene;
- frames the ship;
- starts Play Mode;
- creates isolated Sun, Ship, and Powerup workbench scenes;
- validates required project references and loaded-scene components.

### Lighting

- edits actual Unity lights;
- edits ambient color and fog;
- edits URP exposure, bloom, threshold, scatter, and vignette;
- preserves light directions and scene serialization.

### Sun + Sky

- tunes the actual `JH/Sun` material, including Quilez warp and palette;
- moves/scales the actual Sun group;
- tunes the Three.js-parity star material;
- tunes the sky gradient/panorama material;
- opens the isolated Sun workbench.

### Ship + Thrusters

- selects the real ship root, imported model, and socket rig;
- scans the imported GLB hierarchy once and lists likely attachment/add-on nodes;
- edits explicit fallback nozzle anchors with Scene position handles;
- opens an isolated Ship workbench.

Unity imports the GLB into an asset hierarchy. The scan is an Editor operation; the shipped game does not repeatedly parse the GLB.

### Water

- edits the real water material;
- configures planar-reflection resolution and layer policy;
- warns when reflection resolution exceeds the project budget.

### Canyon

- authors corridor center and width as a versioned path asset;
- exposes direct Scene handles for every point and width;
- separates continuous playable topology from the jagged slab skin;
- previews generated chunks;
- combines many procedural slabs into one mesh renderer per chunk;
- bakes reusable mesh assets and a prefab;
- validates per-chunk triangle budgets.

The current shipping canyon remains untouched until a baked-path integration is visually approved. The baker is intentionally an authoring/replacement boundary rather than a silent runtime swap.

### Powerups

- selects the live presentation system;
- exposes its serialized Unity presentation configuration;
- creates an isolated gallery scene.

Powerup rules remain in the engine-neutral core. Unity owns only their visual/audio projection.

### Camera

- selects the real camera rig;
- edits Unity camera lens and clipping properties;
- exposes the current presentation component without moving gameplay math into Unity.

### Performance

The audit measures the loaded authoring scene against explicit budgets for:

- renderer count;
- unique materials;
- realtime and shadowed lights;
- particle capacity;
- loaded mesh triangles;
- transparent renderer slots;
- planar-reflection resolution.

Buttons open Unity's Profiler, Frame Debugger, and Rendering Debugger for measurement rather than guesswork.

## Preset behavior

A `JetHorizonLookPreset` captures the high-frequency presentation contract:

- sun material and Quilez palette;
- star material values;
- sky colors and panorama brightness;
- exposure, bloom, and vignette;
- sun transform;
- reflection resolution;
- main and mini thruster anchors.

Applying a preset changes real Unity assets and scene objects through Undo. It does not introduce a second runtime configuration authority.

## Optimization boundary

The Control Room itself has zero player-build cost. Its optimization value comes from moving work out of runtime and enforcing budgets:

- imported GLBs are inspected once and use saved attachment data;
- canyon geometry can be baked and combined before play;
- preview scenes isolate expensive effects;
- reflection, particles, lights, transparency, materials, and triangle counts are visible before a build;
- generated assets remain compatible with normal Unity profiling and platform import settings.

The audit is a guardrail, not an oracle. A budget warning means profile the relevant scene/effect before reducing visual quality.

## Reversibility

- Look experiments should begin with **Capture New**.
- Scene and asset changes use Unity Undo.
- Canyon preview objects can be cleared without affecting shipping content.
- Baked canyon content is written as new assets/prefabs.
- The shipping canyon is not replaced automatically.
- Git commits remain the durable rollback boundary.
