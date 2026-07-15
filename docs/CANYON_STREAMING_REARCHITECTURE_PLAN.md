# Canyon Streaming and Authoring Rearchitecture Plan

## Status

Playable replacement slice implemented on 2026-07-15. The proof run now includes a
core-owned crystalline canyon rendered by a seam-locked continuous Unity presenter.
The legacy slab conveyor remains available as a rollback path until the new look is
visually approved and all historical stage presets are migrated.

Current implementation:

- `EncounterPlanCatalog` owns the deterministic canyon centerline, width, spacing,
  cargo route, and capability validation;
- `CorridorSliceSnapshot` projects the same samples to collision and presentation;
- the core publishes the complete canyon route before its first visible frame;
- `StableCanyonPresenter` builds one closed, shared-vertex construct and translates
  that rigid mesh forward instead of generating visible sections during flight;
- the stable shader reuses the original cyan diagonal-streak and dark magenta-crack
  slab textures, with geometry-derived flat facets rather than replacement color bands;
- `JH/StableCanyon` owns restrained brightness, emission, fog, and opaque distance dithering;
- the route scales longitudinal spacing with equipped cruise capability;
- press `C` during an Editor/development run to jump directly to the new canyon;
- the older `CanyonSystem` materials were darkened independently for rollback comparisons.

Recycling now occurs only as passed rows disappear behind the gameplay camera; the
leading route is already resident deep beyond the fog band. Still intentionally
pending: baking Control Room path handles into the portable route catalog and migrating
each legacy named canyon preset onto the replacement renderer.

## Goal

Keep the current crystalline slab language—large discrete blocks, flat-shaded jagged faces, alternating dark/cyan treatment, and sharp corridor turns—while replacing the fragile placement and reveal logic with a system that is:

- seamless at block boundaries;
- safe to spawn farther from the camera;
- smoothly revealed through fog instead of popping into existence;
- easy to reshape without editing placement math in several systems;
- deterministic across initial construction and recycling;
- independent from collision and encounter timing;
- reversible and compatible with the current presets during migration.

## Confirmed Problems in the Current System

### Spawn depth is not the visible start depth

`CanyonSystem.BuildWalls()` calculates the pool size from `SpawnDepth`, but it always places the first regular slab at `SafeZ - SlabW`. Increasing `SpawnDepth` therefore creates more pooled slabs without moving the front of the corridor farther away.

The entrance slabs begin at `Z = -500`. Regular slabs are placed much closer to the camera, frozen, and disabled. When an entrance reaches `RevealZ = -210`, `Reveal()` activates every regular slab in the same frame. That one-shot activation is the principal source of visible popping.

### Initial placement and recycling do not use one canonical calculation

Initial slabs use `CenterAtZInit(z)`. Recycled slabs use `PredictCenter(rowsAhead)` plus a separately advanced sine phase. Changing pool size or spawn depth changes the relationship between those two calculations. This can produce a discontinuity when the initially built portion gives way to recycled rows.

### Independent random meshes cannot guarantee a shared seam

Every slab calls `MeshFactory.CanyonSlab()` with an independent random seed. Its first and last columns therefore have unrelated displacement values. Adjacent slabs may have perfectly spaced pivots but still have different boundary silhouettes.

Yawing entire rectangular slabs around a curved centerline makes this more visible: rigid blocks overlap on the inside of a turn and separate on the outside. Closing the slab shell prevents seeing through an individual mesh, but it does not make neighboring meshes share an edge.

### Visibility, collision, movement, and encounter choreography are coupled

The `_revealed` flag currently controls all of these concerns:

- renderer activation;
- regular slab movement;
- sine-phase advancement;
- the entry speed ramp;
- availability of canyon collision bounds;
- the reveal gameplay event.

This makes a visual spawn-distance adjustment capable of changing gameplay timing and corridor continuity.

### The source fade cannot be copied literally

The Three.js implementation attempted to fade canyon emission by changing a shared material once per slab. Since many slabs shared that material, the last slab processed effectively chose the emission for all of them. Unity should use per-renderer data or a world-position shader calculation instead.

## Recommended Architecture

The replacement should be a hybrid path-and-block system. The path is an invisible guide. It must not turn the canyon into one smooth tube.

### 1. `CanyonPathProfile`

An immutable description of the corridor route. It owns only spatial intent:

- center X by longitudinal distance;
- half-width by longitudinal distance;
- optional floor/ceiling height and roll;
- lead-in and lead-out distances;
- path control points or curves;
- deterministic seed and path variant.

The initial implementation can evaluate Hermite or Catmull-Rom control points without depending on Unity Splines at runtime. A Unity editor adapter can later expose scene handles. The engine-neutral evaluation API should return plain values such as `CanyonPathSample { centerX, halfWidth, tangentX, floorY, ceilingY }`.

The path should be evaluated by a stable longitudinal coordinate or integer row ID, never by the current ordering of pooled GameObjects.

### 2. `CanyonVisualProfile`

Owns the existing visual language:

- slab height, length, and thickness;
- column and vertical-row counts;
- foot/sweep/mid/crest silhouette;
- displacement and quantization;
- flat-shading/blockiness amount;
- cyan/dark material pattern;
- seam-lock strength;
- reflection and shadow policy.

This separation allows the same route to be tested with different rock treatments, or the same rock treatment to be reused on a new route.

### 3. `CanyonRowDefinition`

A deterministic, engine-neutral description produced from `(pathProfile, visualProfile, side, rowId)`.

It contains:

- near and far longitudinal coordinates;
- near and far path samples;
- left/right inner boundaries;
- stable visual seed;
- material/style index;
- collision boundary samples.

Initial construction and recycling must both call the same row-definition function. This is the main invariant that prevents a distant spawn or larger pool from changing the corridor.

### 4. Seam-locked procedural blocks

Keep every visible slab as a distinct faceted block, but generate boundary columns from shared global samples:

- a boundary is identified by `(side, boundaryRowId, verticalIndex)`;
- both neighboring slabs request the same deterministic boundary displacement;
- interior columns use their own deterministic noise;
- flat triangle normals and quantized interior displacement preserve the crystalline look;
- path curvature moves the boundary columns in X while the surface remains blocky.

This makes adjacent blocks watertight without smoothing the visible canyon. A `blockiness` parameter can blend between a continuously sampled centerline and deliberately stepped row poses.

For stronger turns, bend the inner-face columns along the path samples instead of yawing one rigid rectangle. Outer caps can follow the same near/far boundary so the slab remains closed. This is the durable version of the Three.js L4 geometry-bake idea, but it should be deterministic and used consistently for every canyon mode.

### 5. `CanyonStream`

Owns pooling and row assignment only:

- maintain a fixed ring buffer per side;
- track `firstRowId` and `lastRowId`;
- recycle a passed row as `lastRowId + 1`;
- obtain its complete definition from the canonical row builder;
- rebuild or select a cached mesh only when its row definition changes;
- keep a configurable prewarm margin behind the visible region.

No scanning for the minimum Z, rounding it, then inferring `rowsAhead` should be necessary. Pool size becomes a rendering/performance choice and cannot alter the route.

### 6. `CanyonVisibility`

Renderer visibility must be independent from stream existence and encounter activation.

Recommended behavior:

- create and upload the pool before the encounter becomes visible;
- keep renderers active through the fade region;
- compute visibility from world Z using a canyon shader;
- reveal over a tunable band, initially proposed around `-450` to `-230`;
- scale both base response and emission so emissive rock cannot punch through the fog early;
- use opaque screen-space dithering/alpha clipping instead of transparent blending;
- retain depth writing, stable sorting, shadows, and planar reflections;
- optionally reduce or disable reflection contribution until visibility passes a threshold.

The shader can calculate its own fade from world position and two global parameters. That avoids per-frame material mutation and guarantees both sides of the corridor use identical visibility math.

### 7. Collision projection

Collision should come from the same path/row definitions as rendering, not from whether a renderer is active.

- query the two row samples surrounding ship Z;
- interpolate the left and right inner boundaries;
- enable collision only after the encounter's gameplay-safe threshold;
- keep fade distance irrelevant to collision timing;
- add a conservative safety margin based on ship bounds.

The engine-neutral core should own the collision decision. Unity should supply or visualize the deterministic corridor samples.

### 8. `CanyonEncounterProfile`

Owns non-geometric choreography:

- encounter duration or completion condition;
- entry speed ramp;
- collision-enable point;
- lead-in and exit behavior;
- powerup/spawn suppression rules;
- reveal and completion events.

The entrance block may remain as an art element, but it must no longer act as the renderer master switch. Prefer a path lead-in that begins wide/straight and narrows naturally. If retained, the entrance block should fade through the same visibility system as every other row.

## Authoring Workflow

The desired editing loop is:

1. Select a `CanyonPathProfile` asset.
2. Drag a small number of centerline/width handles in the Scene view, or edit curves in the Inspector.
3. Preview left and right corridor boundaries as gizmo lines.
4. Preview row divisions and flag excessive turn angle or width change.
5. Regenerate only affected preview chunks.
6. Save the profile without changing runtime code.

Useful validation overlays:

- centerline and left/right collision boundaries;
- row IDs and recycle order;
- seam error markers;
- fade start/end planes;
- spawn/prewarm boundary;
- maximum curvature warning;
- ship clearance at every sampled point.

## Migration Plan

### Phase 1: eliminate popping without changing geometry

- Add the canyon-specific opaque dither/fog fade.
- Prewarm the existing pool.
- Stop enabling all regular slabs in `Reveal()`.
- Decouple renderer visibility from `_revealed`.
- Preserve current movement, presets, collision, and encounter timing.

This is the lowest-risk visual improvement and can be tested/reverted independently.

### Phase 2: deterministic row stream

- Introduce stable row IDs.
- Add one canonical row placement function.
- Use it for both initial rows and recycled rows.
- Remove minimum-Z scanning and `rowsAhead` inference.
- Add edit-mode tests proving pool size and spawn depth do not change a row's definition.

### Phase 3: seam-locked meshes

- Add deterministic boundary sampling.
- Update the mesh generator to share near/far boundary columns.
- Bend inner-face columns along the path where necessary.
- Preserve current flat normals, profile, materials, and dimensions.
- Add a seam-distance test for neighboring rows.

### Phase 4: editable path profiles

- Split the current mixed preset into visual, path, streaming, and encounter profiles.
- Add an adapter that reproduces current sine-based presets.
- Add Scene-view gizmos and handles.
- Migrate one canyon encounter at a time while retaining the old system behind a feature flag.

### Phase 5: collision and performance hardening

- Move collision sampling fully onto path definitions.
- Verify water reflection behavior during fade.
- Profile mesh creation, reflection rendering, and pool size on target hardware.
- Cache compatible topology and update vertex buffers instead of creating unbounded procedural meshes.
- Remove the legacy implementation only after every preset has a validated replacement.

## Verification Requirements

Automated checks:

- the same row ID produces identical geometry and boundaries after recycling;
- changing pool size or spawn depth does not change any row definition;
- adjacent seam vertices match within a small epsilon;
- collision boundaries match rendered inner faces;
- pause/resume does not advance the stream;
- exit does not recycle new rows;
- activation/destruction releases owned meshes and materials.

Visual checks:

- no one-frame reveal pop;
- no visible holes when banking or entering a turn;
- distant emission remains hidden by fog;
- fade remains stable in planar reflections;
- current crystalline jaggedness and block silhouette are preserved;
- corridor turns remain legible and provide adequate ship clearance;
- old and new implementations can be switched for direct comparison.

## Rollback Strategy

Implement each phase as a separate commit. Keep the existing `CanyonSystem` available behind a temporary implementation selector until the new renderer, stream, and collision projection are visually validated. Do not rewrite the current presets in place; adapt or copy them so reverting does not destroy tuned values.

## Recommended First Implementation Slice

When visual testing is available, begin with Phase 1 only. It directly fixes the reported pop-in while leaving the corridor's shape and collision behavior untouched. Once the fade band is approved, proceed to stable row IDs and seam locking.
