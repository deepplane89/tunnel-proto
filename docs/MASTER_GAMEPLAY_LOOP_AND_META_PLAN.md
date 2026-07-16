# Jet Horizon — Master Gameplay Loop, Encounter, Clock, Score, and Meta Plan

**Status:** Production-loop architecture implemented; live visual/tuning validation required
**Primary objective:** Turn the existing ship/water/sun presentation into a simple, repeatable mobile loop built around speed gates, cargo, lightning, asteroids, canyon traversal, and occasional spectacular corridor transitions.

---

## 1. The Game in One Sentence

**Hit gates to build speed, leave the gate line to collect valuable cargo, survive authored lightning/asteroid patterns, and periodically extract the unsecured cargo or continue into a faster and more valuable sector.**

The player should understand the run within ten seconds:

1. Green bands make the ship faster.
2. Gold cargo improves the persistent ship and garage.
3. Blue-white lightning and flaming asteroids are dangerous.
4. A short open-water breather asks `EXTRACT?` with `YES` and `NO`.
5. Continuing preserves speed and increases danger and reward.

The sun, water, ship, reflections, stars, canyon, and tunnel are the fantasy. The mechanics should organize attention without covering that fantasy in UI.

---

## 2. Non-Negotiable Design Rules

1. **The run begins slow.** Speed is earned by passing through gates.
2. **There are many gates.** Ordinary gates give tiny increases; rare gates give meaningful surges.
3. **Cargo is the economy objective.** Gates are not currency and do not replace cargo.
4. **Lightning is an environmental obstacle.** It is never a player weapon.
5. **Patterns are composed, not independently randomized.** Gates, cargo, lightning, asteroids, cones, and environments must share one route plan.
6. **Every generated encounter is traversable by the equipped ship.**
7. **Generated encounters reject trivial neutral, permanent-left, and permanent-right solutions.**
8. **Canyons and tunnels are environments, not rows of spawned obstacles.**
9. **The engine-neutral core owns gameplay truth.** Unity renders and edits data; it does not decide legality, collision, rewards, or progression.
10. **No god director.** Clock, pace, gates, route planning, hazards, cargo, score, sector progression, garage settlement, and presentation remain separate systems.

---

## 3. The Complete Player Loop

### 3.1 Moment-to-moment loop

At any moment, the player is reading three things:

- the next speed gate;
- the best visible cargo line;
- the next hazard telegraph.

The recurring decision is:

> Stay on the gate line, deviate for cargo, or move early to survive the hazard pattern?

The player is not expected to collect everything. Good play is choosing which value is worth breaking the cleanest route.

### 3.2 Thirty-second rhythm

An ordinary thirty-second passage should contain:

1. six to ten common green gates;
2. one special surge gate;
3. two to four short cargo trails;
4. one authored hazard pattern;
5. one recovery window;
6. occasional scenery or one isolated fat cone.

The screen should not contain all of these simultaneously. The composer staggers attention:

```text
gate rhythm
    -> cargo temptation
    -> hazard commitment
    -> recovery gates
    -> special surge
    -> payoff
```

### 3.3 Sector loop

A sector lasts approximately 45–60 seconds, but is authored primarily in distance and gate count so it remains spatially coherent at different speeds.

Each sector contains:

1. **Re-entry beat:** broad, readable gates after launch or previous extraction opportunity.
2. **Acceleration beat:** dense common gates and the first surge gate.
3. **Risk beat:** cargo lines intertwined with a lightning or asteroid pattern.
4. **Hero beat:** canyon, tunnel, dense laser formation, or major authored structure.
5. **Recovery beat:** open water, broad gates, readable cargo.
6. **Extraction breather:** active threats clear, score/distance pause, and `EXTRACT? YES / NO` appears.

### 3.4 Run loop

1. Launch from the garage with the currently installed ship capability.
2. Begin below normal cruise speed.
3. Build speed through repeated gates.
4. Collect unsecured cargo.
5. Survive increasingly complex sectors.
6. Extract and bank cargo, or continue with current speed into higher Heat.
7. On destruction, lose unsecured cargo and apply bounded ship damage.
8. Return to the garage to repair, install upgrades, equip cosmetics/add-ons, and launch again.

---

## 4. Speed-Gate System

## 4.1 Gate types

### Common speed gate

- Presentation: simple thick glowing green band with an open center.
- Frequency: very common.
- Primary reward: small permanent-for-this-run speed increase.
- Secondary reward: gate score and gate-streak continuation.
- It should not be a wall and should not obscure the environment.

### Surge gate

- Presentation: cyan-white initially; later themes may use gold or other strong colors.
- Frequency: approximately one after every 7–12 common gates.
- Primary reward: meaningful speed increase.
- Secondary reward: larger score event and stronger presentation response.
- Placement: slightly riskier or more committed than a common gate, but always capability-valid.

### Environment-transition gate

- Presentation: unique gate matching the destination:
  - prismatic for the multicolored tunnel;
  - amber/crimson or stone-framed for the knife canyon;
  - other future environment-specific treatments.
- Primary reward: a surge increase plus transition into a prebuilt environment.
- It must be deliberately selected by the encounter composer, never produced by a generic random roll.

### Extraction breather

- The sector endpoint is not presented as another world-space gate.
- Active threats and pickups clear into a calm open-water cruise.
- Score, eligible run time, distance, power-up timers, and control pause while the visual scene continues moving.
- Unity shows only `EXTRACT?`, `YES`, and `NO` in the existing HUD style.
- `YES` banks cargo and ends the run successfully.
- `NO` immediately raises Heat, cargo value, encounter intensity, and the speed soft cap, then starts the next sector with a surge gate.
- There is no countdown and no automatic choice in the first implementation.

## 4.2 Recommended speed curve

Use additive world-speed increments, not multiplicative compounding.

Initial tuning target:

| Pace region | Common gate | Surge gate |
|---|---:|---:|
| Below 90 u/s | +1.0 u/s | +6.0 u/s |
| 90–120 u/s | +0.65 u/s | +4.0 u/s |
| Above 120 u/s | +0.35 u/s | +2.5 u/s |

Recommended Heat soft caps:

| Heat | Soft cap |
|---:|---:|
| 0 | 90 u/s |
| 1 | 112 u/s |
| 2 | 132 u/s |
| 3 | 150 u/s |
| 4 | 165 u/s |
| 5 | 180 u/s |

Crossing a gate above the current soft cap still awards score/streak progress, but speed gain is heavily diminished. Continuing into the next Heat sector raises the cap immediately.

The current Unity minimum of 50 u/s and forced `5/3` start multiplier should be replaced by a launch-profile-derived start value. Initial target range:

- damaged starter: approximately 36–40 u/s;
- restored starter: approximately 42–48 u/s;
- upgraded late ship: approximately 52–62 u/s.

Even a late ship starts below its sector potential so every run retains the acceleration fantasy.

## 4.3 Gate cadence and layout

Gate cadence is defined in target reaction seconds and converted to distance:

```text
gate spacing distance = projected speed at prior gate × target cadence seconds
```

Initial cadence:

- first three gates: 0.55–0.70 seconds apart;
- normal common sequence: 0.70–1.05 seconds apart;
- post-hazard recovery: 0.55–0.80 seconds apart;
- surge telegraph: visible at least 2.0 seconds before crossing.

The first gate is directly ahead and reached within roughly two seconds of gaining control.

The route planner always holds 8–12 future gates in its plan so Unity can display the route naturally into the distance. Gates are pooled visually, but their route positions exist before entering the visible range.

## 4.4 Gate route grammar

The hidden gate path is generated before hazards:

1. establish a broad centerline;
2. sample gate centers along that line;
3. constrain lateral displacement by the ship capability and projected speed;
4. reserve recovery gates after strong reversals;
5. mark specific nodes as common, surge, transition, or extraction;
6. validate the route;
7. place cargo and hazards around the validated route.

Early gates stay broad and close to center. Later patterns may use:

- lazy left/right waves;
- two-step reversals;
- off-center surge commitments;
- cargo forks that rejoin the gate line;
- pre-canyon convergence;
- prismatic transition alignment.

Missing a common or surge gate:

- does not remove already-earned speed;
- awards no speed increase;
- breaks the gate streak;
- delays laser readiness if gate charge is later enabled;
- does not cause immediate death.

Missing an environment-transition gate cancels that environment entry and routes the player into a safe fallback parcel. The composer may offer the environment again later.

---

## 5. Cargo and Economy During a Run

## 5.1 Cargo roles

Use the already implemented cargo types:

| Cargo | Weight | Base credits | Intended route |
|---|---:|---:|---|
| Salvage | 1 | 35 | safe/common lines |
| Alloy | 3 | 125 | committed hazard lines |
| Prism | 6 | 360 | deep Heat, tunnel, canyon, or hero encounters |

Cargo remains unsecured until extraction.

## 5.2 Cargo trail shapes

Cargo is never sprayed randomly. It appears as short readable routes:

- **safe line:** 3–5 pieces near the gate centerline;
- **offset lure:** 4–7 pieces pulling away from the next common gate;
- **cross-field line:** cargo passing between lightning targets;
- **late-return arc:** cargo deviates and curves back toward the next gate;
- **inside-curve line:** placed on the tighter inside of a canyon/tunnel turn;
- **knife reward line:** cargo immediately after a successful roll opening;
- **destruction burst:** cargo released from laser-destroyed formations.

The player should see where the cargo line ends before committing.

## 5.3 Reward scaling

The existing Heat reward multiplier remains the primary cargo-value multiplier:

```text
reward multiplier = 1 + Heat × 0.30
```

Gate speed does not directly multiply cargo value. Speed already increases collection difficulty, score rate, and access to deeper sectors. This avoids stacking opaque multipliers.

Gate streak may award a small extraction bonus later, but it should not be required for the first proof.

## 5.4 Cargo capacity

- Cargo capacity is weight-based and derived from the equipped cargo bay.
- Full capacity does not stop cargo from appearing; pickups that cannot fit visibly deflect or display “FULL.”
- Alloy and Prism create real capacity decisions because they consume more weight.
- The player may extract early because the hold is valuable or nearly full.

---

## 6. Sector and Heat Progression

Heat is the in-run depth level. It changes encounter eligibility, reward mix, soft speed cap, and presentation intensity. It does not independently multiply speed every frame.

### Sector 0 — Ignition Run

Approximate time: 0–50 seconds.

- start slow;
- dense broad green gates;
- one or two surge gates;
- mostly Salvage, rare Alloy;
- sparse random lightning;
- one isolated fat cone as scale/scenery;
- first extraction opportunity.

Purpose: teach gate, cargo, lightning, and extraction with no text-heavy tutorial.

### Sector 1 — Stormline

Approximate run time: 50–110 seconds.

- more lateral gate weaving;
- lightning Random, Sweep, and light Stagger beats;
- cross-field cargo lines;
- first laser formation opportunity;
- increased Alloy;
- second extraction opportunity.

### Sector 2 — Falling Sky

Approximate run time: 110–175 seconds.

- asteroid Random, Sweep, and Stagger patterns;
- lightning and asteroids alternate rather than independently overlap;
- occasional mixed pattern only after route validation;
- first Prism chance;
- canyon becomes eligible;
- third extraction opportunity.

### Sector 3 — Knife Coast

Approximate run time: 175–240 seconds.

- open-water convergence toward the canyon mouth;
- environment-transition gate;
- L3 knife-edge canyon hero encounter;
- sparse lightning only in broad canyon spaces;
- no asteroids inside the canonical knife canyon;
- high-value cargo after knife openings;
- extraction on canyon exit.

### Sector 4 — Prism Drive

Approximate run time: 240–305 seconds.

- prismatic transition gate;
- fully continuous multicolored sine corridor;
- internal gate ribs, inside-curve cargo, and one knife-edge requirement;
- higher speed cap and Prism rewards;
- extraction after tunnel breakup.

### Sector 5+ — Endless authored composition

Use a weighted non-repeating bag of eligible encounter blueprints:

- open-water lightning;
- asteroid storm;
- mixed storm;
- monumental gate weave;
- sparse fat-cone field;
- L3 knife canyon variants;
- prismatic L4/L5 variants;
- future combat/destruction encounters.

Rules:

- never repeat the same family consecutively;
- never run two enclosed environments consecutively;
- always place a recovery parcel after a hero encounter;
- ensure an extraction opportunity at least every 50–70 seconds;
- increase rewards and pattern density, not merely raw speed.

---

## 7. Wave and Encounter Generator

## 7.1 Replace disconnected spawning

The legacy `StageDirector` and `TickWorldSpawner` select modes and then spawn individual hazard waves. The target architecture uses complete encounter parcels.

```text
SectorDirector
    -> EncounterSelector
    -> GateRoutePlanner
    -> CargoRoutePlanner
    -> HazardPatternScheduler
    -> CapabilityValidator
    -> EncounterRuntime
    -> immutable snapshots/events
```

Each class has one responsibility.

## 7.2 Encounter blueprint

An engine-neutral encounter blueprint declares:

```text
EncounterBlueprint
- id and family
- allowed Heat range
- entry and exit speed bands
- duration/distance range
- common gate cadence
- surge gate positions
- environment transition, if any
- route-shape constraints
- cargo route templates
- hazard pattern beats
- recovery distance
- extraction eligibility
- presentation identifiers
```

## 7.3 Generation order

1. Select an eligible blueprint using Heat, recent history, ship capability, cargo state, and current speed.
2. Generate the gate route.
3. Simulate reachability across the entire route.
4. Generate cargo routes branching from and returning to the gate route.
5. Schedule hazard patterns around both route families.
6. Build actual collision volumes.
7. Run final geometry validation.
8. Reject and regenerate if:
   - no valid player policy survives;
   - neutral input clears the whole encounter;
   - permanent left or permanent right clears it;
   - a required reversal exceeds capability;
   - hazard telegraphs overlap a required gate reaction;
   - cargo creates an impossible return;
   - different obstacle systems close the same opening.
9. Publish the accepted plan to runtime and presentation.

## 7.4 Pattern scheduling rules

- One pattern owns a time/distance window.
- Another hazard family cannot independently inject into that window.
- Mixed encounters explicitly coordinate both families in one blueprint.
- Every strong pattern has an entry telegraph and an exit recovery.
- Pattern difficulty changes through spacing, count, route offset, and recovery—not by removing warnings.

---

## 8. Lightning Pattern Catalog

Port the source Three.js choreography into deterministic engine-neutral definitions. Keep the source visual/timing identity, but let the encounter blueprint choose when the pattern is safe.

Source visual baseline:

- warning: 0.3 seconds;
- primary frequency: 0.3 seconds at full intensity;
- strike flash: 0.5 seconds;
- planted linger: 4.0 seconds;
- lane range: -8 to +8;
- predictive lead: 0.6 normally;
- every declared “punisher” strike may use lead 1.0;
- bolt geometry: 0.12 core, 0.25 glow, 10 source segments, jaggedness 1.9.

### Random

- One or a small count of strikes around live ship X.
- Source scatter: approximately ±1.5 units.
- Use for early readable pressure and cargo threading.

### Sweep

- Three sequential strikes.
- Strike delay: 0.25 seconds.
- The group sweeps laterally across half the lane range.
- Gate route should cross behind the sweep, not require an impossible reversal through it.

### Stagger

- Each strike reads live ship X at fire time.
- Strong anti-camping pressure.
- Cargo should form a moving diagonal or alternating route, encouraging deliberate movement rather than panic.

### Salvo

- Three simultaneous strikes spread across approximately 90% of the lane range.
- The route planner reserves one or more explicit gaps.
- Never combine with an uncoordinated cone row.

### Pinch

- Five left/right pairs close toward a snapshotted ship position.
- Pair interval: 0.30 seconds.
- Final center strike follows after the arms close.
- The safe solution is a committed departure followed by a planned return gate.

### Lightning cadence by Heat

Use pattern clusters, not continuous global spam:

| Heat | Cluster frequency | Pattern availability |
|---:|---:|---|
| 0 | 0.70–0.90 s | Random |
| 1 | 0.50–0.70 s | Random, Sweep, Stagger |
| 2 | 0.40–0.55 s | + Salvo |
| 3+ | 0.30–0.45 s | + Pinch and explicit mixed patterns |

The user-approved 0.3-second source frequency remains the high-intensity target, not the universal opening frequency.

---

## 9. Asteroid Pattern Catalog

The source asteroid pool is currently disabled, but its programmed pattern and trajectory logic are valuable reference behavior and should be ported into Unity as an engine-neutral hazard family plus a pooled Unity presenter.

Source baseline:

- radius: 1.2 ± 0.4;
- spawn height: 42;
- fall speed: 162;
- warning duration: approximately 1.8 seconds;
- kill radius: 2.2 × asteroid radius;
- lane range: -8 to +8;
- full predictive lead available;
- flaming rock, fire shell, tail, warning disc, water impact, and shockwave.

### Random

- Four shots scattered around the ship.
- Sequential spacing: 0.35 seconds.
- Every delayed target reads current ship position in the source pattern.
- Use cargo to indicate a deliberate escape line.

### Sweep

- Five shots.
- Sequential spacing: 0.20 seconds.
- Pattern origin sweeps laterally.
- Gates should arc behind the falling line.

### Stagger

- Default five impacts at one snapshotted X column.
- Gap: 0.80 seconds in the source.
- Optional dual mode adds a predicted companion impact.
- Use as a “leave this lane now” pattern, never as general random noise.

### Salvo

- Five simultaneous falling bodies across the lane range.
- Final layout must reserve validated gaps.
- Best paired with a broad gate visible through the safe opening.

### Pinch

- Five closing left/right pairs at 0.30-second intervals.
- Final center impact.
- Use later than lightning Pinch because asteroid warnings occupy more visual space.

### Chase

- Three-shot burst:
  - mirrored predicted target;
  - left flank after 0.28 seconds;
  - right flank after 0.56 seconds.
- Source interval ramps from 4.0 to 1.2 seconds across 90 seconds.
- In the new loop, bind this ramp to encounter progress/Heat rather than a free global wall clock.

### Decorative fillers

Optional background asteroids:

- have no collision;
- land safely ahead of the ship;
- use smaller scale and wider lateral range;
- are presentation-only and must never resemble active hazards without clear differentiation.

---

## 10. Fat Cones and Other Simple Structures

Cones remain useful as occasional readable landmarks, not the primary world.

Use a fat cone:

- outside the required opening as scale;
- as one side of a cargo fork;
- as a laser-destructible cargo container/formation anchor;
- as a distant silhouette;
- at most once per major passage unless the encounter is explicitly a cone field.

Never allow a fat cone to overlap an independently selected lightning/asteroid opening. It is placed by the same encounter geometry pass.

Generic cone rows should be retired from the main loop once sufficient authored blueprints exist.

---

## 11. Canyon Integration

## 11.1 Canyon role

The canyon is a hero environment and pacing change:

```text
open water
    -> isolated rock formations
    -> converging walls
    -> threshold arch / transition gate
    -> continuous enclosed canyon
    -> natural hazards and knife openings
    -> breakup
    -> open water recovery
```

The canyon is built as a complete world-space route before approach. It is not created slab-by-slab at the visible leading edge.

## 11.2 Canyon entry

1. The encounter composer selects a canyon blueprint.
2. Unity prebuilds or activates the complete canyon outside visible range.
3. Open-water rock formations begin framing the gate route.
4. Common gates converge toward the canyon mouth.
5. A special transition/surge gate sits inside the threshold arch.
6. Crossing the gate:
   - awards its speed surge;
   - locks the canyon encounter active in the core;
   - starts canyon lighting/audio;
   - activates canyon collision after a short entry buffer.

If the player misses the transition gate, the canyon route is not activated and the open-water fallback remains valid.

## 11.3 Canonical L3 knife-edge canyon

Preserve the source identity as a canonical high-value blueprint:

- nominal duration: 40 seconds;
- source reference speed target: 2.2 × `BASE_SPEED`;
- entry speed blend: approximately 0.4 seconds after crossing the mouth;
- final scroll-out window: 4 seconds;
- source wall geometry:
  - height 55;
  - thickness 60;
  - 5 columns × 6 rows;
  - displacement 2;
  - snap oscillation 0.1–1.5 over a 4-second period;
  - foot/sweep/mid/crest profile 26 / 20 / 0 / 0;
  - half-width reference approximately 21.5;
  - sine amplitude reference 120;
  - sine period reference 330.

The new system does not let the canyon override the global speed formula. Instead:

- its transition gate raises speed toward the encounter’s minimum entry band;
- the encounter contract declares its legal speed range;
- current speed is preserved if already legal;
- the validator rejects the canyon if the equipped ship cannot follow it.

Gameplay inside:

- long readable bends;
- rock fins and natural bridges;
- two or three knife-edge apertures requiring the existing roll mechanic;
- cargo immediately after successful apertures;
- sparse lightning only in broad sections;
- no asteroids in the canonical L3 knife encounter;
- no unrelated cone waves.

## 11.4 Canyon variants

Later variants may adjust:

- route curvature;
- aperture placement;
- wall clearance;
- cargo branches;
- sparse lightning family;
- surface palette;
- length.

They may not alter the canonical L3 profile silently. L3 remains a fixed reference used by parity tests.

---

## 12. Multicolored Prismatic Corridor

## 12.1 Gameplay role

The prismatic corridor is a transformation payoff earned through a special speed gate. It should feel like the open-water game suddenly folds into a luminous tunnel.

It uses a continuous force-field membrane, not cone rows.

## 12.2 Correct transition

The current presenter enables and positions the complete mesh when the encounter is merely upcoming/current. That still exposes an awkward leading edge and does not provide a gate-crossing transition state.

Replace the lifecycle with:

```text
DormantPrebuilt
    -> ApproachingTransitionGate
    -> GateCrossedReveal
    -> ActiveTunnel
    -> ExitBreakup
    -> Retired
```

### DormantPrebuilt

- Build the complete tunnel mesh when the encounter is selected.
- Include the complete forward route plus at least 150 units behind the future camera position.
- Place the mouth beyond normal visible range.
- Do not stream individual visual slices.

### ApproachingTransitionGate

- Display the prismatic transition gate at the tunnel mouth.
- The tunnel exists behind it.
- The gate’s emission, fog, and portal surface hide the tunnel seam.
- The player can see color and motion through the gate without seeing geometry pop into existence.

### GateCrossedReveal

On core-confirmed gate crossing:

- award the surge speed;
- run a 0.35–0.65 second reveal wave from the gate plane around the ship;
- bloom the tunnel ribs and water reflection;
- transition ambience/audio;
- activate tunnel collision only after the ship is clearly inside.

### ActiveTunnel

- The complete mesh moves as one world object in the Z-scroll model.
- The player never sees cross-sections spawning ahead.
- Rear geometry persists far enough behind the camera that despawning is invisible.
- Internal green/spectrum ribs can serve as speed gates.
- Cargo uses inside curves and optional deeper lines.
- The core and renderer consume the same center/half-width samples.

### ExitBreakup

- Corridor widens over authored exit samples.
- Membrane fragments/fades outward into open water.
- Geometry retires only once the entire rear extension is safely behind the camera.

## 12.3 Shape

Use the existing L4/L5 source definitions as canonical references:

### L4 reference

- close rows 35;
- straight rows 10;
- total rows 518;
- exit rows 20;
- wide half-width 80;
- narrow half-width 6;
- squeezed half-width 4.5;
- amplitude 14 → 44;
- period 220 → 160;
- knife window at curve rows 370–395, dipping toward half-width 3.

### L5 reference

- close rows 29;
- straight rows 12;
- total rows 420;
- exit rows 20;
- wide half-width 64;
- narrow half-width 10;
- squeezed half-width 8;
- amplitude 10 → 40;
- period 200 → 140;
- center hazard reference every 12 rows.

For the first new loop, use an L4-shaped continuous membrane but remove the legacy center-cone logic. Replace it with authored cargo, internal gates, and one deliberate knife-edge aperture.

---

## 13. Laser Role

The laser is a periodic power fantasy, not the constant core input.

Recommended first implementation:

- common gates contribute one small charge unit;
- surge gates contribute several charge units;
- missing a gate breaks charge streak progress but does not erase all stored charge;
- when ready, the next encounter blueprint schedules a dense destructible formation;
- activating the laser destroys the formation and releases a large cargo burst.

The laser formation is never mixed with an unavoidable lightning strike at the same depth.

Persistent laser upgrades improve:

- duration;
- width;
- destruction radius;
- charge retention after a missed gate;
- cargo magnetism during the destruction burst.

---

## 14. Internal Gameplay Clock

Retain and finish the existing multi-domain clock architecture.

### Host frame time

- Unity-only unscaled frame delta;
- clamped to 50 ms;
- feeds one fixed-step accumulator;
- accumulator is cleared on pause/resume;
- never used directly for score or encounter rules.

### Simulation tick

- authoritative 60 Hz deterministic tick;
- engine-neutral `long`;
- advances only during accepted gameplay simulation;
- all gameplay timers derive from ticks or deterministic progress.

### Eligible run tick

- advances only while the player has active, score-eligible control;
- excludes title, pause, launch presentation, extraction results, garage, and debug suspension;
- becomes the official gameplay duration in `RunResult`.

### Distance coordinate

- authoritative coordinate for gates, cargo, hazards, environments, and extraction;
- advances by effective speed per fixed tick;
- encounter geometry is defined in distance, not frame count.

### Encounter-local progress

- belongs to the active encounter runtime;
- may be distance-based or tick-based;
- cannot be a second global clock;
- corridor/canyon transition states use explicit progress.

### Gameplay presentation time

- derived from accepted simulation ticks;
- drives water, gameplay stars, thrusters, shield, gate pulses, lightning, asteroid animation, and gameplay camera effects;
- freezes with gameplay pause.

### UI presentation time

- Unity unscaled presentation clock;
- used only for menus, death results, pause animation, and garage UI;
- never feeds gameplay.

### UTC wall clock

- used only for repair jobs, daily seeds, analytics timestamps, and persistence;
- never used for run movement or score.

---

## 15. Score and External High Score

## 15.1 One canonical run score

Keep one core-owned score for:

- HUD;
- final result;
- local high score;
- online leaderboard.

Do not recreate the source’s internal-score/player-score split.

## 15.2 Score sources

Initial score model:

```text
distance score
    + common gate score
    + surge gate score
    + cargo pickup skill score
    + near-miss score
    + encounter completion bonus
    + Heat/depth bonus
```

Recommended starting values:

| Event | Score |
|---|---:|
| Common gate | 100 |
| Surge gate | 600 |
| Transition gate | 1,000 |
| Salvage pickup | 20 |
| Alloy pickup | 80 |
| Prism pickup | 250 |
| Near miss | 25 |
| Hero encounter completion | 1,500–4,000 |

Distance score continues accumulating in fixed-point units and scales modestly with effective speed.

Gate streak can add a capped skill modifier:

```text
gate event score multiplier = 1 + min(streak, 20) × 0.025
```

This affects gate score only, not cargo economy value.

## 15.3 Finalization

Extraction and destruction both finalize one immutable `RunResult`.

Run result includes:

- run ID;
- seed/mode;
- raw and final score;
- distance;
- highest Heat;
- gates hit/missed;
- longest streak;
- cargo collected;
- cargo banked or lost;
- hero encounters completed;
- simulation ticks;
- eligible run ticks;
- repair/debug/god-mode eligibility flags;
- completion reason.

Finalization is idempotent.

## 15.4 Local and external high score

Retain the existing:

- invariant `long` local high score;
- run-ID-deduplicated leaderboard outbox;
- leaderboard eligibility flags;
- `RunCompletionService`.

Initial leaderboards:

1. all-time score;
2. daily seeded score.

Secondary stats such as deepest Heat, longest gate streak, and most cargo in one extraction may be displayed locally before becoming separate leaderboards.

Death may still submit an eligible score even though cargo is lost. This cleanly separates:

- **skill/high-score success:** how well the player flew;
- **economy success:** what the player safely extracted.

---

## 16. Persistent Meta and Garage

## 16.1 First four successful extractions

Keep the implemented onboarding distinction between repair and upgrade:

1. extraction 1: free primary-thruster repair, restoring integrity and equipping LIGHT;
2. extraction 2: free stabilizer repair and fins;
3. extraction 3: explicit starter hull upgrade;
4. extraction 4: choose shield generator or cargo-bay upgrade.

Repair restores integrity. It never silently raises tier. Purchased upgrades raise capability.

## 16.2 Economy roles

- **Credits:** general upgrade purchasing.
- **Salvage:** repairs, common garage construction, basic items.
- **Alloy:** structural upgrades, repair-bay improvements, advanced ship components.
- **Prism:** high-tier powerups, rare skins/add-ons, exceptional upgrades.

## 16.3 Upgrade categories

### Engine

- increases starting speed;
- increases gate acceleration response;
- raises reachable late-run speed;
- improves damaged-engine floor.

### Stabilizers

- lateral acceleration;
- maximum lateral velocity;
- countersteering;
- neutral settling;
- bank recovery.

### Cargo bay

- weight capacity;
- later add-ons may improve pickup radius or protect one cargo slot.

### Hull

- collision capacity;
- damage resistance;
- reduced subsystem damage on failed runs.

### Shield

- hit capacity;
- duration/availability;
- recharge or consumable behavior, depending final powerup model.

### Laser

- duration, width, destruction radius, charge retention.

### Magnet

- pickup radius;
- post-destruction cargo collection;
- later automatic recovery of lightweight Salvage.

### Overdrive

- temporary speed and invulnerability behavior;
- must be included in encounter validation;
- cannot become a second permanent speed authority.

## 16.4 Damage and repairs

- Failed runs lose unsecured cargo.
- Apply bounded damage to hull, engine, and stabilizers.
- Early repair durations remain extremely short.
- Later upgraded systems take longer and consume more material.
- Repair bay controls simultaneous jobs.
- Mechanic bots reduce duration.
- A fallback/field-patch path must prevent a failure spiral.

## 16.5 Monetization-compatible seams

Do not design the fun around payments. Safe seams:

- ship skins;
- thruster styles;
- trails and gate-crossing effects;
- garage presentation themes;
- optional repair acceleration;
- optional cargo insurance/recovery token;
- rewarded revive, if later testing supports it.

Core speed-gate power, encounter legality, and leaderboard integrity must not be purchasable advantages in competitive modes without clear separation.

---

## 17. Architecture Boundaries

## 17.1 Engine-neutral core

Owns:

- fixed clock domains;
- `RunPaceModel`;
- gate route and gate crossing;
- gate-derived speed state;
- sector/Heat progression;
- encounter selection;
- route and hazard plans;
- lightning and asteroid pattern timing;
- cargo ledger and collection;
- extraction legality;
- collisions;
- score;
- immutable run result;
- capability validation.

Recommended separate classes:

- `GateProgressionModel`;
- `GateRoutePlanner`;
- `SectorDirector`;
- `EncounterSelector`;
- `HazardPatternCatalog`;
- `HazardPatternScheduler`;
- `CargoRoutePlanner`;
- existing `EncounterCapabilityValidator`;
- `RunScoreModel`;
- existing `RunPaceModel`;
- existing `RunResult`.

## 17.2 Application layer

Owns:

- loading the garage state;
- creating the launch profile;
- starting/ending a run use case;
- settling extraction;
- applying failed-run damage;
- saving progression;
- high-score and leaderboard publication;
- wall-clock and commerce ports.

The orchestrator invokes domain operations. It owns no gate values, speed curves, upgrade costs, hazard formulas, or reward formulas.

## 17.3 Unity

Owns:

- input adaptation;
- gate, cargo, lightning, asteroid, cone, canyon, tunnel, extraction, and laser presentation;
- pooling;
- materials, water reflection, lighting, audio, haptics, camera, and LOD;
- full-environment construction;
- editor tools and route visualization;
- authoring assets that compile into validated engine-neutral definitions.

Unity presenters never choose the route, award speed, change cargo, or decide collision.

## 17.4 Composition root

`GameManager`:

- creates systems;
- forwards fixed-step input/world facts;
- dispatches snapshots/events;
- coordinates lifecycle calls.

---

## 18. Implemented Production Checkpoint — July 16, 2026

The first production architecture is now live in the Unity project:

- `GateProgressionModel` owns additive common/surge/transition speed gains and Heat caps.
- `GateRoutePlanner` preplans 42-gate sectors and validates them against the equipped ship capability.
- `SectorDirector` owns only sector/Heat advancement.
- `SectorRunRuntime` coordinates the focused route, progression, cargo, hazard, extraction, and transition collaborators.
- `RunScoreModel` owns gate, cargo, and hero-environment skill-score values.
- `AsteroidSequenceRuntime` ports Random, Sweep, Stagger, Salvo, Pinch, and Chase intentions.
- Source-parity lightning sequence scheduling remains in `LightningSequenceRuntime`.
- Cargo trails, laser pickup/formation beats, isolated fat cones, lightning windows, and asteroid windows are emitted as coordinated parcel commands.
- Cargo routes now approach their linked gate instead of spawning behind it:
  - Salvage makes a readable detour and returns to gate center.
  - Alloy demands a wider line and returns near the gate edge.
  - Prism commits beyond the easy gate aperture, creating an explicit reward-versus-speed choice.
- The first laser payoff uses a dense three-row destructible formation with exact dual-lane targets and a separately validated side bypass, so the encounter remains survivable without the pickup while staying below the mobile hazard/event budget.
- Runner laser content is source-locked to the production Three.js tuning: two lanes at `±0.35`, `+0.45` Y, `-2.50` Z in the reference world pose, 10-unit core length, 7.5-unit glow length, and 8.5 Hz fire rate.
- Unity converts those reference offsets into model-child muzzle sockets and adds pooled impact plasma, trails, shock rings, light flashes, positional audio, and cargo collection pull-in without moving gameplay authority out of the core.
- Formation targets carry an explicit engine-neutral gameplay role. Ordinary fat cones cannot accidentally award laser rewards.
- Rapid kills build a core-owned destruction chain. Every third destruction releases milestone cargo; the sixth target upgrades that milestone to Alloy.
- Ten destroyed targets overload the formation, remove the remaining formation geometry, award a score burst, and release two Alloy pods plus a central Prism pod.
- All six potential reward pods fit inside the starter 18-weight cargo bay. Their burst velocity, attraction delay, homing movement, collection, capacity rejection, and economy value are deterministic core rules; Unity only presents the burst and pull-in.
- Extraction is a core-owned spatial crossing. Missing it starts the next Heat sector without resetting earned run speed.
- Canyon and prismatic routes activate only after their transition gate is crossed.
- Their complete Unity environments are prebuilt and moved as single world constructs; collision comes from the same core-authored route samples.
- `RunResult` now records seed/mode, gate hit/miss totals, longest streak, sector/Heat, cargo banked/lost, hero completions, clocks, and completion reason.
- Unity now has pooled snapshot-only speed-gate and asteroid presenters.
- Core-confirmed gate crossings now feed a presentation-only speed-feedback envelope:
  - common, surge, transition, and extraction strengths;
  - layered FOV/pullback/height/look-ahead camera response;
  - gate afterimage and water pulse;
  - thruster and wake bursts;
  - calibrated 36–160 u/s sustained speed perception;
  - restrained sky streaks plus a one-draw-call near-water motion field;
  - gate-specific audio and native iOS haptics.
- The Control Room includes a Gameplay page showing live core facts and safe playtest controls.

Legacy `StageDirector`, proof encounters, and legacy spawners remain available for regression/reference, but the normal Unity run now starts in `GateRunMode`; they do not choose production gates, pace, hazards, or extraction.

It must not absorb gate progression, encounter generation, score rules, or garage settlement.

---

## 18. Validation and Tests

### Determinism

- same seed, launch profile, and inputs produce identical gate, cargo, hazard, and result snapshots;
- pause/resume cannot alter encounter output;
- presentation framerate cannot alter gameplay.

### Gate progression

- every accepted gate applies exactly one speed award;
- missing a gate applies none;
- soft caps and diminishing gains are deterministic;
- no independent stage/Heat system overwrites gate speed;
- transition gates activate environments only on confirmed crossing.

### Route legality

- every gate sequence is reachable;
- every cargo departure has a reachable return;
- neutral/left/right trivial policies are rejected where intended;
- no impossible reversal;
- no cone/lightning/asteroid combination closes the validated route.

### Hazard parity

- deterministic tests for Lightning Random, Sweep, Stagger, Salvo, and Pinch;
- deterministic tests for Asteroid Random, Sweep, Stagger, Salvo, Pinch, and Chase;
- warning and impact timing parity;
- source reference values remain documented and testable.

### Canyon

- complete canyon exists before visible approach;
- L3 reference path remains capability-valid at its declared speed;
- knife-edge requirements use the same roll state as collision;
- no asteroid injection during canonical L3;
- exit geometry remains behind camera until invisible.

### Prismatic tunnel

- complete mesh exists before transition gate crossing;
- no visible leading-edge spawning;
- reveal begins only after core gate-cross event;
- visual cross-sections and collision use the same core samples;
- rear geometry cannot despawn in camera view;
- missing transition gate leaves a valid fallback route.

### Cargo/meta

- cargo remains run-local before extraction;
- successful extraction banks exactly once;
- destruction loses cargo and applies damage exactly once;
- capacity and weighted cargo are deterministic;
- starter repair/upgrade milestones remain distinct;
- repair timers use UTC only.

### Score/high score

- one canonical score;
- finalization is idempotent;
- extraction and death produce valid results;
- god/debug/repair eligibility flags work;
- leaderboard outbox rejects duplicate run IDs;
- daily seed and all-time score consume the same finalized score.

---

## 19. Implementation Order

### Phase 1 — Gate-led proof loop

1. Add engine-neutral gate definitions and `GateProgressionModel`.
2. Replace forced high starting speed with launch-profile starting speed.
3. Add common green and cyan surge gate presenters.
4. Add deterministic gate route planner.
5. Add cargo trails around the route.
6. Add optional extraction after one 50-second sector.

Playable result:

> Start slow, hit many gates, collect cargo, dodge sparse lightning, extract or continue.

### Phase 2 — Authored hazards

1. Integrate source lightning sequence catalog into encounter blueprints.
2. Port asteroid hazard/runtime and Unity pooled presenter.
3. Add asteroid pattern catalog.
4. Add sparse fat-cone landmark placement.
5. Add full capability and trivial-route validation.

### Phase 3 — Hero environments

1. Convert canyon selection to a gate-triggered environment state.
2. Lock canonical L3 knife reference and tests.
3. Add canyon cargo/knife openings.
4. Replace prismatic presenter activation with the transition lifecycle.
5. Add gate-cross reveal and invisible retirement.

### Phase 4 — Score and meta completion

1. Add gate/cargo/encounter score sources to the canonical score model.
2. Extend `RunResult` with Heat/gate/cargo statistics.
3. Complete extraction/death settlement.
4. Wire garage UI to the existing domain.
5. Add daily seed leaderboard adapter and outbox drain.

### Phase 5 — Tuning and content

1. Tune gate cadence and speed gain.
2. Tune lightning/asteroid pattern frequency by Heat.
3. Tune cargo route value.
4. Tune canyon/tunnel entry and exit.
5. Add more validated blueprints.
6. Add cosmetics, audio polish, haptics, and monetization seams.

---

## 20. First Playable Target

The first build that should be judged contains:

- slow launch;
- common green gates every roughly 0.7–1.0 seconds;
- one cyan surge gate every 7–12 common gates;
- Salvage and occasional Alloy trails;
- Random and Sweep lightning;
- one sparse fat cone;
- one extraction opportunity at approximately 50 seconds;
- continue path into a second faster sector;
- one prismatic transition gate and fully prebuilt continuous tunnel;
- local final score and banked cargo result.

Do not add the full garage presentation, repair timers, every asteroid pattern, or every canyon variant before this loop is fun.

The proof succeeds if the player wants to:

1. hit one more green gate;
2. risk one more cargo line;
3. survive one more hazard pattern;
4. ignore extraction once because the current speed feels too good to surrender.
