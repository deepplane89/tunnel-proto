# Extraction, Garage, and Encounter Architecture

**Status:** Description of the first implemented extraction/meta vertical slice.
**Next implementation source:** [`META_PROGRESSION_IMPLEMENTATION_SPEC.md`](META_PROGRESSION_IMPLEMENTATION_SPEC.md) supersedes the unit-based cargo, single extraction threshold, and restoration-only performance assumptions when the next phases are built.

## Non-negotiable boundaries

- `JetHorizon.Simulation.Core` owns deterministic run rules: movement, corridor samples, collision, lightning gate layouts, run cargo, extraction eligibility, and finalized run results.
- `JetHorizon.Meta` (inside the same engine-neutral assembly) owns persistent garage rules: inventory, unlocks, ship damage, repair costs/timers, restoration milestones, handling models, thrusters, add-ons, power-up stock, and facilities.
- `JetHorizon.Application` owns use-case coordination and ports. `GarageOrchestrator` may load, invoke one domain operation, save, and call a platform commerce port. It must not contain costs, unlock thresholds, physics values, or repair formulas.
- Unity owns rendering, input adaptation, UI, persistence adapters, audio/haptics, GLB node visibility, and composition. It may not decide whether a collision is legal, where a lightning opening is, what cargo survives, or what an upgrade costs.

## Run-to-garage flow

1. The simulation spawns deterministic cargo pickups and stores collected units in a run-local ledger.
2. Cargo is visible in the simulation snapshot but is not persistent currency.
3. At the extraction distance, the snapshot exposes `ExtractionAvailable`.
4. The player requests extraction through the Unity adapter.
5. The simulation finalizes the score and emits an immutable `RunCargoManifest`.
6. `GarageOrchestrator` maps that result through the garage domain, saves the new state, and exposes a copy to Unity.
7. If the ship is destroyed, the manifest is discarded and the garage domain applies component damage instead.

## Starter restoration curve

The starter Runner is a wreck with weak thrusters, limited stabilization, one-hit survival, and a small cargo bay.

1. Extraction 1 restores the primary thruster and equips LIGHT.
2. Extraction 2 restores stabilizers and unlocks Stabilizer I.
3. Extraction 3 reinforces the hull so one collision can be survived.
4. Extraction 4 opens a shield-generator versus cargo-bay restoration choice.
5. Later progression opens handling models, additional thrusters, GLB add-ons, repair bays, mechanic bots, and power-up tiers.

## Handling selection

The garage stores a stable handling ID. The engine-neutral catalog owns the source values for Default, Glide, Wipeout, Rail, and Jet. A `ShipLaunchProfile` derives portable speed, acceleration, lateral-speed, settle, bank, drift, horizon, and presentation-juice values. Unity applies that profile only while composing a new simulation and presentation; the UI does not tune physics directly.

## Prismatic force-field tunnel

L4/L5 use the existing `SineCorridorDefinition` center and half-width math. The core publishes moving cross-section samples and resolves collision against those same samples. Unity sorts them by depth and stitches adjacent arches into one continuous, double-sided, water-reflectable membrane. Animated spectrum flow, longitudinal rails, and energized ribs are shader detail on the single surface, not separate gameplay objects.

## Lightning gate composer

Lightning no longer predicts or aims at the live player. Each encounter selects a deterministic safe-opening sequence and fills the rest of the corridor with telegraphed strike columns. The patterns explicitly defeat constant-left, constant-right, and neutral flight while limiting opening movement to reachable increments. Presentation reads hazard snapshots and never changes a strike location.

## Required regression tests

- Same seed plus inputs produces identical snapshots and encounters.
- Core and application assemblies reference no Unity engine assemblies.
- Continuous corridor snapshots replace cone rows when the feature is enabled.
- Corridor visuals and collision consume the same core sample.
- Every lightning pattern defeats left edge, right edge, and neutral camping.
- Every lightning opening transition is reachable under the configured handling envelope.
- Cargo remains run-local until explicit extraction.
- Death does not bank cargo.
- Extraction settlement and run completion are idempotent.
- Starter restoration milestones occur in order.
- Handling selection changes derived launch physics without putting rules in the UI or orchestrator.
- Repair completion is driven by an injected UTC clock, never by gameplay delta time.

## Extension seams

- Replace `DisabledRepairAcceleration` with StoreKit/Unity IAP only at the platform port.
- Add authored extraction-gate presentation without changing settlement rules.
- Expand `ThrusterEffectCatalog` and add-on sockets without changing garage ownership rules.
- Replace PlayerPrefs persistence with cloud save through `IGarageProgressStore`.
- Add remote balancing by loading validated catalog data into the engine-neutral definitions.
