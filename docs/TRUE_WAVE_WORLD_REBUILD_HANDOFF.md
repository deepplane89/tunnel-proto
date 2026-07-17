# Jet Horizon — True Wave World Rebuild Handoff

**Created:** July 17, 2026
**Purpose:** Implementation handoff for a fresh Codex/Claude/chat session.
**Project root:** `/Volumes/T7 Shield/JH Unity/Developer/tunnel-proto`
**Unity project:** `/Volumes/T7 Shield/JH Unity/Developer/tunnel-proto/unity`
**Branch:** `codex/engine-neutral-core-v1`
**Relevant rollback checkpoint:** `d1a0ee5` (`feat: add cargo-first wave architecture`)

Read this document before editing. The previous implementation added useful
engine-neutral wave contracts, but it did **not** rebuild the game into actual
finite environmental waves. Do not repeat that mistake by renaming sections,
adding cargo, or slightly varying the same continuous canyon.

## Implementation status — July 17, 2026

The finite-wave rebuild described below is now implemented on
`codex/engine-neutral-core-v1` in these rollback checkpoints:

- `1c0593a` — finite parcel contracts, lifecycle, routes, cargo ownership,
  deterministic catalog, and architecture tests;
- `7ead76b` — true open-water presentation and collision envelopes;
- `cd3585d` — diverse small crystalline formation silhouettes;
- `4ba5b59` — complete finite canyon and portal entrances/exits;
- `6cfab9c` — explicit varied sentence selector and hero cooldowns.

The final integration checkpoint also routes parcel and cargo-wave lifecycle
events through the existing audio and ship-feel presenters, keeps upcoming
waves readable while the current breather is active, and validates cargo
against the physical envelope of its owning parcel.

The open-water formation correction now uses
`RandomConeFormationPlanner`, a deterministic engine-neutral port of the
production random-cone generator. It preserves the 21-lane Fisher-Yates
shuffle, four-to-five blockers per row, adjacent guaranteed opening,
three-lane anti-bunch rule, 26-to-32-unit cadence with source jitter, and the
160-unit spawn preview. The blockers render as small faceted crystalline
groups rather than cones. Spatial cadence is intentionally not multiplied by
forward speed, so higher speed produces faster on-screen arrival instead of
normalizing the wave back to the same slow timing.

The implementation now starts over empty water, builds complete parcel roots,
reveals them from the horizon, retains prior geometry until rear cull, inserts
empty-water breathers between every major wave, and attaches cargo to the
validated parcel routes. `Envelope=None` creates neither shore mesh nor shore
collision. Canyon, route-wall, knife, lightning, and prismatic families are
selected by the core rather than Unity.

Automated verification completed:

- engine-neutral core compiled with zero warnings/errors;
- Unity presentation assembly compiled with zero warnings/errors;
- architecture-test assembly compiled with zero warnings/errors;
- all 45 parcel, terrain, cargo, and gate architecture tests passed in the
  standalone runner;
- deterministic smoke run passed six authored world sentences;
- smoke collision checks passed for empty water, canyon shore, and portal mass.

The broader standalone core run passed 117 of 118 tests. The one remaining
failure is the pre-existing legacy test
`PrismaticCollisionUsesTheSameCoreSamplePublishedToTheRenderer`; it also fails
when run by itself and does not enter terrain-world mode or exercise the new
parcel path. Keep it visible, but do not treat it as a true-wave regression.

The Unity editor was already open during implementation, so a second batchmode
EditMode runner could not acquire the project. Before calling the visual rebuild
fully accepted, run the tests from the open editor and perform the seven Play
Mode captures in section 15. Do not treat compilation alone as visual approval.

---

## 1. The actual target

Jet Horizon should feel like a fast flight through a changing half-water,
half-crystalline world:

```text
true open water
    -> a complete environmental obstacle wave approaches
    -> the player reads several viable routes and collects loot
    -> the entire wave passes behind the ship
    -> genuinely empty open-water breather
    -> a different complete wave reveals on the horizon
```

The environment is the obstacle. It must not feel like a permanent canyon with
new labels or random props placed in the middle.

The first playable proof needs visibly different wave families:

1. Open-water small-rock formation weave.
2. Lightning-and-cargo weave over open water.
3. Continuous crystalline canyon route.
4. Route wall / knife-edge tunnel choice.
5. Optional prismatic corridor hero beat.
6. Real empty-water breathers between major waves.

Cargo and powerups dress these waves. They do not create the waves.

---

## 2. What is wrong right now

### 2.1 The existing “waves” are labels on one monolithic world

`TerrainWorldCatalog.CreateProofWorld` in:

`unity/Packages/com.jethorizon.core/Runtime/TerrainWorldPlanning.cs`

always creates the same macro sentence:

```text
OpenWaterSlalom
    -> CanyonRun
    -> OpenWaterReset
    -> PortalChoice
    -> L3KnifeSineTunnel
    -> ReleaseBasin
```

Those labels do not create independent world parcels. They are ranges inside
one `TerrainWorldPlan` containing one continuous shoreline topology.

### 2.2 Unity constructs continuous walls across the whole run

`TerrainWorldPresenter.BuildWorld` in:

`unity/Assets/JetHorizon/Scripts/World/TerrainWorldPresenter.cs`

reads every terrain section and builds two complete meshes:

- `JH_CompleteWorldRightShore`
- `JH_CompleteWorldLeftShore`

using `FacetTerrainMeshFactory.BuildMass`.

That guarantees terrain remains on both sides for the entire world. Sections
called `OpenSea`, `OpenWaterReset`, or `ExtractionBreather` still have left and
right shore stations, heights, and depth. Making them lower or wider does not
make them open ocean.

### 2.3 The breathers are not true breathers

The cargo-wave layer marks `OpenWaterReset` and `ReleaseBasin` as `Rest` and
removes their loot. That only changes core state and collectibles. It does not
remove the continuous Unity terrain meshes.

A true breather must have:

- no enclosing shoreline geometry;
- no collision-bearing terrain;
- no lightning;
- no cargo trail;
- no route commitment;
- several seconds in which water, sun, ship, reflection, wake, and horizon are
  the scene.

### 2.4 The small formations are not a real wave

The current catalog creates roughly ten `WaterlineSpire`, `WaterlineCluster`,
and `WaterlineRidge` features, all derived from a short `beatSeconds` table and
limited to the early part of the same world (`distance <= 1250`).

They are not:

- their own finite wave;
- composed from the old random-cone cadence;
- selected as different formations over a run;
- separated from canyon terrain;
- followed by a clean breather.

### 2.5 The variants are not meaningfully different

The catalog advertises six `TerrainCourseKind` values, but most geometry is
derived from:

```text
layout = courseIndex % 3
```

The same macro order, route wall, canyon span, tunnel, and basin return every
world. Mirroring and small sine offsets do not create six distinct courses.

### 2.6 The cargo implementation adapts the old world instead of composing one

`CargoFirstWaveCatalog.Create` in:

`unity/Packages/com.jethorizon.core/Runtime/CargoFirstWavePlanning.cs`

loops through the existing `TerrainWorldWave` entries and adds safe, valuable,
and hero collectible points. That architecture is useful, but the catalog
adapter perpetuates the old terrain sentence.

**Bottom line:** the current playable result is the old continuous terrain loop
with collectibles. It is not the requested wave game.

---

## 3. Preserve versus replace

### Preserve

Keep these concepts and strengthen them rather than discarding them:

- `CargoWavePlan`, `CargoWaveSequencePlan`, and `CargoWaveRuntimeState`.
- `CargoWaveRouteRole` (`Safe`, `Valuable`, `Hero`).
- Engine-neutral cargo definitions and `RunCargoLedger`.
- `ShipCapabilityProfile` and traversal-envelope math.
- `TerrainWorldFeature` value objects where useful.
- Existing faceted terrain DNA:
  `FacetTerrainMeshFactory.BuildThreeJsParitySlab` and
  `FacetSurfaceStyle.ThreeJsSource`.
- Existing pooled Unity presentation for pickups and hazards.
- Existing water, sun, reflection, ship, lighting, thrusters, lightning visuals,
  and the L3-inspired tunnel math when they are not directly broken.
- The rule that the complete next playable parcel is planned and validated
  before it becomes visible.

### Replace or bypass

Do not keep relying on these as the gameplay composer:

- `TerrainWorldCatalog.CreateProofWorld` as one giant world sentence.
- `CargoFirstWaveCatalog.Create` blindly adapting every old terrain wave.
- `TerrainWorldPresenter.BuildWorld` building one pair of shore meshes across
  open water, canyon, rest, and tunnel phases.
- `layout = courseIndex % 3` as the primary claim of course variation.
- One fixed six-part ordering repeating forever.

Do not delete useful old code immediately. Introduce the new path behind the
terrain-world mode, prove it, then remove obsolete paths in a separate commit.

---

## 4. Required clean architecture

The engine-neutral core remains authoritative. Unity remains presentation.
The orchestrator only connects them.

```text
Core content catalog
  -> finite parcel templates and formation templates

Core composer
  -> chooses a legal sequence for this run
  -> inserts real breathers
  -> prevents immediate repetition
  -> validates speed and handling capability

Core runtime
  -> owns active, previous, and fully planned next parcel
  -> owns collision topology, cargo routes, lifecycle, and outcomes

Thin application/orchestrator
  -> forwards input and core snapshots/events

Unity presenters
  -> build complete parcel roots
  -> draw terrain, rocks, lightning, cargo, fades, reflections, VFX, and audio
  -> never choose routes, rewards, or obstacle legality
```

No god script should own selection, collision, presentation, rewards, and UI.

---

## 5. New core world model

The core needs a finite **world parcel** abstraction. A parcel is a physical
piece of the run, not a label over a distance range in a universal canyon.

Suggested contracts (names can change, responsibilities cannot):

```csharp
enum WorldParcelKind
{
    OpenWaterFormation,
    OpenWaterLightning,
    OpenWaterBreather,
    CrystallineCanyon,
    RoutePortal,
    KnifeEdgeTunnel,
    PrismaticCorridor
}

enum WorldEnvelopeKind
{
    None,               // true open water; no continuous shore mesh
    DistantBanks,       // optional non-colliding/background banks only
    CanyonShoreline,    // continuous collision-bearing side terrain
    RouteMass,          // solid connected terrain with carved passages
    PrismaticShell
}

sealed class WorldParcelPlan
{
    string Id;
    WorldParcelKind Kind;
    WorldEnvelopeKind Envelope;
    float StartDistance;
    float Length;
    float RevealDistance;
    float RearCullDistance;
    TerrainSection[] OptionalShoreTopology;
    TerrainFeature[] Features;
    RoutePlan[] Routes;
    CargoWavePlan Cargo;
    ThreatPlan Threats;
    CapabilityRequirement Requirement;
}
```

The important rule is that `OptionalShoreTopology` is actually optional.
`OpenWaterBreather` and ordinary open-water waves must not be forced through a
constructor that requires continuous left/right shore sections.

### Parcel lifecycle

Use a physical lifecycle:

```text
Planned
    -> FullyBuiltHidden
    -> HorizonReveal
    -> Approach
    -> Active
    -> PassingBehind
    -> RearCull
    -> Complete
```

The next parcel may be built while the current parcel is active. It may not
become visible before its reveal point. The current parcel remains alive until
its final visible geometry passes beyond the rear-cull distance.

### Breather lifecycle

A breather is a parcel, not a timer hidden inside another wave. It should be
selected and validated like any other parcel but contain no gameplay threats or
loot. Its only job is cadence, visual contrast, and later extraction decisions.

---

## 6. True open-water implementation

### Core

An open-water parcel must publish:

- `Envelope = None` for a pure breather;
- no shore sections;
- no shore collision;
- zero features for a pure breather;
- formation features only for an obstacle wave;
- route openings derived around those features;
- a finite start and end.

### Unity

The parcel presenter must branch on the envelope:

- `None`: build no left/right terrain mass.
- `DistantBanks`: background-only, non-colliding silhouettes if desired; they
  must not read as a canyon.
- `CanyonShoreline`: build the connected side meshes.
- `RouteMass`: build the solid wall and its explicit openings.
- `PrismaticShell`: build the corridor presentation.

Do not fake open water by placing low walls at `x = -150` and `x = 150`.

### Visual acceptance test

During a breather, the player must be able to see only water, sun, reflection,
sky, ship, wake, and intentionally distant background art. If faceted side
terrain remains on both sides, it fails.

---

## 7. Small-rock formation wave

This is the missing obstacle wave the player explicitly requested.

### Source cadence to study

Use the old cone generator for **timing, density, lateral spacing, and route
rhythm**, not for its cone visuals:

- `src/40-main-late.js`, especially the obstacle-band logic around the
  `fat_cones` / mixed band sections.
- `src/67-main-late.js`, especially the spawning and lane-spacing logic around
  the `_seqConeDensity` and spawn-band code.
- Existing Unity references:
  `WaveDirector.cs`, `RunParcelPlanning.cs`, `ObstacleSpawner.cs`, and
  `SlalomSystem.cs`.

Extract the useful behavior into core-owned formation templates:

- number of beats;
- seconds between beats, converted through actual pace;
- one or more blocked lateral intervals per beat;
- safe opening center and width;
- valuable route offset;
- minimum reversal time;
- approach warning distance;
- formation visual archetype and seed.

### Do not render cones

The wave should render partially submerged crystalline geology using the
existing faceted surface DNA:

- compact spire cluster;
- split shard pair;
- low reef ridge;
- stepped rock chain;
- broad asymmetric boulder group;
- staggered slalom islands;
- narrow crack formation;
- two-route cluster with a valuable inside cut.

Use `BuildThreeJsParitySlab` as a surface/mesh building block, but do not simply
scale the same boulder repeatedly. Each archetype needs distinct silhouette,
footprint, height profile, submerged depth, and grouping.

### Fast-game spacing

Author cadence in seconds, then derive world distance from actual pace:

```text
forward spacing = current effective speed * desired reading time
```

Validation must account for:

- lateral acceleration;
- maximum lateral velocity;
- ship collision width;
- reversal time;
- current forward speed;
- preview distance;
- cargo-route detour.

The result should arrive quickly and feel fast while remaining readable.

### Wave completion

The final rock grouping must pass behind the player. Then all formation geometry
must be gone before the open-water breather begins. Do not clear the objects at
the ship or snap them off in peripheral vision.

---

## 8. First real wave library

Implement these as independent templates, with at least three meaningfully
different variants per major family.

### A. Open-water formation weave

- No continuous shore terrain.
- Several grouped formations rising from the water.
- Broad safe route and optional cargo cut.
- Variant differences must change the steering sentence, not only mirror it.

Examples:

1. Alternating island slalom.
2. Split cluster with a narrow valuable center cut.
3. Low reef chain requiring a late side commitment.
4. Broad wall of rocks with two readable openings.

### B. Lightning-and-cargo weave

- Open water, not canyon.
- Use the approved GitHub ship-relative lightning cadence and thickness.
- Cargo indicates why the player crosses between strike zones.
- Safe route remains valid.
- Permanent left, permanent right, and neutral should miss meaningful rewards;
  lightning does not need to create an impossible hard cage.

### C. Crystalline canyon

- Complete visible entrance.
- Connected side terrain only during this parcel.
- Actual curves and line-of-sight occlusion.
- Internal natural features and cargo side pockets.
- Complete visible exit into water.

### D. Route wall / knife-edge tunnel

- A solid geological mass with two or three unmistakable openings.
- Safe canyon route, valuable route, and optional L3-inspired knife tunnel.
- No dead-end-looking entrance or exit.
- Tunnel geometry exists completely before the player sees its mouth.

### E. Prismatic corridor

- Hero beat, not constantly visible on the horizon.
- Fully opaque/continuous enough to feel enclosed.
- Complete corridor persists behind the player until rear cull.
- Use sparingly and never as the default loop.

### F. Open-water breather

- Empty ocean.
- No cargo or threats.
- Three to five seconds initially, tuned by speed and visual read time.
- Later this is the only legal location for extraction UI.

---

## 9. Sequence composer and real variation

The composer should not replay one fixed order forever.

For the first proof, create a deterministic but varied sequence under rules:

- Start with an accessible open-water formation wave.
- Insert a true breather after every major wave.
- Do not repeat a wave family immediately.
- Do not repeat the same variant within the last three selections.
- Escalate complexity through available capability, not arbitrary sector index.
- Lightning, canyon, portal, and hero beats have cooldowns.
- A hero beat should be earned after ordinary waves, not appear constantly.
- Every selected safe route must validate for the equipped ship.
- Valuable/hero routes may demand more skill but must be physically possible.

Example run A:

```text
formation slalom A
 -> breather
 -> lightning weave B
 -> breather
 -> canyon switchback A
 -> breather
 -> knife portal A
 -> long breather / settlement
```

Example run B:

```text
formation split-route C
 -> breather
 -> canyon broad weave B
 -> breather
 -> destroyable formation A
 -> breather
 -> prismatic hero corridor B
 -> long breather / settlement
```

Those must look and play like different runs before mirroring, tint, or cargo
placement is considered.

---

## 10. Cargo integration

Only attach cargo after the physical wave route is complete and validated.

- Safe route: common salvage.
- Valuable route: power cell / Alloy placeholder for now.
- Hero route: prism chance.
- Breather: no cargo.

`CargoWavePlan` should reference the chosen parcel route rather than sampling a
generic shoreline after the fact.

Cargo must make the intended steering sentence legible. It must not be placed
as five arbitrary points down the center of an unchanged world.

---

## 11. Unity presentation requirements

Build a dedicated parcel presenter or refactor `TerrainWorldPresenter` so each
parcel owns one complete root:

```text
WorldParcelRoot
  Envelope geometry (optional)
  Formation geometry
  Route mass / crowns (optional)
  Cargo presentation
  Threat presentation hooks
  Reflection-layer renderers
```

Maintain at most the necessary nearby parcel roots:

- previous parcel while passing behind;
- active parcel;
- next fully built parcel while hidden/revealing.

Requirements:

- Complete construction happens before reveal.
- Visibility/reveal never hides mesh construction.
- Rear cull happens beyond player peripheral vision.
- All geological renderers use the reflection layer where appropriate.
- Open water builds no collision-bearing side meshes.
- Presenters consume snapshots/events; they do not select content.

Add development hotkeys or Control Room buttons for:

- jump to each parcel family;
- lock a specific variant;
- show collision footprints;
- show safe/valuable/hero route envelopes;
- pause at entry, active midpoint, exit, and rear-cull points.

---

## 12. Capability validation

Validation must happen per finite parcel, not only across an entire world.

Every parcel must prove:

- safe route reachable at current pace;
- sufficient forward warning for its largest lateral demand;
- no impossible reversal;
- collision footprint matches visible geology;
- route remains open through entry and exit;
- neutral does not accidentally solve every meaningful obstacle wave;
- constant-left and constant-right do not collect the valuable route forever;
- cargo detours remain reachable;
- wave exit leaves enough recovery before the next commitment.

Breathers are exempt from neutral/left/right rejection because they deliberately
contain no challenge.

---

## 13. Required tests

Add engine-neutral tests with names equivalent to:

```text
OpenWaterBreather_HasNoShoreTopologyThreatsOrCargo
OpenWaterFormation_HasFiniteFeaturesAndNoContinuousEnvelope
FormationWave_PreservesAValidSafeRouteAtEverySupportedPace
FormationWave_ValuableRouteRequiresARealDetour
ParcelSequence_InsertsBreatherBetweenMajorWaves
ParcelSequence_DoesNotRepeatRecentFamilyOrVariant
QueuedParcel_IsFullyPlannedBeforeReveal
PreviousParcel_RemainsUntilRearCull
CanyonParcel_HasConnectedEntryInteriorAndExit
RoutePortal_HasMultipleContinuousOpeningsAndNoDeadEnds
CargoRoutes_ReferenceValidatedParcelRoutes
Composer_ProducesMeaningfullyDifferentRunSentences
```

Also add a deterministic runtime trace proving this exact order:

```text
wave active
 -> wave passing behind
 -> empty breather active
 -> next horizon reveal
 -> next wave active
```

A test that only checks enum changes or section counts is insufficient.

---

## 14. Implementation order and rollback checkpoints

### Checkpoint 1 — Parcel contracts

- Add optional-envelope finite parcel model.
- Add composer interfaces and lifecycle.
- Add core tests.
- Do not change visuals yet.

### Checkpoint 2 — True open water

- Update/refactor presenter to build no shore mesh for `Envelope=None`.
- Make the first seconds and breather visibly empty ocean.
- Add entry/exit/rear-cull diagnostics.

### Checkpoint 3 — Small-rock formation wave

- Port old cone cadence/spacing into a formation planner.
- Render faceted waterline formations instead of cones.
- Validate safe and valuable routes.
- Provide at least three distinct formation silhouettes.

### Checkpoint 4 — Canyon and portal parcels

- Move the existing useful canyon/route geometry into finite parcel templates.
- Give both real entrances and exits.
- Ensure open water before and after.

### Checkpoint 5 — Composer variation

- Add template pools, cooldowns, recent-history rejection, and capability
  selection.
- Prove two runs produce different macro sentences.

### Checkpoint 6 — Cargo and presentation polish

- Attach cargo to validated routes.
- Add wave-specific reveal, audio, water reflection, VFX, and haptics.
- Tune cadence and speed sensation.

Commit each checkpoint separately. Preserve unrelated Unity scene, material,
gallery, iOS, and laser-preview changes already present in the dirty worktree.
Never use a destructive reset to clean the repository.

---

## 15. Visual acceptance checklist

The implementation is not complete until a human can observe all of these in
Play Mode:

- The run begins over genuinely open water.
- A finite set of small faceted formations approaches quickly.
- Those formations produce a readable weave with multiple route options.
- The last formation passes entirely behind the ship.
- The screen returns to clean water with no enclosing canyon sides.
- A different landmark appears only after the breather begins.
- A canyon has a real mouth, connected interior, curves, and an exit.
- The canyon disappears behind the player rather than existing forever.
- A second run changes the physical wave sentence, not just mirror/tint/cargo.
- Cargo follows actual route choices.
- No wave pops in or disappears beside the ship.
- No invisible collision remains during open water.

Record or screenshot at least:

1. Midway through true open water.
2. Formation-wave approach.
3. Formation wave passing behind.
4. Empty breather.
5. Canyon entrance.
6. Canyon exit back to water.
7. A different run/variant.

---

## 16. Explicit anti-goals

Do **not** claim completion if any of these are true:

- `OpenWaterReset` is only an enum or lifecycle label.
- Continuous terrain still exists on both sides throughout the run.
- Cargo was added without changing physical world composition.
- Smaller rocks exist only as a few props inside permanent terrain.
- Every world still follows the same six-part order.
- Variants only mirror or slightly offset the same route.
- Unity decides obstacle legality or reward routes.
- The orchestrator accumulates selection, physics, presentation, and economy
  logic.
- A horizon fade is being used to hide runtime object construction.
- The next chat reports tests passing without visually confirming open water and
  parcel transitions.

---

## 17. Definition of done for the first rebuild

The first rebuild is successful when a Play Mode run clearly reads as:

> “I crossed open water, weaved through a finite field of small crystalline
> formations for cargo, watched it pass behind me, got a clean ocean breather,
> then saw and entered a complete canyon that eventually returned me to water.”

If the player instead says:

> “I was in the same canyon loop, but now it had collectibles,”

the rebuild has failed regardless of how many new interfaces, enums, tests, or
comments were added.
