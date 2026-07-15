# Encounter Capability Coordination

**Status:** Proof-slice architecture implemented; visual and difficulty tuning pending

## Implemented proof checkpoint (2026-07-15)

- `RunPaceModel` is the sole composition formula for permanent capability, Heat,
  encounter approach, and temporary power-up pace.
- `ShipCapabilityProfile`, encounter contracts, deterministic reachability, and
  neutral/constant-left/constant-right rejection live in the engine-neutral core.
- `ProofEncounterRuntime` streams three deliberate plans: monumental broad weave,
  a shifting lightning-opening sequence, and a continuous prismatic sine corridor.
- Cargo is authored as optional safe, risky, or deep route lines. Heat controls the
  grade of cargo offered without changing route legality.
- The laser pickup is explicitly placed before two dense destroyable formations.
- The extraction gate crossing and extract-versus-continue result are core-owned.
  Unity's gate, monument, lightning, cargo, and tunnel components are presenters.
- The extra `ShipOrganicMotion` spring layer remains installed but disabled while
  deterministic handling feel is evaluated.
- First extraction still grants pending free primary-thruster repair work; it does
  not silently grant a purchased engine tier.

The checkpoint is intentionally reversible and coexists with the legacy stage
content for later comparison. The proof build selects the new runtime explicitly
through `SimulationConfig.ProofEncounterMode`.

## Purpose

Jet Horizon must increase pace across persistent ship progression and in-run Heat without spawning obstacle arrangements that the active ship cannot survive. The architecture must preserve deterministic, engine-neutral gameplay rules while allowing Unity to provide large streamed structures, continuous prismatic tunnels, readable telegraphs, lighting, audio, and camera response.

## Non-negotiable ownership

### Engine-neutral core owns

- the immutable ship capability profile used for a run;
- the single authoritative run-pace state;
- Heat and extraction progression;
- encounter definitions, selection, and deterministic seeds;
- intended openings, corridor samples, hazard volumes, and cargo-risk routes;
- reachability, straight-line rejection, and one-direction rejection;
- collision legality and encounter completion results.

### Application layer owns

- loading current garage state;
- invoking one domain command per use case;
- saving successful results;
- supplying time and platform-service ports;
- handing immutable launch and encounter results between systems.

The application orchestrator owns no formulas, costs, unlocks, speed curves, reachability rules, repair effects, or obstacle geometry.

### Unity owns

- input adaptation;
- pooled GameObjects and mesh chunks;
- large-structure, lightning, prismatic-arch, cargo, and extraction-gate presentation;
- LOD, fading, fog, materials, lighting, audio, haptics, and camera response;
- editor gizmos and tuning inspectors that edit validated data;
- mapping core presentation identifiers to replaceable assets.

Unity physics contacts and MeshColliders may support effects, but they are not gameplay truth.

## Separate garage operations

The garage exposes distinct commands with non-overlapping invariants:

| Operation | May change integrity | May change tier | May spend upgrade credits |
|---|---:|---:|---:|
| Starter repair | Yes | No | No |
| Repair job | Yes | No | No |
| Starter upgrade installation | Yes, when replacing hardware | Yes | No |
| Purchased capability upgrade | No | Yes | Yes |

Extracting cargo only banks rewards and grants pending starter work. It never silently changes the next launch profile. The player explicitly completes a repair or installs an upgrade in the garage.

## Single speed authority

The current legacy stage multipliers, permanent engine multiplier, Heat multiplier, and overdrive must not remain independent global speed clocks.

The target core model is:

```text
effectiveForwardSpeed =
    persistentCruiseCapability
    x depthHeatModifier
    x explicitEncounterApproachModifier
    x temporaryPowerupModifier
```

- Permanent engine upgrades change the next run's cruise capability only after explicit installation.
- Heat changes the current run's target pace and blends over a defined distance/time.
- An encounter approach modifier may guide speed into a declared safe band; it cannot silently alter steering capability.
- Overdrive is temporary and declared to encounter validation.
- Legacy stage speed values become reference tempo/capability metadata rather than another unconditional multiplier.
- Raw score or elapsed time does not add an unbounded hidden speed ramp.

## Ship capability profile

The garage domain creates an immutable launch profile. The simulation converts it into the capability values needed by encounter validation:

```text
ShipCapabilityProfile
- forward cruise speed
- forward acceleration/recovery
- maximum lateral velocity
- lateral acceleration
- countersteering authority
- neutral settling
- ship collision half-width
- hull hit capacity
- active damage modifiers
```

Selectable handling style changes the shape of the capability profile. Permanent tiers and current integrity remain separate inputs.

## Encounter contract

Each authored encounter family or generated variant declares:

```text
EncounterCapabilityContract
- minimum and maximum entry speed
- reference speed and handling profile
- minimum telegraph time
- required lateral acceleration and velocity
- maximum reversal demand
- minimum clearance margin
- allowed Heat range
- approach and recovery distance
- whether overdrive is supported
```

Canonical L3/L4/L5 corridors retain their original reference speed and handling metadata. New variants may alter longitudinal wavelength and recovery distance, but must not scale away every handling advantage earned by the player.

## Reachability validation

Validation operates on the same deterministic movement equations as live play.

1. Convert distance between encounter samples into available time using effective forward speed.
2. Propagate reachable lateral position and velocity states using maximum left, right, countersteer, and settle inputs.
3. Remove states outside the safe opening after subtracting ship collision width and safety margin.
4. Reject the encounter if the reachable state set becomes empty.
5. Separately test neutral input, continuous-left input, and continuous-right input.
6. Reject patterns cleared by an unintended trivial route.
7. Produce a feasibility margin used for difficulty selection and editor visualization.

This is mathematical simulation, not an input recording harness.

## Encounter composition

The composer emits world parcels rather than isolated random obstacles:

```text
EncounterPlan
- entry and exit capability contracts
- broad intended opening sequence
- monumental structure anchors
- lightning roles and locked strike positions
- optional cargo-risk route
- prismatic corridor samples when applicable
- recovery region
- presentation identifiers
```

Heat selects from harder eligible plans. Ship capability determines eligibility. Cargo and extraction context may influence optional routes, but neither Unity nor the orchestrator may change plan legality.

## Unity presentation flow

```text
EncounterPlan
    -> WorldParcelStreamer
    -> MonumentPresenter / LightningPresenter / PrismaticArchPresenter
    -> lighting, fog, audio, haptics, and camera response
```

Presenters consume snapshots and presentation events. They do not query garage state, calculate difficulty, select openings, or decide collisions.

## Anti-god-script constraints

- `GameManager` remains a composition root and high-level lifecycle adapter.
- No `WorldDirector` may own speed, selection, spawning, collision, VFX, and persistence together.
- Encounter selection, validation, and runtime advancement are separate core classes.
- Monument, lightning, prismatic tunnel, cargo, extraction, camera, and audio remain separate Unity presenters.
- Shared data crosses boundaries through immutable profiles, plans, snapshots, commands, and events.
- Editor tooling edits data assets or validated profiles; it does not become a second runtime rule engine.

## Implementation order

1. Consolidate the single speed authority and migrate legacy stage speeds to encounter metadata.
2. Add the engine-neutral `ShipCapabilityProfile` and `EncounterCapabilityContract`.
3. Add deterministic reachability and trivial-route validators with L3/L4 parity tests.
4. Add the parcel-based encounter composer and initial broad-weave/lightning/prismatic plans.
5. Add Unity world streaming and editor route visualization.
6. Build final monumental structures, prismatic materials, extraction presentation, and tuning content.

The architecture is sufficiently specified to begin. Remaining questions—exact speed bands, structure sizes, tunnel widths, Heat cadence, and safety margins—are tuning data to validate through play, not reasons to move rules into Unity or the orchestrator.
