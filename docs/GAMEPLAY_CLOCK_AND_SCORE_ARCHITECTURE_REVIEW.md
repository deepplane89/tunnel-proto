# Gameplay Clock and High-Score Architecture Review

## Status and Interpretation

Implemented architecture checkpoint. The review below records the source behavior and the target design; the first production slice is now wired into the Unity build.

Implemented in this checkpoint:

- total simulation ticks and score-eligible run ticks are distinct core domains;
- launch lift/progression suspension no longer consumes stage, distance, or score progress;
- pause/resume clears the host accumulator and cannot produce a catch-up burst;
- overdrive accelerates timed obstacle stages but not rest, corridor, or endless timing;
- the core owns one projected score and produces one immutable, idempotent `RunResult`;
- repair policy resets score, preserves distance, and explicitly disables leaderboard eligibility;
- completion, record comparison, save mutation, analytics, and publication route through `RunCompletionService`;
- PlayerPrefs high scores migrate from float storage to invariant `long` storage;
- eligible leaderboard results enter a durable, run-ID-deduplicated local outbox;
- gameplay pulses previously tied to `Time.time` now read the core/session presentation timeline;
- architecture tests cover suspension, stage-rate policy, finalization, duplicate completion, and repair.

Still intentionally deferred:

- network draining of the leaderboard outbox, because the Unity port does not yet have the source player-name/profile flow;
- a full fixed-point score-unit conversion (the core now accumulates in `double` and finalizes to `long`);
- retirement of the optional legacy host and remaining presentation-only `Time.deltaTime` consumers;
- a playable Save Me flow; only its engine-neutral rule and eligibility contract exist in this checkpoint.

“High school system” is interpreted as “high-score system.” The review covers the source Three.js runtime, the Unity host, the engine-neutral core package, pause/background behavior, run finalization, persistence, and leaderboard submission.

## Recommendation

Do **not** replicate the Three.js clock and score implementation literally.

Preserve its intentional gameplay rules—fixed 60 Hz simulation, full gameplay freeze during pause, speed-based scoring, distance-based final bonus, and faster stage progression during overdrive—but express them through the engine-neutral core with explicit time domains and one canonical score.

The Unity/core direction is already substantially better than the browser source. It should be hardened rather than replaced. The largest remaining work is to:

1. distinguish simulation time, eligible run time, stage progress, presentation time, and UTC wall time;
2. remove the remaining duplicate/legacy score concepts;
3. prevent launch/grace presentation from consuming score or stage time unintentionally;
4. finalize each run into one immutable result;
5. make persistence and leaderboard publication idempotent;
6. route Unity VFX away from `Time.time` where pause-accurate behavior matters.

## Source Files Reviewed

Primary Three.js behavior:

- `src/20-main-early.js`: global state and timer fields;
- `src/60-main-late.js`: pause/resume and title transitions;
- `src/67-main-late.js`: start/reset, sequencer clocks, scoring, death, final score, repair, leaderboard handoff, and `update(dt)`;
- `src/70-perf-diag.js`: requestAnimationFrame loop, raw delta clamp, pause gate, and fixed-step accumulator;
- `src/72-main-late-mid.js`: visibility/background lifecycle and loop startup;
- `src/10-leaderboard.js`: local/API leaderboard behavior;
- `src/85-resume-gate.js`: long-background resume policy;
- `src/15-holographic-material.js` and powerup-shatter code: presentation-time expectations.

Unity and engine-neutral behavior:

- `Assets/JetHorizon/Scripts/Core/GameManager.cs`;
- `Assets/JetHorizon/Scripts/Core/GameStateMachine.cs`;
- `Assets/JetHorizon/Scripts/Core/RunSession.cs`;
- `Assets/JetHorizon/Scripts/Architecture/CoreSimulationHost.cs`;
- `Assets/JetHorizon/Scripts/Architecture/UnityGameServices.cs`;
- `Packages/com.jethorizon.core/Runtime/JetHorizonSimulation.cs`;
- `Packages/com.jethorizon.core/Runtime/StageDirector.cs`;
- `Packages/com.jethorizon.core/Runtime/SimulationTypes.cs`;
- `Packages/com.jethorizon.core/Application/GamePorts.cs`;
- `Packages/com.jethorizon.core/Application/RunEventRouter.cs`;
- timing consumers under Camera, UI, World, Ship, and VFX;
- `Assets/JetHorizon/Tests/Architecture/JetHorizonSimulationTests.cs`.

## The Three.js Time Model

The source does not have one gameplay clock. It has several clocks with partially overlapping meanings.

### 1. Frame clock

`THREE.Clock.getDelta()` measures real time between rendered frames. The main loop clamps it to 50 ms. This prevents a backgrounded tab or long hitch from advancing gameplay by an enormous amount on one frame.

### 2. Fixed simulation clock

The clamped frame delta enters an accumulator. Gameplay runs in `1/60` second increments:

```text
accumulator += clampedFrameDelta
while accumulator >= 1/60:
    update(1/60)
    accumulator -= 1/60
```

This is the strongest part of the source architecture. It gives movement and gameplay timers stable input regardless of render frame rate.

### 3. `state.elapsed`

`state.elapsed` advances by the fixed simulation delta every `update(dt)` call while the phase is playing. It drives:

- run-band selection;
- some deadlines and diagnostics;
- bobbing and pickup animation;
- powerup shader animation;
- various gameplay/presentation effects.

It resets in `startGame()` and resets again when the Death Run prologue launches. Therefore it is not consistently “time since run object creation”; it is closer to “fixed-step time since active launch,” with some pre-launch increments discarded.

### 4. `state.levelElapsed`

This advances beside `state.elapsed` and resets on level changes. Campaign-specific encounters use it for triggers and durations. It is a second gameplay-progress clock maintained manually.

### 5. `state.seqStageElapsed`

The Death Run sequencer maintains its own per-stage progress. It has special policy:

- normal timed stages advance by `dt`;
- overdrive advances normal timed stages by `dt * 1.8` so spatial traversal and stage completion stay aligned;
- rest stages advance by ordinary `dt`;
- corridor stages advance by ordinary `dt` and may also complete through a mechanic-finished condition;
- it resets to zero on every stage transition.

This is not merely a clock. It is a gameplay progress value with a stage-specific rate policy.

### 6. Integrated distance

Distance advances by `effectiveSpeed * dt`. It is spatial progress, not elapsed time. It survives a Save Me repair even though both score counters reset.

### 7. Wall-clock timestamps

`Date.now()` is used for analytics run duration and leaderboard dates. `_runStartTs` is captured before the Death Run prologue. The reported analytics duration can therefore include:

- the prologue;
- pause time;
- time spent backgrounded;
- resume-overlay delay.

That value does not mean the same thing as `state.elapsed`, even though both are reported at run end.

### 8. `performance.now()` and browser timers

`performance.now()`, `setTimeout`, `setInterval`, and requestAnimationFrame-local ages are used for input hold duration, UI choreography, audio scheduling, diagnostics, and some visual effects. These are presentation/wall clocks and do not all obey gameplay pause automatically. Considerable manual pause/resume cleanup exists because of that split.

## The Three.js Pause Model

The main animation loop has a top-level pause guard. While paused it renders the frozen scene at a reduced cadence and skips:

- fixed simulation steps;
- camera/FOV progression;
- shader time;
- water movement;
- world and VFX ticks.

This behavior should be preserved. The source then has substantial additional code to freeze/re-arm browser timers and audio because those APIs live outside the simulation loop.

The useful rule is simple: **gameplay time and gameplay presentation time do not advance while paused.** The implementation complexity around web audio and browser timers should not be ported.

## The Three.js Score and High-Score Model

### Internal score

`state.score` is an internal progression/threshold score. Roughly every 0.4 seconds it receives:

```text
(multiplier + score-stat bonus) * max(1, speed / baseSpeed)
```

It is used by older campaign level-threshold logic, debug output, and some analytics.

This tick loses time: when `scoreTick > 0.4`, the code sets `scoreTick = 0` rather than subtracting `0.4`. At 60 Hz the trigger commonly occurs after approximately 0.4167 seconds, so residual time is discarded and the effective tick rate drifts below the nominal value.

### Player-facing score

`state.playerScore` is the HUD and leaderboard score. It increases continuously:

```text
8 * campaignLevelMultiplier * playerLevelMultiplier * speedBoostMultiplier * dt
```

Near misses and other bonuses may contribute through additional paths. At death, a distance multiplier is applied:

```text
1 + 0.1 * floor(distance / 5000)
```

The displayed/submitted final score is based on `playerScore`, not `state.score`.

### High-score defects

The source initializes `state.bestScore` to zero but does not load or save it as a durable per-profile best.

The death path first compares the **internal score** to `bestScore`, then later compares the **final player-facing score** to that same field. Two different score domains are therefore competing for one record. Depending on their relative values, this can suppress or mislabel the “NEW BEST” presentation.

### Leaderboard behavior

The leaderboard layer is separate from `state.bestScore`:

- Death Run final scores are submitted;
- a local fallback stores one best score per case-insensitive player name;
- local entries are sorted and capped;
- the network API is attempted asynchronously;
- the local fallback remains available if the API fails.

The best-per-name rule is sensible. However, the browser implementation has no durable submission outbox or run identity, so it cannot reliably distinguish a retry from a duplicate submission.

### Save Me semantics

Repair resets both score counters but preserves accumulated distance. The eventual final multiplier uses the preserved distance. This may be an intentional survival reward, but it must be represented explicitly as a scoring rule rather than emerging from which fields happen to reset.

## Current Unity/Core Architecture

### What is already strong

The engine-neutral core has the right foundation:

- deterministic fixed-step `Step()`;
- a monotonically increasing simulation tick;
- no Unity API dependency;
- pause represented in core phase;
- one core-owned score rather than source-style internal/HUD duplication;
- continuous per-second score accumulation;
- distance integration in the core;
- final distance multiplier applied by the core before emitting death;
- an immutable-ish snapshot boundary for Unity presentation;
- a pure stage director with explicit stage elapsed state;
- platform services behind ports for persistence, analytics, and leaderboard publication;
- deterministic and pause-focused tests.

`RunEventRouter` also correctly keeps saves, analytics, audio, haptics, and leaderboards outside deterministic gameplay.

### Remaining problems

#### Core elapsed time is underspecified

`JetHorizonSimulation._elapsed` advances on every playing simulation step, even when `WorldFrame.ProgressionSuspended` is true. Existing tests assert this behavior. That is acceptable if the value means “simulation-active elapsed,” but consumers currently treat `Session.Elapsed` as a general gameplay/presentation time.

The name does not communicate whether launch, grace, scripted freezes, or non-scoring gameplay should count.

#### Stage progress can advance while progression is suspended

`StageDirector.Tick()` runs before the score/distance suspension check and does not inspect `ProgressionSuspended`. Consequently a launch/prologue state can consume stage duration even when score and distance are meant to be frozen.

#### Unity launch suspension is incomplete

`GameManager` constructs `WorldFrame` using `Session.IntroActive` as `ProgressionSuspended`, but the actual launch uses `IntroLiftActive`. Spawning and collision correctly include `IntroLiftActive`; score/distance suspension does not. The core can therefore award passive score and distance during the launch lift.

#### Presentation uses unrelated Unity clocks

Some presentation systems correctly use the core's elapsed snapshot, while others use `Time.time` or `Time.deltaTime`. Examples include thruster pulse, shield-light pulse, lightning warning pulse, launch FOV timing, and vibe transitions.

This creates inconsistent pause semantics. The core can be frozen while global Unity time continues. Some components manually gate by phase, some turn themselves off, and others continue interpolating.

#### Phase time advances during pause

`GameStateMachine.TimeInPhase` is incremented before `GameManager` returns for the paused phase. That can be valid for UI time, but it should not be named or consumed as gameplay-phase time without an explicit policy.

#### Duplicate host path

`GameManager` owns the active fixed-step accumulator and core simulation. `CoreSimulationHost` contains a second opt-in accumulator using `Time.unscaledDeltaTime` and is documented as not wired into the shipping scene. Keeping two potential hosts increases the chance of future double-stepping or inconsistent pause/delta policy.

#### Score types and legacy fields remain mixed

The core uses `float` score, progress storage uses `float`, and leaderboard publication floors to `long`. `RunSession` still exposes both `Score` and `PlayerScore`, but the Unity adapter only synchronizes the core score into `PlayerScore`.

The old dual-score vocabulary should be removed before more systems depend on it.

#### Run finalization is event-driven but not idempotent

`RunEventRouter` saves and submits whenever it receives `PlayerDied`. There is no stable run ID or persisted “already finalized” key. The current event flow normally dispatches once, but architecture should make duplicate dispatch harmless.

#### Unity leaderboard is still silent

The composition root currently installs `SilentLeaderboardService`, so the engine-neutral publication seam exists but no actual Unity leaderboard adapter submits scores.

## Proposed Time Architecture

Do not create one universal clock service that every system reads. Instead, make each time domain explicit.

### 1. Host frame time

Unity-only input to the accumulator:

- source: `Time.unscaledDeltaTime` or an injected host-frame source;
- clamp: 50 ms;
- purpose: decide how many fixed simulation ticks to run;
- never enters scoring, stage rules, or persistence directly;
- accumulator is cleared or normalized on pause/resume so no catch-up burst occurs.

There should be one shipping simulation host: `GameManager` or a renamed dedicated `SimulationRunner`, not both.

### 2. Simulation tick

The authoritative deterministic time coordinate:

- `long Tick`;
- fixed delta from config;
- increments only when the core accepts a playing step;
- total simulation seconds derived as `Tick * FixedDeltaSeconds` when needed;
- never derived by repeatedly adding float deltas for authoritative comparisons.

Timers with deterministic gameplay consequences should preferably store either remaining ticks or an integer end tick.

### 3. Eligible run tick

A second integer counter for leaderboard/analytics gameplay duration:

- advances only while the player is in active, score-eligible control;
- excludes title, pause, dead, prologue, launch lift, and any explicitly suspended progression;
- does not reset on Save Me if the repair is considered the same run;
- appears in the immutable `RunResult`.

This replaces the ambiguity between browser `_runStartTs` and `state.elapsed`.

### 4. Stage progress

Stage progress belongs to `StageDirector`; it should not masquerade as universal elapsed time.

Represent it as deterministic progress units or ticks with an explicit rate:

- normal timed stage rate: `1.0`;
- overdrive timed stage rate: `1.8` where parity requires it;
- rest/corridor rate: `1.0` unless the content definition says otherwise;
- progression-suspended rate: `0.0`;
- mechanic-completion stages may finish from a completion signal before the duration cap.

Put this policy in stage data or a small `StageTimePolicy`, not in broad conditionals spread through the director.

### 5. Gameplay presentation time

A read-only time value projected from accepted simulation ticks for effects that must freeze with gameplay:

- ship bob;
- powerup shaders;
- thruster flicker;
- gameplay star/water motion;
- lightning warnings;
- gameplay camera easing.

Unity shaders can receive this value globally once per frame. Gameplay VFX should not read `Time.time` directly.

### 6. UI/death presentation time

Some presentation intentionally continues while simulation is stopped:

- pause menu animation;
- death explosion/camera beat;
- title animation;
- loading/resume overlay.

These should use an explicitly unscaled presentation clock selected by phase. They must never feed back into simulation state or score.

### 7. UTC wall clock

Rename `IClock` to `IWallClock` or `IUtcClock` and reserve it for:

- persisted completion timestamp;
- analytics timestamps;
- daily systems;
- server submission metadata.

Never use UTC duration as authoritative gameplay duration.

## Proposed Score Architecture

### One canonical score

The engine-neutral core should own one score shown on the HUD, finalized on death, compared against the high score, and submitted to the leaderboard.

Stage progression should not use a hidden second score. The current stage director is already time/content driven, so the legacy browser threshold score is unnecessary.

### Pure score rules

Create an immutable `ScoreRules` definition containing:

- passive score rate;
- speed multiplier rule;
- campaign/stage multiplier if still required;
- profile/player-level multiplier if still required;
- coin value;
- near-miss value;
- other bonus values;
- distance bonus step and increment;
- repair policy;
- leaderboard eligibility policy.

The exact Three.js player-facing formula can be preserved through these rules without preserving its global variables or dual counters.

### Deterministic score units

Use integer fixed-point accumulation inside the core, for example milli-points:

```text
ScoreUnitsPerPoint = 1000
passiveUnitsThisTick = configuredRateUnits / ticksPerSecond
```

The HUD can display `floor(units / ScoreUnitsPerPoint)`. Final score and persisted high score should be `long`. This prevents float storage drift and removes the current float-to-long ambiguity.

If exact fractional distribution does not divide evenly by 60, carry an integer remainder rather than dropping it. This is the deterministic equivalent of subtracting a tick interval instead of resetting an accumulator to zero.

### Immutable run result

On the first terminal run event, create one `RunResult`:

```text
RunId
Mode
Seed
RawScore
Distance
DistanceMultiplier
FinalScore
EligibleRunTicks
TotalSimulationTicks
HighestStage
EligibilityFlags
StartedUtc
CompletedUtc
DeathCause
RepairCount
```

`ApplyFinalScoreMultiplier()` should become part of one idempotent `FinalizeRun()` operation. Repeated death/finalize calls must return the same result without applying the multiplier twice.

### Completion service

An application-level `RunCompletionService` should:

1. receive the immutable `RunResult`;
2. reject a duplicate `RunId`;
3. load profile progress;
4. compare one final-score domain against the saved high score;
5. return `IsNewBest` and prior/new best values;
6. save progress atomically;
7. enqueue an eligible leaderboard submission;
8. emit analytics from the same result.

The UI should render the returned completion outcome. It should never recompute final score or independently decide whether a record was beaten.

### Leaderboard outbox

Replace fire-and-forget submission with a tiny durable queue:

- record `RunId`, profile/player ID, final score, mode, and completion timestamp;
- mark submitted only after success;
- retry after reconnect/startup;
- let the server deduplicate by `RunId`;
- preserve the source's local best-per-player fallback for offline display.

Eligibility belongs in `RunResult`, covering god mode, debug starts, skipped starts, cheats, unsupported versions, or repaired-run policy.

## Parity Decisions to Make Explicit

These are gameplay-design choices, not clock implementation details:

1. Does launch-lift time count toward displayed run duration? Recommendation: no.
2. Does post-launch grace count? Recommendation: yes for duration, score, and distance once the ship is controllable; spawning can remain suppressed.
3. Does overdrive shorten every timed stage, only obstacle stages, or no stages? Source parity: timed obstacle stages only; rests and corridors remain real-rate.
4. Does Save Me preserve elapsed time and distance? Source parity: yes.
5. Does Save Me reset raw score? Source parity: yes, but encode it as a rule.
6. Is a repaired run leaderboard-eligible? Must be an explicit eligibility flag.
7. Do player-level upgrades multiply leaderboard score? The source does; retain only if competitive balance intentionally includes progression advantages.
8. Is distance multiplier applied to all score since launch or only score since the last repair? Source behavior: score since repair multiplied by total preserved distance.

## Implementation Plan

### Phase 1: lock behavior with tests

- Add tests for launch, pause, resume, death, repair, overdrive stage rate, and background-sized frame deltas.
- Add score-vector tests at fixed seeds and exact tick counts.
- Record intended Three.js parity values for representative 30, 60, and 180 second runs.
- Add a test proving finalization is idempotent.

### Phase 2: explicit core time snapshot

- Add simulation tick and eligible-run tick to `SimulationSnapshot`.
- Derive seconds for presentation rather than accumulating authoritative floats.
- Add stage progress policy and suspend it with progression.
- Correct Unity launch-lift progression suspension.
- Clear/normalize the host accumulator on pause transitions.

### Phase 3: consolidate scoring

- Introduce `ScoreRules` and integer score units.
- Remove `RunSession.Score`/`PlayerScore` duplication in favor of one projected core score.
- Preserve source player-facing score behavior through configuration.
- Make finalization return an immutable `RunResult` exactly once.

### Phase 4: completion and high score

- Replace direct `RunEventRouter.SaveRun()` behavior with `RunCompletionService`.
- Store integer high score and schema-migrate the current PlayerPrefs float.
- Return `IsNewBest` to UI.
- add stable run IDs and duplicate-completion protection.
- implement the real Unity leaderboard adapter and durable outbox.

### Phase 5: presentation clock cleanup

- Add a Unity `PresentationClock`/global shader-time adapter.
- Replace gameplay uses of `Time.time` with gameplay presentation time.
- Keep title, pause UI, and death choreography on named unscaled channels.
- Audit components so pausing freezes, hides, or continues each effect intentionally rather than accidentally.

### Phase 6: remove migration leftovers

- Retire or fold `CoreSimulationHost` into the single shipping runner.
- Remove legacy Unity `WaveDirector` timing once the core director is the only path.
- Remove obsolete session timer/score fields.
- Update architecture documentation and tests around the final ownership rules.

## Required Tests

- identical seed and input ticks produce identical tick, score, stage, distance, and result;
- pause for any wall-clock duration advances no simulation/run/stage/gameplay-presentation time;
- resuming never performs a catch-up burst;
- launch lift advances neither score nor stage progress;
- overdrive advances only the stage families whose policy requests it;
- final multiplier is applied exactly once;
- repaired-run behavior matches the selected policy;
- a duplicate death/completion event does not increment runs, save twice, or submit twice;
- high score compares final score only;
- offline leaderboard entries survive restart and retry;
- long runs do not lose timer precision;
- Unity gameplay shaders freeze on pause while pause UI may continue.

## Final Decision

Use the Three.js implementation as behavioral evidence, not as the architecture to port.

Keep:

- clamped host delta;
- deterministic fixed-step gameplay;
- complete gameplay freeze during pause;
- explicit overdrive pacing rules;
- continuous player-facing scoring;
- distance-based final bonus;
- local leaderboard fallback.

Replace:

- global mutable timer fields;
- `state.elapsed` serving both gameplay and animation without a contract;
- internal score versus player score;
- float high scores;
- wall-clock run duration;
- non-idempotent death publication;
- direct gameplay reads of `Time.time`;
- multiple potential simulation hosts.

The result should be a deterministic engine-neutral run timeline and score model, with Unity acting only as input, presentation, persistence, and network adapters.
