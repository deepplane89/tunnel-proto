# Jet Horizon Meta Progression Implementation Specification

**Status:** Foundation implemented; content and physical presentation remain in progress

**Scope:** Cargo, extraction, Heat, ship performance, handling, upgrades, damage, repair, power-ups, garage, economy, persistence, presentation, analytics seams, and tests

**Architecture requirement:** Engine-neutral rules remain authoritative. Unity presents and adapts. The application layer coordinates without owning formulas.

## Current implementation checkpoint

Implemented in the `codex/engine-neutral-core-v1` branch:

- weighted Salvage, Alloy, and Prism cargo definitions with capacity rejection and Heat-dependent selection;
- repeating extraction windows, explicit extract/pass behavior, and Heat-driven speed, reward, rarity, and encounter-intensity values;
- persistent upgrade levels and increasing credit costs for engine, stabilizers, cargo bay, hull, shield, laser, magnet, and overdrive;
- ship launch parameters derived from upgrade tier, subsystem integrity, and selected handling model;
- the four-extraction wreck-restoration arc, including a shield-or-cargo priority choice without permanently locking the other branch;
- temporary pooled cargo-pod renderers, cargo/Heat HUD readouts, extraction controls, and a functional temporary garage menu;
- persistence migration and engine-neutral tests for cargo, extraction, Heat, restoration, and upgrades.

Deliberately still replaceable or unimplemented:

- final cargo models, ship-mounted cargo anchors, pickup rejection feedback, and authored extraction-beacon art;
- the new obstacle encounter composer, hidden-opening route model, straight-line rejection, and final encounter library;
- a physical evolving garage scene and final mobile UI;
- deeper typed subsystem-damage results, visual repair work states, contracts, and retention layers.

The existing cone, canyon, corridor, and lightning content therefore remains active for now. The core exposes `EncounterIntensity` as a clean escalation input, but the eventual encounter system—not the meta or orchestrator—will decide how that intensity selects and composes obstacle content.

## 1. Product north star

The complete player loop is deliberately easy to understand:

> Fly, collect cargo, decide when to extract, improve the ship, and fly again.

The depth comes from increasingly valuable risk and from tactile ship improvement, not from exposing many menus at once.

The player should feel three simultaneous motivations:

1. **Immediate:** survive the next encounter and collect the cargo in view.
2. **Run-level:** extract safely now or continue at higher Heat for more valuable cargo.
3. **Meta-level:** spend limited credits on cargo capacity, speed, handling, durability, power-up strength, or the garage.

The intended long-term sensation is similar to a strong movement-progression game: the starter wreck is completely playable, but a developed ship is so much faster and more controllable that returning to the wreck would feel painfully limiting.

## 2. Locked design decisions

- The starter ship is a damaged wreck, not a finished ship.
- Early weakness means limited control authority and power, never delayed or ignored input.
- Ship upgrades cause real gameplay changes, amplified by Unity presentation.
- Credits are the shared currency for permanent performance upgrades.
- Upgrade levels have steadily increasing credit costs.
- Cargo capacity is measured by **weight**, not by an inventory grid or uniform unit count.
- Later cargo is heavier and more valuable.
- Cargo weight consumes hold capacity but does **not** slow or destabilize the ship in the initial implementation.
- If cargo does not fit, it is not collected. There is no manual discard interface initially.
- Repeating extraction opportunities create the central push-your-luck decision.
- Passing an extraction opportunity raises Heat, reward quality, speed, and encounter complexity.
- Crash/death loses unextracted cargo and damages persistent ship systems.
- Players may fly a damaged ship. Repairs should not hard-lock the game.
- Permanent handling strength and selectable handling style are separate systems.
- Power-up strength can be permanently upgraded.
- Unity Rigidbody contacts do not own ship movement. The deterministic core remains authoritative.
- The garage is a physical, visibly evolving place, not only a list of buttons.
- The first several extractions are tightly authored so every early run creates an obvious improvement.

## 3. Player-facing complexity budget

The game may contain deep systems internally, but the initial player-facing verbs remain:

- **Run:** steer, dodge, collect, activate power-ups, extract.
- **Garage:** repair, upgrade, select handling/loadout, launch.

Initial release should not require:

- cargo grids or rearranging cargo;
- equipment affixes;
- several simultaneous contracts;
- manual crew assignment;
- prestige trees;
- a battle pass;
- randomized paid loot;
- cargo-weight handling penalties.

Those are optional later layers, not requirements for the core loop.

## 4. Nested gameplay loops

### 4.1 Moment-to-moment flight

1. The ship moves forward automatically.
2. The player strafes left or right and uses knife-edge roll where required.
3. Obstacles form intentional navigation problems rather than random clutter.
4. Cargo appears along risky but reachable lines.
5. Power-ups temporarily change how the player attacks or survives the encounter.
6. Near misses, destruction, collection, sound, lighting, water, and haptics provide immediate feedback.

### 4.2 Run-level extraction loop

1. Launch at a short warm-up speed.
2. Collect cargo into a weight-limited hold.
3. Reach an extraction window.
4. Extract and bank the cargo, or pass the window.
5. Passing raises Heat and improves prospective rewards.
6. Repeat until the player extracts or is destroyed.

### 4.3 Garage loop

1. Extracted cargo is settled into persistent rewards.
2. Damage and active repairs are shown on the actual ship.
3. The garage highlights one or two relevant improvements without choosing for the player.
4. The player spends credits among competing upgrade tracks.
5. The player optionally changes handling style, thruster presentation, add-ons, and starting power-up.
6. Launch again and immediately feel the result.

### 4.4 Long-term loop

- Restore the wreck.
- Improve subsystem levels.
- Expand the physical garage.
- Unlock handling styles, thrusters, add-ons, sectors, cargo classes, and power-up tiers.
- Build specialized ships rather than completing a single strictly linear upgrade path.

## 5. First-session restoration curve

The starter ship should feel compromised but never unpleasant.

### Starting condition

- Forward cruise: approximately 78% of restored baseline.
- Lateral acceleration: approximately 78%.
- Maximum lateral velocity: approximately 86%.
- Neutral stabilization: approximately 72%.
- Countersteering authority: approximately 70%.
- Bank recovery: approximately 78%.
- Hull: destroyed by one meaningful collision.
- Cargo bay: small but sufficient for the first run.
- Thrusters: weak, asymmetric, sputtering, and dim.
- Starter-garage repairs: instant or nearly instant.

There must be no artificial input lag, random steering error, dropped input, or hidden aim correction.

### First four successful extractions

1. **Primary thruster restored**
   - Large forward-speed and acceleration improvement.
   - LIGHT thruster equipped.
   - Garage ignition presentation makes the restoration memorable.
2. **Stabilizers restored**
   - Strong improvement to lateral acceleration, settling, countersteering, and bank recovery.
   - Stabilizer I becomes physically visible on the GLB.
3. **Hull reinforced**
   - The ship survives one glancing collision.
   - Hull lighting/material presentation becomes cleaner.
4. **Restoration branch unlocked**
   - Choose shield generation or cargo-bay restoration first.
   - The unchosen branch remains available later; this is a sequencing choice, not permanent account damage.

After the fourth extraction, the system opens into normal level-based progression.

## 6. Cargo system

### 6.1 Cargo definition

Every collectible cargo type has an engine-neutral definition:

```text
CargoDefinition
- id
- displayCategory
- weight
- creditValue
- salvageYield
- prismYield
- minimumSector
- minimumHeat
- rarity
- presentationId
```

Gameplay rules use the definition values. Unity uses `presentationId` to choose geometry, material, light, collection animation, and audio.

### 6.2 Initial cargo ladder

Exact values are tunable data, but the initial relationship should resemble:

| Cargo class | Example weight | Relative value | Availability |
| --- | ---: | ---: | --- |
| Scrap bundle | 1 | Low | Starter sector, Heat 0 |
| Salvage crate | 2 | Low-medium | Starter sector |
| Alloy container | 4 | Medium | Later starter runs / Heat 1 |
| Prism battery | 7 | High | Heat 2+ |
| Prototype component | 11 | Very high | Later sector / high Heat |

Later cargo is heavier and more valuable. Capacity progression is therefore useful even if the player never fills the hold with dozens of small objects.

### 6.3 Cargo hold

The run-local ledger records:

- maximum weight;
- used weight;
- cargo quantities by definition;
- projected credit value;
- projected salvage and prism yield.

Collection succeeds only when:

```text
usedWeight + cargoWeight <= maximumWeight
```

If collection fails, Unity gives immediate readable feedback: a brief hold-full indicator, a distinct sound, and a visible response on the cargo object. The game does not open an inventory screen during flight.

### 6.4 Cargo capacity curve

Initial capacity targets:

```text
10 -> 14 -> 19 -> 25 -> 32 -> 40 -> 50
```

This is an illustrative curve, not a locked balance table. Each level costs more credits than the previous level. High levels may additionally require extracted rare material or a blueprint, but credits remain the primary opportunity cost.

### 6.5 Settlement and loss

- Cargo exists only in the run-local ledger until extraction completes.
- Extraction produces one immutable settlement manifest.
- Standard cargo contributes credits.
- Salvage-bearing cargo contributes repair/construction material.
- Rare cargo may contribute prisms or unlock blueprints.
- Death discards the unextracted ledger.
- Settlement and death are mutually exclusive and idempotent.
- Cargo weight never modifies handling in the initial implementation.

Cargo insurance may be explored later, but it is not part of the first implementation.

## 7. Extraction windows and Heat

### 7.1 Repeating extraction windows

Replace the single fixed extraction threshold with a schedule of extraction windows.

Each window has:

- opening distance/time;
- closing distance/time;
- current cargo settlement preview;
- current Heat;
- next-Heat reward preview;
- an explicit extract command.

The player can extract while the window is active or continue flying. Ignoring or passing the window counts as a deliberate continuation and raises Heat once.

### 7.2 Heat state

Heat is run-local and resets on launch.

Heat influences:

- cargo definition availability;
- cargo value multiplier;
- rare-cargo probability;
- encounter grammar;
- within-run speed multiplier;
- presentation intensity;
- score multiplier.

Illustrative starting targets:

| Heat | Reward multiplier | Run character |
| ---: | ---: | --- |
| 0 | 1.00x | Warm-up, common cargo |
| 1 | 1.30x | Faster, alloy introduced |
| 2 | 1.70x | Harder compositions, prism chance |
| 3 | 2.20x | Elite encounters, prototype chance |
| 4+ | 2.80x+ | Extreme risk and prestige rewards |

These values must be externally tunable through a validated engine-neutral catalog.

### 7.3 Speed within a run

- Launch at roughly 90% of the ship's persistent cruise speed.
- Reach normal cruise during the first 20-30 seconds.
- Each passed extraction window adds an illustrative 5-8% speed.
- Heat speed should have a defined cap.

Persistent ship progression and run Heat multiply one another:

```text
effectiveForwardSpeed = shipCruiseSpeed * warmupMultiplier * heatSpeedMultiplier * temporaryPowerupMultiplier
```

### 7.4 Fairness at different ship levels

Encounter scheduling uses time-to-contact and the current immutable launch profile. Faster ships receive farther spawn/look-ahead distances so telegraphs remain readable.

The world must not perfectly rubber-band:

- Early content becomes easier and faster for developed ships.
- Higher Heat and later sectors introduce patterns designed for stronger ships.
- Every required transition remains reachable for the minimum ship profile allowed into that content.
- Lightning opening transitions are validated against that profile's reversal and lateral-travel envelope.

## 8. Ship performance model

### 8.1 Separation of concepts

Three inputs create the final launch performance:

1. **Subsystem level:** permanent vertical progression.
2. **Subsystem integrity:** temporary damage penalty.
3. **Handling style:** horizontal feel/behavior choice.

```text
effectiveStat = levelCurve(level) * integrityModifier(integrity) * handlingStyleModifier
```

The meta domain derives one immutable `ShipPerformanceProfile` before launch. The simulation consumes it. Unity does not calculate gameplay stats.

### 8.2 Performance fields

The profile should contain at minimum:

- cruise speed;
- forward acceleration;
- lateral acceleration;
- maximum lateral velocity;
- neutral stabilization/deceleration;
- countersteering multiplier;
- bank maximum and response;
- bank recovery;
- roll authority if it becomes upgradeable;
- collision hit capacity;
- cargo weight capacity;
- individual power-up parameters;
- content-access rating if sectors use recommendations.

Unity derives presentation settings from the authoritative profile but cannot feed presentation motion back into collision.

### 8.3 Tactile progression targets

| Performance property | Wreck | Restored | Midgame | Late game |
| --- | ---: | ---: | ---: | ---: |
| Forward cruise | 78% | 100% | 120% | 145% |
| Lateral acceleration | 78% | 100% | 115% | 130% |
| Maximum lateral velocity | 86% | 100% | 108% | 115% |
| Neutral stabilization | 72% | 100% | 125% | 145% |
| Countersteering | 70% | 100% | 130% | 160% |
| Bank recovery | 78% | 100% | 112% | 130% |

The largest control improvement is acceleration, reversal, and settling. Maximum lateral speed grows more conservatively to preserve precise positioning.

### 8.4 Physics behavior

The deterministic lateral model remains velocity-based:

- held input applies lateral acceleration;
- velocity clamps to the current maximum;
- no input applies neutral stabilization;
- opposite input receives countersteering authority;
- position integrates from velocity at fixed timestep;
- bank derives from authoritative lateral motion;
- knife-edge penalties apply in deterministic source order.

The starter ship feels heavy because momentum builds and dissipates slowly. It does not feel broken because input begins affecting acceleration immediately.

## 9. Upgrade tracks and shared-credit decisions

### 9.1 Upgrade categories

| Track | Primary result | Secondary result |
| --- | --- | --- |
| Engine | Cruise speed | Forward acceleration and overdrive ceiling |
| Stabilizers | Lateral acceleration | Settling, countersteering, bank recovery |
| Cargo bay | Maximum cargo weight | Visible cargo hardware |
| Hull | Collision capacity | Reduced persistent subsystem damage |
| Shield generator | Shield strength | Shield duration/cargo protection later |
| Laser | Width and duration | Destruction yield/feedback intensity |
| Magnet | Collection radius | Collection response |
| Overdrive | Speed multiplier | Duration and Heat/reward interaction |
| Repair bay | Parallel repair capacity | Garage visual expansion |
| Mechanic bots | Repair duration | Visible garage activity |

### 9.2 Increasing costs

Each upgrade definition owns an explicit per-level cost table or a validated increasing curve. No UI or orchestrator may calculate costs.

An initial curve can be generated as:

```text
cost(level) = roundedBaseCost * growthFactor^(level - 1)
```

but the shipped catalog should contain resolved values so balancing changes do not alter historical behavior unexpectedly.

Rules:

- Every next level costs more than the prior level.
- Early upgrades are obtainable after roughly one successful run.
- Midgame upgrades require several decisions/runs.
- Expensive levels may require a rare extracted prerequisite in addition to credits.
- No track should become mathematically mandatory for all players.
- The garage always shows the exact tactile change before purchase.

Example display:

```text
ENGINE 4 -> 5        +5% CRUISE SPEED
STABILIZERS 3 -> 4   -9% REVERSAL TIME
CARGO BAY 2 -> 3     14 -> 19 WEIGHT
LASER 2 -> 3         +15% WIDTH
```

### 9.3 Opportunity-cost behavior

- Cargo capacity improves the amount/value that can be brought home.
- Engine speed increases travel and earning rate but raises execution demand.
- Stabilizers improve the ability to survive complex patterns.
- Hull/shield reduce loss risk.
- Power-up upgrades create short periods of dominance.
- Garage upgrades reduce repair friction.

All compete for credits. The game exposes the consequences of the player's last run, but never secretly selects an upgrade.

## 10. Handling styles

Handling progression and handling selection are separate.

- **Stabilizer/flight-control levels** determine overall control strength.
- **Handling style** determines how that strength is expressed.

Initial styles remain:

- **Default:** balanced reference.
- **Glide:** lower immediate authority, longer drift, smooth recovery.
- **Wipeout:** aggressive lateral velocity and expressive banking.
- **Rail:** precise settling, restrained drift and presentation.
- **Jet:** strong bank/yaw character with responsive recovery.

Handling styles should be sidegrades with comparable overall power budgets. Once a style is unlocked, switching styles is free. Credits improve the ship's handling systems, not the player's preference.

Styles may unlock through successful extractions, restoration, sectors, or blueprints. Unlocking a style should include a safe preview/test lane before committing it to a run.

## 11. Damage and repair

### 11.1 Persistent damage

Destruction creates a deterministic damage result based on impact type/severity and the current hull profile.

Possible affected systems:

- primary thruster;
- stabilizers;
- hull;
- shield generator;
- cargo bay;
- power core, if introduced as a subsystem.

Damage affects the next `ShipPerformanceProfile` through integrity modifiers:

- thruster damage reduces forward/lateral acceleration;
- stabilizer damage increases slide and reversal time;
- hull damage reduces collision capacity;
- cargo-bay damage may temporarily reduce usable weight;
- power damage reduces power-up output.

Damage must never improve a stat.

### 11.2 Repair experience

- First-session repairs are free and immediate/nearly immediate.
- Later repairs cost salvage and potentially credits.
- Repair time grows with subsystem tier and missing integrity.
- Repair bay level controls parallel capacity.
- Mechanic bots reduce duration.
- Players may launch damaged.
- There is always a playable option; the game does not intentionally lock all flight behind a timer.
- Repair acceleration remains a platform port and is not assumed to be monetized during core development.

### 11.3 Visual communication

- Damaged thrusters sputter or become asymmetric.
- Stabilizer damage introduces visual vibration without random gameplay steering.
- Hull damage changes materials, sparks, smoke, and lighting.
- Mechanic bots visibly work on the affected named GLB socket/part.
- Completion produces a strong repair animation and sound.

## 12. Power-ups

### 12.1 Run availability

Power-ups remain collectible during the run. Permanent levels improve their output. Optional preflight charges may guarantee one starting activation later, but charges are not required for the first implementation.

### 12.2 Upgrade behavior

- **Shield:** hit absorption, duration, visual strength; cargo protection is a later extension.
- **Laser:** width, duration, obstacle destruction, debris/salvage feedback.
- **Magnet:** collection radius and pull/collection response.
- **Overdrive:** speed multiplier, duration, visual intensity, and controlled Heat interaction.

### 12.3 Laser satisfaction target

The laser should transform an intimidating obstacle formation into a brief power fantasy:

- wide, bright, persistent beam;
- multiple objects destroyed in one readable sweep;
- pooled fragments and light response;
- escalating destruction combo;
- strong audio/haptic layering;
- cargo/reward feedback emitted from core-owned destruction results.

Unity owns the spectacle. The simulation owns which object was destroyed and what reward was created.

## 13. Garage experience

### 13.1 Physical layout

The garage should contain:

- the actual Runner GLB as the visual center;
- named add-ons attached through stable sockets/nodes;
- equipped thrusters visibly active during preview;
- repair bots working on damaged systems;
- owned thrusters/add-ons displayed in the environment;
- physical expansion as repair bay/facility levels increase;
- recovered prototypes/artifacts displayed later.

### 13.2 Information hierarchy

The primary garage screen should show:

1. Current ship condition.
2. Current credits, salvage, and rare resource.
3. One clearly visible recommended improvement based on the last run.
4. Upgrade categories.
5. Repair status.
6. Handling/loadout selection.
7. Launch.

Recommendations are explanatory only:

- hold rejected cargo -> show cargo capacity;
- slow reversal-related death -> show stabilizers;
- low cruise/earning rate -> show engine;
- collision death at deep Heat -> show hull/shield;
- frequent power-up use -> show its permanent upgrade.

The underlying rules do not change based on the recommendation.

### 13.3 Upgrade feedback

Every purchase should produce:

- before/after stat text;
- a visible GLB or garage reaction where applicable;
- sound and restrained haptic feedback;
- an immediate preview of the upgraded thruster/control/power-up presentation;
- a clear indication of the next cost.

The player should leave the garage knowing what changed and what the next goal is.

### 13.4 Progressive disclosure

- Launch 1 exposes only cargo/extraction.
- Extraction 1 exposes engine restoration.
- First death exposes repair.
- Extraction 2 exposes stabilizer/handling progression.
- Extraction 3 exposes hull progression.
- Extraction 4 exposes restoration branching.
- Later milestones expose power-up levels, add-ons, facilities, sectors, and contracts.

## 14. Economy

### 14.1 Persistent balances

Initial economy should remain legible:

- **Credits:** permanent performance upgrades and equipment purchases.
- **Salvage:** repairs and garage construction requirements.
- **Prisms/blueprints:** rare unlock requirements.

Avoid adding another prominent currency until playtesting proves it has a distinct purpose.

### 14.2 Sources

| Source | Primary output |
| --- | --- |
| Extracted standard cargo | Credits |
| Extracted salvage cargo | Salvage plus modest credits |
| Extracted rare cargo | Prisms/blueprints plus credits |
| Distance/score | Modest credits and leaderboard value |
| Contracts later | Targeted credits/materials |

### 14.3 Sinks

| Sink | Resource |
| --- | --- |
| Performance levels | Credits |
| Thrusters/add-ons | Credits plus unlock requirement |
| Repairs | Salvage, later possibly credits |
| Garage facilities | Credits plus salvage |
| Rare levels | Credits plus prism/blueprint prerequisite |

### 14.4 Balance targets

- A successful first run should buy one obvious improvement.
- Early failed runs should not create unrecoverable debt.
- The player should usually have two desirable but mutually exclusive credit purchases.
- Capacity cost growth balances its compounding earning benefit.
- Later heavier cargo makes high capacity valuable without additional conditional rules.
- Score rewards cannot inflate the economy faster than upgrade costs.
- Balance data is versioned and validated before use.

## 15. Content progression

### 15.1 Sectors

Later sectors provide:

- new obstacle grammars;
- heavier cargo definitions;
- higher-value reward tables;
- new lighting/weather identities;
- blueprints and add-ons;
- recommended, not absolute, ship ratings where possible.

Earlier sectors do not continuously scale to match the player. Returning with a developed ship should feel powerful.

### 15.2 Encounter composition

- Lightning uses deterministic gate patterns with reachable moving openings.
- Prismatic corridors use continuous core-owned sine samples and one stitched Unity surface.
- Canyon/structure encounters use time-to-contact spacing.
- Laser-destructible formations are intentionally authored to create power-up payoff.
- Cargo lines provide risk/reward routes without allowing a permanent trivial straight path.

### 15.3 Later retention layers

Only after the extraction/upgrade loop tests well:

- rotating contracts;
- equipment/handling mastery;
- artifact collections;
- daily first-extraction reward;
- weekly expeditions;
- Game Center leaderboards and ghosts;
- additional ship chassis;
- seasonal sectors/events.

These systems must consume the same domain commands and catalogs rather than introducing Unity-owned progression.

## 16. Architecture and ownership

### 16.1 Dependency direction

```text
Unity input/presentation
        |
        v
Application commands and ports
        |
        v
Engine-neutral simulation + meta domains
        |
        v
Snapshots, immutable results, and domain events
        |
        v
Unity presentation, persistence adapters, audio, haptics, analytics
```

Dependencies always point toward engine-neutral rules.

### 16.2 Simulation domain owns

- fixed-timestep movement;
- current run speed and Heat;
- cargo spawning and weight collection legality;
- extraction-window schedule and extract command legality;
- obstacle/corridor/lightning geometry and collision;
- power-up gameplay effects;
- damage-causing run result;
- immutable extraction/death result;
- deterministic event order.

Proposed types:

```text
CargoDefinition
CargoSnapshot
RunCargoLedger
RunRiskState
ExtractionWindowState
ShipPerformanceProfile
RunSettlementManifest
RunFailureResult
```

### 16.3 Meta domain owns

- persistent balances;
- subsystem levels and integrity;
- increasing upgrade costs;
- upgrade prerequisites;
- restoration milestones;
- handling-style definitions/unlocks;
- thruster/add-on ownership and loadout legality;
- power-up permanent levels;
- repair cost, duration, capacity, and completion;
- settlement of extracted manifests;
- application of failure damage;
- derivation of the next immutable launch profile.

Proposed/expanded types:

```text
GarageState
SubsystemProgressState
UpgradeDefinition
UpgradeCatalog
EconomyCatalog
HandlingStyleDefinition
PowerupProgressState
RepairJobState
ShipPerformanceProfileFactory
```

### 16.4 Application layer owns

- loading state from a port;
- invoking one simulation/meta use case;
- saving returned state;
- dispatching domain events to ports;
- coordinating StoreKit/cloud/clock/analytics adapters.

The orchestrator must not contain:

- costs;
- weights;
- stat curves;
- unlock thresholds;
- repair formulas;
- Heat multipliers;
- cargo-loss rules;
- handling values.

### 16.5 Unity owns

- input-device adaptation;
- scene and object composition;
- snapshot presentation;
- GLB sockets/named-node visibility;
- continuous tunnel mesh/shader;
- thrusters, lighting, water, particles, fragments, audio, haptics;
- garage camera and UI;
- PlayerPrefs/cloud-save adapters;
- StoreKit adapter;
- analytics adapter;
- authoring and tuning tools.

Unity may preview domain data but may not authoritatively recalculate it.

## 17. Commands and events

### 17.1 Core commands

```text
StartRun(ShipPerformanceProfile, RunDefinition, Seed)
ApplyInput(InputFrame)
RequestExtraction()
ActivatePowerup(PowerupId)
PauseRun()
ResumeRun()
```

### 17.2 Garage commands

```text
SettleExtraction(RunSettlementManifest)
ApplyRunFailure(RunFailureResult)
PurchaseUpgrade(UpgradeId)
ChooseRestorationBranch(RestorationBranch)
EquipHandlingStyle(HandlingStyleId)
EquipThruster(ThrusterId)
SetAddOnEquipped(AddOnId, Equipped)
QueueRepair(SubsystemId)
CompleteEligibleRepairs(CurrentUtc)
AccelerateRepair(RepairJobId)
```

### 17.3 Important events

```text
CargoCollected
CargoRejectedForWeight
ExtractionWindowOpened
ExtractionWindowPassed
HeatChanged
RunExtracted
RunDestroyed
UpgradePurchased
RestorationMilestoneCompleted
SubsystemDamaged
RepairStarted
RepairCompleted
LoadoutChanged
```

Events describe completed facts. Unity cannot alter the rule result while presenting them.

## 18. Persistence and migration

- Increment `GarageState.SchemaVersion` for each breaking save change.
- Migrate the current unit-based cargo/capacity model to weight capacity.
- Preserve existing owned thrusters, add-ons, handling selection, balances, and repair jobs.
- Add explicit upgrade levels for engine, stabilizers, cargo bay, hull, shield, and power-ups.
- Never infer a lower level than the player's current restored subsystem tier.
- Save migrations are pure, ordered, idempotent, and tested from every supported prior version.
- The first implementation may retain PlayerPrefs JSON behind `IGarageProgressStore`.
- Cloud Save later replaces the adapter, not the domain.

## 19. Current implementation migration map

The existing foundation should be evolved rather than discarded.

1. Replace `RunCargoLedger` uniform units with definition-based weight accounting.
2. Replace `FirstExtractionDistance` as the only exit with an extraction-window schedule.
3. Add run-local `RunRiskState`/Heat and expose it in snapshots.
4. Expand `SubsystemState.Tier` into real level curves for performance, not only restoration state.
5. Update `CreateLaunchProfile` so level, integrity, and handling style are distinct multipliers.
6. Add countersteering and bank-recovery progression fields to the launch profile.
7. Keep handling styles as free sidegrades after unlock.
8. Replace one-off purchase methods with catalog-driven `PurchaseUpgrade` while retaining specialized equip/repair commands.
9. Separate permanent power-up levels from optional preflight charges.
10. Replace the current runtime-built garage debug screen with an authored garage presenter that consumes the same commands/state.
11. Preserve the thin `GarageOrchestrator`; move no formulas into it.
12. Retain current deterministic prismatic/lightning implementations and feed them the new performance/reachability envelope.

## 20. Testing requirements

### 20.1 Simulation tests

- Same seed, profile, inputs, and commands produce identical results.
- Cargo collection respects exact weight boundaries.
- Rejected cargo never enters the ledger.
- Cargo does not alter movement physics.
- Extraction manifests exactly match the ledger once.
- Death cannot settle cargo.
- Extraction windows open/pass once and Heat increments once.
- Heat reward and speed values come from the validated catalog.
- Time-to-contact remains inside defined tolerances at different cruise speeds.
- Every encounter is reachable by the minimum permitted profile.
- Power-up destruction/rewards are deterministic.

### 20.2 Meta-domain tests

- Every upgrade cost is strictly increasing.
- Purchasing deducts the exact cost once.
- Insufficient balance leaves state unchanged.
- Every performance level is monotonic in its intended stat.
- Damage never improves performance.
- Repair never reduces integrity.
- Handling styles change behavior without granting an unintended vertical power advantage.
- Cargo capacity levels resolve to the catalog weight limits.
- Restoration milestones occur in order and are idempotent.
- Settlement and failure are mutually exclusive.
- Starter repairs remain within the intended onboarding duration.

### 20.3 Architecture tests

- Runtime and application assemblies reference no Unity assemblies.
- Orchestrators contain no catalog constants or progression formulas.
- Unity presenters do not decide extraction, purchase, cargo, damage, or collision legality.
- Save migrations are pure and repeatable.

### 20.4 Unity tests

- Garage UI renders every domain state without changing it.
- Purchase buttons issue commands and display returned results.
- GLB add-ons and thrusters reflect equipped IDs.
- Speed/control progression drives presentation effects without moving the collision root.
- Continuous tunnel and lightning presentation consume snapshots only.
- Repair and restoration sequences survive scene reload/relaunch.

## 21. Analytics and balancing seams

Analytics records decisions; it never affects a deterministic run tick.

Minimum events:

- run started with performance/loadout summary;
- cargo collected/rejected by definition and Heat;
- extraction window offered, accepted, or passed;
- Heat reached;
- death cause and last decision;
- extraction manifest;
- garage screen entered;
- upgrade viewed/purchased;
- repair started/completed;
- next run started after upgrade.

Primary balancing questions:

- How quickly does the first extraction occur?
- At which Heat does each cohort usually extract or die?
- Which upgrade is bought after each failure type?
- How often is cargo rejected for weight?
- Does capacity dominate all other purchases?
- How much does each control level improve survival?
- How many runs occur between meaningful upgrades?

Remote configuration may later provide versioned catalog values. The core must validate them and fall back to bundled defaults. A remote service never directly changes live state or calculates a purchase.

## 22. Implementation order

### Phase 1: performance and weighted cargo foundation

- Introduce versioned upgrade/economy catalogs.
- Add subsystem performance levels.
- Derive a complete immutable ship performance profile.
- Convert run cargo to weight definitions.
- Add strict domain and migration tests.

### Phase 2: repeating extraction and Heat

- Add extraction-window state machine.
- Add pass/continue behavior.
- Add Heat reward, cargo, encounter, and speed modifiers.
- Convert spawn/telegraph spacing to time-to-contact where necessary.
- Add reachability tests for starter and developed profiles.

### Phase 3: upgrade economy and garage flow

- Add catalog-driven upgrade purchase command.
- Wire shared-credit choices.
- Build upgrade previews and progressive disclosure.
- Build physical repair/upgrade presentation around the GLB.
- Add handling-style preview and loadout flow.

### Phase 4: damage and repair depth

- Produce typed failure/damage results.
- Apply performance penalties by subsystem integrity.
- Connect repair jobs, bays, bots, and visual work states.
- Verify damaged launch remains playable.

### Phase 5: power-up progression and payoff

- Derive power-up parameters from permanent levels.
- Improve laser destruction/reward presentation.
- Wire shield, magnet, and overdrive meta effects.
- Decide whether optional starting charges add value after testing.

### Phase 6: content and retention layers

- Add sector cargo/encounter catalogs.
- Add contracts and collections only after the base loop validates.
- Add analytics-backed tuning and safe remote catalog overrides.
- Add social/seasonal systems last.

## 23. Acceptance criteria for the complete foundation

The foundation is ready for content production when:

- A new player can understand the loop without reading a systems tutorial.
- The first successful extraction causes an immediately obvious speed improvement.
- The second causes an immediately obvious control improvement.
- A late-game profile feels dramatically faster and more controllable than the wreck.
- The wreck remains fair and responsive.
- Later cargo is visibly heavier/more valuable and requires capacity investment.
- Credits consistently create meaningful competition among capacity, speed, handling, durability, and power.
- Passing an extraction opportunity creates understandable additional risk and reward.
- Damage changes the next run tactically and visually without blocking play.
- Garage purchases visibly and mechanically change the ship.
- Earlier content becomes a power fantasy without invalidating later challenge.
- All rule decisions remain deterministic and engine-neutral.
- The orchestrator remains a thin coordinator.
- Unity can replace any presentation without rewriting progression rules.

## 24. Tuning decisions intentionally left open

The following values require playtesting and are not architecture decisions:

- exact cargo weights and values;
- exact capacity levels;
- upgrade base costs and growth rates;
- extraction-window intervals;
- Heat reward/speed multipliers;
- subsystem damage distributions;
- repair times and material costs;
- power-up level curves;
- sector entry recommendations;
- the number of upgrades expected per session.

These values belong in validated, versioned catalogs so they can be tuned without moving ownership or rewriting UI.

## 25. Rollback and change discipline

- Implement one phase per checkpoint.
- Keep migrations additive until the replacement is verified.
- Disable legacy rules only after deterministic and play-mode parity checks.
- Commit catalogs, domain logic, tests, and Unity adapters in reviewable slices.
- Preserve the existing engine-neutral vertical slice as the rollback baseline.
