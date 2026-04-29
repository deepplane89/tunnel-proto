// ═══════════════════════════════════════════════════════════════════════════
// LEGACY WAVE DIRECTOR — ARCHIVED 2026-04-29
// ═══════════════════════════════════════════════════════════════════════════
//
// This is the pre-DR_SEQUENCE band-driven scheduler. It was the gameplay
// progression engine before the deterministic per-stage sequencer
// (DR_SEQUENCE in src/67-main-late.js) replaced it.
//
// WHY ARCHIVED, NOT DELETED:
//   The phase machine (RELEASE → BUILD → PEAK → SUSTAIN → RECOVERY) and
//   the band-eligibility/peakChance logic are still useful patterns. If a
//   future mode wants stochastic phase pacing instead of scripted stages,
//   start here.
//
// WHAT IT DID:
//   - Mapped game time → "band" (1-6+) via DR2_RUN_BANDS time thresholds
//   - Each band ran a phase machine: RELEASE (free random cones) → BUILD
//     (structured mechanic) → optional PEAK (harder mechanic) → SUSTAIN
//     (high-intensity cones) → RECOVERY (cooldown) → loop
//   - Band 4: auto-started CORRIDOR_ARC (the L3→L4→L5 corridor sequence)
//   - Band 4→5: advanced when corridor arc finished
//   - Band 5→6: advanced after 30s in Band 5
//   - `_drForcedBand` let the corridor arc override the time-derived band
//
// WHY RETIRED:
//   - Band-derived speed/vibe progression was unpredictable; players
//     couldn't learn the rhythm.
//   - Corridor arc as auto-progression coupled corridor pacing to time
//     elapsed, which conflicted with stage-scoped tuning.
//   - DR_SEQUENCE (33 scripted stages) makes progression deterministic
//     and authorable.
//
// HOW TO REVIVE (if you ever want it):
//   1. Move this file out of _archived/ and into the build (src/)
//   2. Add init for `_drForcedBand`, `_drBand4Started`, `_drBand5StartTime`
//      back into the runStart reset block (was at 67-main-late.js:665-667)
//   3. Restore the optional `_drForcedBand` override in:
//      - checkDeathRunVibe        (was 67-main-late.js:2685-2691)
//      - checkDeathRunSpeed       (was 67-main-late.js:2762-2768)
//      - 40-main-late.js          (was 40-main-late.js:2046)
//      - ring spawn band lookup   (was 67-main-late.js:5274-5275)
//   4. Replace the `_drSequencerTick(dt)` call in the main update loop
//      with `_legacyWaveDirectorTick(dt)`
//   5. Disable DR_SEQUENCE handler (or run it in a mode where stages are
//      skipped)
//
// DEPENDENCIES it needs from the live game:
//   - DR2_RUN_BANDS (still defined in 67-main-late.js — used for density
//     and eligibility, so it survives in live code)
//   - DR2_PHASE_DURATIONS
//   - DR_MECHANIC_FAMILIES
//   - _drPickMechanic, _drAdvanceArc, _ringSpawnRow, _dr2DebugLog,
//     clearAllCorridorFlags, _applyVibeTransition, applyDeathRunVibeTransition
//   - state.* flags: drPhase, drPhaseTimer, drPhaseDuration, drWaveCount,
//     deathRunRestBeat, slalomActive, zipperActive, angledWallsActive,
//     drCustomPatternActive, corridorMode, l4CorridorActive, l5CorridorActive,
//     _arcActive, _bonusRings
//
// ═══════════════════════════════════════════════════════════════════════════

// ── Forced-band state (was reset in startGame) ──────────────────────────────
// state._drForcedBand = -1;        // override band index, -1 = use elapsed time
// state._drBand4Started = false;   // has CORRIDOR_ARC kicked off?
// state._drBand5StartTime = 0;     // elapsed when Band 5 began (for 30s timer)

// ── Main tick — call from update loop after deathRunRestBeat decrement ─────
function _legacyWaveDirectorTick(dt) {
  if (!(state.isDeathRun && !state.introActive)) return;

  // Current run band (with forced band override for dynamic-duration tiers)
  const _drElapsed = state.elapsed || 0;
  let _drBandIdx = DR2_RUN_BANDS.length - 1;
  let _drBand = DR2_RUN_BANDS[_drBandIdx];
  if (state._drForcedBand != null && state._drForcedBand >= 0) {
    _drBandIdx = state._drForcedBand;
    _drBand = DR2_RUN_BANDS[_drBandIdx];
  } else {
    for (let bi = 0; bi < DR2_RUN_BANDS.length; bi++) {
      if (_drElapsed < DR2_RUN_BANDS[bi].maxTime) { _drBand = DR2_RUN_BANDS[bi]; _drBandIdx = bi; break; }
    }
  }
  // Band 4 (idx 3): auto-start CORRIDOR_ARC on entry
  if (_drBandIdx === 3 && !state._drBand4Started) {
    state._drBand4Started = true;
    clearAllCorridorFlags(); state.deathRunRestBeat = 1.0;
    const fam = DR_MECHANIC_FAMILIES['CORRIDOR_ARC'];
    state.drPhase = 'BUILD'; state.drPhaseTimer = 0; state.drPhaseDuration = 0;
    fam.activate(_drBand, 'build');
  }
  // Band 4→5: when corridor arc finishes, advance to Band 5
  if (_drBandIdx === 3 && state._drBand4Started && !state._arcActive &&
      !state.corridorMode && !state.l4CorridorActive && !state.l5CorridorActive) {
    state._drForcedBand = 4; // Band 5
    state._drBand5StartTime = state.elapsed;
    state.drPhase = 'RELEASE'; state.drPhaseTimer = 0;
    const _relDur = DR2_PHASE_DURATIONS.RELEASE;
    state.drPhaseDuration = _relDur.min + Math.random() * (_relDur.max - _relDur.min);
  }
  // Band 5→6: after 30s in Band 5, advance to Band 6
  if (state._drForcedBand === 4 && state._drBand5StartTime &&
      state.elapsed - state._drBand5StartTime >= 30) {
    state._drForcedBand = 5; // Band 6
  }

  // Is ANY structured mechanic currently active?
  // Advance arc stages (must run before mechActive check)
  _drAdvanceArc();
  const _drMechActive = state.slalomActive ||
                        state.zipperActive || state.angledWallsActive ||
                        state.drCustomPatternActive || state.corridorMode ||
                        state.l4CorridorActive || state.l5CorridorActive ||
                        state._arcActive;

  const phase = state.drPhase;

  if (phase === 'RELEASE' || phase === 'RECOVERY') {
    state.drPhaseTimer += dt;
    if (state.drPhaseTimer >= state.drPhaseDuration) {
      if (phase === 'RELEASE') {
        // Band 1: pure random cones only — loop RELEASE until Band 2
        if (_drBand.label === 'BAND1') {
          state.drPhaseTimer = 0;
          const _relDur = DR2_PHASE_DURATIONS.RELEASE;
          state.drPhaseDuration = _relDur.min + Math.random() * (_relDur.max - _relDur.min);

        } else {
          // Brief clear beat before structured mechanic starts
          const familyKey = _drPickMechanic('build', _drBandIdx);
          if (!familyKey) {
            // No eligible mechanics — loop RELEASE
            state.drPhaseTimer = 0;
            const _relDur2 = DR2_PHASE_DURATIONS.RELEASE;
            state.drPhaseDuration = _relDur2.min + Math.random() * (_relDur2.max - _relDur2.min);
          } else {
            state.deathRunRestBeat = 1.0 + Math.random() * 0.5;
            const family = DR_MECHANIC_FAMILIES[familyKey];
            state.drPhase = 'BUILD';
            state.drPhaseTimer = 0;
            state.drPhaseDuration = 0;
            family.activate(_drBand, 'build');
            _dr2DebugLog();
          }
        }
      } else {
        // RECOVERY -> RELEASE
        state.drPhase = 'RELEASE';
        state.drPhaseTimer = 0;
        const _relDur = DR2_PHASE_DURATIONS.RELEASE;
        state.drPhaseDuration = _relDur.min + Math.random() * (_relDur.max - _relDur.min);
        state.drWaveCount++;
        // 60% chance to spawn bonus rings at start of new RELEASE
        if (!state._tutorialActive && !state._jetLightningMode && Math.random() < 0.6 && _bonusRings.length === 0) { _ringSpawnRow(0); console.log('[DR] Bonus rings spawned (RELEASE), count=' + _bonusRings.length); }
        _dr2DebugLog();
      }
    }
  } else if (phase === 'BUILD') {
    if (!_drMechActive) {
      // BUILD mechanic finished. PEAK or RECOVERY?
      const doPeak = Math.random() < _drBand.peakChance;
      if (doPeak) {
        const familyKey = _drPickMechanic('peak', _drBandIdx);
        if (!familyKey) {
          // No eligible peak mechanics — skip to RECOVERY
          state.drPhase = 'RECOVERY';
          state.drPhaseTimer = 0;
          const _recDur2 = DR2_PHASE_DURATIONS.RECOVERY;
          state.drPhaseDuration = _recDur2.min + Math.random() * (_recDur2.max - _recDur2.min);
        } else {
          state.deathRunRestBeat = 1.0 + Math.random() * 0.5;
          const family = DR_MECHANIC_FAMILIES[familyKey];
          state.drPhase = 'PEAK';
          state.drPhaseTimer = 0;
          state.drPhaseDuration = 0;
          family.activate(_drBand, 'peak');
        }
      } else {
        state.drPhase = 'RECOVERY';
        state.drPhaseTimer = 0;
        const _recDur = DR2_PHASE_DURATIONS.RECOVERY;
        state.drPhaseDuration = _recDur.min + Math.random() * (_recDur.max - _recDur.min);
        state.deathRunRestBeat = 0.8 + Math.random() * 0.4;

      }
      _dr2DebugLog();
    }
  } else if (phase === 'PEAK') {
    if (!_drMechActive) {
      // PEAK mechanic done → SUSTAIN (brief high-intensity cones before recovery)
      state.drPhase = 'SUSTAIN';
      state.drPhaseTimer = 0;
      const _susDur = DR2_PHASE_DURATIONS.SUSTAIN;
      state.drPhaseDuration = _susDur.min + Math.random() * (_susDur.max - _susDur.min);
      _dr2DebugLog();
    }
  } else if (phase === 'SUSTAIN') {
    // Fast random cones, no rest beat — intensity holds before dropping
    state.drPhaseTimer += dt;
    if (state.drPhaseTimer >= state.drPhaseDuration) {
      state.drPhase = 'RECOVERY';
      state.drPhaseTimer = 0;
      const _recDur = DR2_PHASE_DURATIONS.RECOVERY;
      state.drPhaseDuration = _recDur.min + Math.random() * (_recDur.max - _recDur.min);
      state.deathRunRestBeat = 1.0 + Math.random() * 0.5;
      // Always spawn bonus rings after surviving peak — reward
      if (!state._tutorialActive && !state._jetLightningMode && _bonusRings.length === 0) { _ringSpawnRow(0); console.log('[DR] Bonus rings spawned (post-PEAK), count=' + _bonusRings.length); }
      _dr2DebugLog();
    }
  }
}
