# Jet Horizon — Cargo-First Wave Loop

**Status:** Proposed gameplay direction. No gameplay code is implied by this
document.

**Purpose:** Make the water / sun / ship / terrain fantasy into a simple mobile
game where the player actively chooses richer, harder collection lines while
flying through a coherent world. The economy is a consequence of good flight,
not a menu layered on top of an unrelated endless runner.

This direction replaces the *gate-first* emphasis in the older master loop as
the next design target. The useful architecture rules remain unchanged:

- the engine-neutral core owns collectible value, route legality, wave outcome,
  ship capability, and settlement;
- Unity owns the terrain, lightning, cargo visual, water reflection, audio,
  haptics, and all moment-to-moment presentation;
- an application/orchestrator layer only selects an eligible wave and connects
  core events to Unity presenters. It does not decide reward formulas or move
  pickups around after validation.

---

## 1. The game in one sentence

> Fly fast through a beautiful half-water, half-crystal world; read each wave,
> choose the richest route you can survive, collect recoverable materials, and
> turn those materials into a dramatically better ship.

The player should understand the first ten seconds without a tutorial card:

1. Terrain, lightning, and structures form a route through the world.
2. Things worth collecting sit on optional lines through that route.
3. Harder lines visibly contain better things.
4. Collected things improve the ship between runs.

The central question is not “can I follow this ring?” It is:

> “Do I take the clean route, or cut through that dangerous line for the thing
> I need?”

---

## 2. The moment-to-moment wave

Every wave is a short, authored-feeling navigation problem. It is not a pile of
objects in the centre of the screen.

```text
world breathes
    -> landmark announces a wave
    -> player sees 2–3 reachable collection lines
    -> one meaningful steering / roll / laser commitment
    -> collection payoff
    -> recovery space and the next landmark
```

### Wave contract

Every wave declares:

| Element | Core-owned rule | Unity-owned presentation |
|---|---|---|
| Entry | safe approach and viable opening | terrain silhouette, water, warning light |
| Routes | 1 safe line, 1 valuable line, optional hero line | visible cargo trails and environmental openings |
| Threat | capability-valid hazard geometry | lightning, terrain, destructibles, impact effects |
| Reward | definitions, quantities, rarity, collection legality | pickup identity, sound, magnet pull, burst |
| Exit | recovery distance and next eligible wave | open water, canyon exit, dissolving storm |

Rules:

- The safe route must always finish the wave.
- The valuable route must be visibly possible before the player commits.
- A valuable route may be difficult; it may never require impossible reversal
  or an unreactable turn at the current speed and handling tier.
- No wave can be solved forever by holding neutral, left, or right.
- No more than one new idea demands attention at once.

The aim is eight to fifteen seconds of clear play, followed by two to five
seconds of visual breathing room. A larger hero wave can run for twenty to
thirty seconds.

### World handoff: nothing pops in or vanishes beside the ship

A wave is a finite stretch of world, not a mode that toggles at the camera.
The run should have this physical rhythm:

```text
next landmark becomes visible on the horizon
    -> approach / entry silhouette
    -> full wave passes the player
    -> its final terrain, lightning, cargo, and debris recede behind the ship
    -> open-water breather
    -> next landmark begins its distant horizon reveal
```

Hard presentation rules:

- The entire next wave is built and validated **before** any part of its entry
  is visible. A horizon fade may reveal it; it may not conceal object creation.
- The first thing visible is an intentional distant silhouette: a formation,
  canyon mouth, storm front, wall with openings, or prismatic glow. It gives
  the player time to read the place they are entering.
- As the player finishes a wave, its contents continue naturally past and
  behind the camera. They are removed only beyond the rear cull distance, never
  at the ship or in peripheral vision.
- A breather is genuinely open water with only small incidental formations. It
  is a visual exhale, not an invisible system reset.
- A canyon / tunnel entry must be present as a complete route from its visible
  mouth onward. The player can see the far horizon only when there is a real
  line of sight through the terrain or at the exit.

This is the visual layer that makes a sequence of waves feel like one natural
run through a world. The core owns the order, distance, and handoff timing;
Unity keeps the already-built geometry alive long enough for the transition to
read correctly.

---

## 3. Collectibles: few visible families, many useful decisions

Do **not** show six currencies on the flight HUD. Start with three readable
families and let their garage uses create the depth.

| Family | In-run visual and placement | Garage purpose | Rarity |
|---|---|---|---|
| **Salvage cargo** | physical crate/pod trails, mostly safe or medium routes | repairs, basic upgrades, conversion to credits | common |
| **Power cells** | bright contained energy cores on dangerous lines | engine, handling, shield, laser and active-system upgrades | uncommon |
| **Prism relics** | unmistakable large crystalline cache in hero routes | rare upgrade prerequisites, new modules, cosmetic/sector unlocks | rare |

**Credits** are the shared spend currency, not necessarily a fourth object to
chase constantly. Salvage settles into credits plus repair material after a
completed run. Small direct-credit caches can exist later, but should be a
special reward beat rather than permanent visual noise.

This gives every pickup a simple sentence:

- Salvage: “More general progress.”
- Power cell: “This helps the system I care about.”
- Prism: “This is unusual; do not miss it.”

### Distribution rule

Rarity changes the *route*, not merely the number on the reward screen.

- Salvage trails teach and reward ordinary weaving.
- Power cells ask for a sharper cut through lightning, a roll aperture, or a
  late return from a side route.
- Prisms live in a memorable hero beat: a knife-edge canyon pocket, a laser
  destruction payoff, or the inside line of a spectacular tunnel.

The player must see the prize early enough to choose it, but not so early that
they can auto-pilot toward it.

---

## 4. The first collectible-driven wave library

These are the first four waves to make satisfying before adding more content.

### A. Open-water crystal slalom — salvage

Small and medium crystalline formations rise partially out of the water. They
form several broad paths, with a clean central route and short salvage arcs
threading the better-looking gaps.

- Teaches that terrain is the obstacle.
- No lightning or laser required.
- Reward is mostly salvage, with an occasional power cell at a clearly harder
  side cut.

### B. Lightning weave — power cells

Use the original GitHub lightning cadence: sweeping bolts and varied strike
patterns, not thin static barriers. Cargo draws the intended path through the
storm; it never exists as decoration.

- Safe route: modest salvage outside the hottest lanes.
- Valuable route: a power-cell trail that crosses between two timed strikes.
- The reward trail should naturally defeat permanent-left and permanent-right
  play. Do not make lightning itself over-constrict the route.

### C. Destroyable formation — burst payoff

A dense crystal/debris formation blocks the richer line. A laser pickup occurs
just beforehand, making activation obvious and satisfying.

- Without laser: take the safe bypass for salvage.
- With laser: the formation opens, visibly breaks apart, and ejects a compact
  spray of salvage plus a chance of a power cell.
- This is the early power fantasy. The player should feel that the laser turns
  an obstacle into an opportunity, not just a weapon animation.

### D. Knife-edge canyon / prismatic tunnel — prism chance

The world closes from open water into a clear opening, then becomes a real
continuous canyon or opaque prismatic corridor. It uses the L3-inspired sine
route and one deliberate roll aperture.

- Safe line: survivable with ordinary cargo.
- Inside/hero line: a clearly telegraphed prism cache after a roll or strong
  curve commitment.
- Exit returns to water and gives the player time to register what they got.

These four waves already use the best parts of the game: ship feel, water,
terrain, lightning, laser, L3-style movement, and spectacular corridors. They
can be ordered and varied without inventing random cones or constant gates.

---

## 5. Run progression and speed

The ship starts slower than a developed ship, but never slow enough to feel
broken. Early runs should immediately feel like flight; later investment should
make the same world feel thrillingly responsive.

### Within one run

- Pace climbs in deliberate steps after completed waves and hero beats.
- The step is announced by the world—an overcharge cell, wake surge, terrain
  opening, or other diegetic marker—not a nonstop line of rings.
- Higher pace increases arrival speed and visual sensation, while the composer
  selects wider routes, longer previews, and more recovery distance as needed.
- Collection value does not need a separate opaque speed multiplier. Faster
  play is already harder and reaches richer wave pools sooner.

### Across progression

- **Repairs** restore a damaged baseline. They are not purchases and must never
  be confused with upgrades.
- **Engine upgrades** raise sustained pace and the ability to keep a surge.
- **Stabilizer/handling upgrades** raise lateral acceleration, reversal control,
  and roll authority.
- **Cargo-bay upgrades** let the player capitalize on richer lines for longer.
- **Laser/shield/magnet upgrades** increase the value or reliability of a
  chosen play style.

Capability validation receives the equipped speed, lateral acceleration, roll
authority, and hull/shield state. It then chooses only waves whose safe and
reward routes are actually possible. Progression opens richer route options; it
must not make old content suddenly unfair.

---

## 6. Banking and risk: extraction is a rest decision, not the game

The primary game is collecting valuable things while flying through great waves.
Extraction is a secondary push-your-luck decision that only appears after that
core flight is already satisfying.

1. Every collected item enters an unsecured **run manifest**.
2. At selected genuine open-water rests, the player may **extract**: leave the
   run and bank the manifest.
3. Choosing to continue keeps the manifest, offers richer upcoming wave tables,
   and leaves all unsecured value at risk.
4. A crash before extraction loses the unsecured manifest; a completed
   extraction settles it into salvage, power cells, prisms, and credits.

The choice is never shown in a hazard, in a canyon, or immediately after an
object pops in. The player has cleared a wave, watched it recede behind them,
and reaches a real water breather before the option is available.

For the first playable wave proof, settlement may remain automatic at the end
of the short sequence so we can validate that the waves themselves are fun.
When added, extraction should be a single quiet rest-state choice with a small
manifest preview—not a pop-up that steals attention from the flight.

---

## 7. Economy and ethical monetization boundaries

The monetizable value is a desirable, visibly improving ship and a reason to
make one more run—not hidden power spikes or paid obstacle relief.

### Earned progression

- Salvage handles repair and general progress.
- Credits create a choice between speed, handling, cargo capacity, laser,
  shield, magnet, and garage improvements.
- Power cells and prisms are targeted rare requirements for stronger upgrades
  and unlocks.
- Every permanent performance purchase must create a tactile change in flight.

### Good monetization lanes

- ship skins, thruster colors/trails, cockpit/garage visual customization;
- cosmetic cargo pods and ship-mounted add-ons;
- optional rewarded ad / soft-currency convenience after a run, never while
  dodging;
- repair-time acceleration only if repair timers exist and the damaged ship
  remains playable;
- clearly priced starter packs that save time but do not sell an exclusive
  unbeatable handling tier.

### Avoid

- paid random loot boxes;
- selling a must-have route solution mid-wave;
- constantly showing offers in flight;
- making early control intentionally bad to force spending;
- too many materials or timers before the player enjoys the run.

---

## 8. Clean implementation seams

```text
Core catalogs
  CollectibleDefinition / UpgradeRequirement / WaveBlueprint
      ->
Core planning
  eligible wave + safe route + valuable route + contents + settlement result
      ->
Application orchestration
  chooses next eligible blueprint and forwards input/results only
      ->
Unity presenters
  terrain, lightning, pickup identity, laser burst, HUD, garage and audio
```

Core contracts needed before implementation:

- `CollectibleDefinition`: id, family, value, weight/capacity cost, rarity,
  upgrade uses.
- `CollectibleRoute`: planned positions, route role (`safe`, `valuable`,
  `hero`), and required capability.
- `WaveBlueprint`: environment family, entry/exit, safe route, reward route,
  hazards, collectible table, and recovery distance.
- `RunManifest`: collected items, unsecured value, and deterministic settlement
  result.
- `WaveOutcome`: cleared, crashed, skipped-value-route, collected-by-family,
  and why a pickup was rejected.

The wave planner validates the routes first. Unity never decides that an item is
collectible because it happens to look reachable on screen.

---

## 9. First playable proof target

Build one 60–90 second run:

1. Open-water crystal slalom with salvage arcs, then a short water breather as
   the last formations pass behind the ship.
2. A lightning storm silhouette fades in from the horizon; the player enters a
   power-cell weave, exits it, and gets another clear-water breath.
3. A destroyable formation appears far ahead, yields a satisfying collection
   burst, then fully scrolls past before open water returns.
4. The L3-style knife or prismatic hero route announces itself on the horizon;
   the player enters through a visible mouth, pursues a prism chance, and exits
   into calm water.
5. Calm-water automatic settlement.

Success is **not** “all systems exist.” Success is that a new player can say:

> “I skipped a safe line, threaded the storm for a power cell, blasted a
> formation for loot, and now I want one more run because I can improve the
> ship.”

Only after that works should we add more wave families, manual extraction,
contracts, sectors, or deeper economy layers.

---

## 10. Questions to resolve by playtesting

1. Does collecting a power cell feel worth leaving the safe route?
2. Is the reward route visible early enough to make a real choice?
3. Does the camera / speed make the player feel fast without hiding turn time?
4. Do the laser burst and prism cache create memorable peaks?
5. Does a 60–90 second run end while the player still wants another one?
6. Which upgrade creates the most immediately felt improvement: engine,
   handling, cargo capacity, laser, shield, or magnet?

Do not build the full economy until those answers are based on a playable wave
slice rather than theory.
