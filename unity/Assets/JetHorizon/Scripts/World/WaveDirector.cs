using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// The DR sequencer (spec/02 §3-4): drives the 33-stage script, speed ladder,
    /// deferred speed bumps, pre-canyon quiet windows, klaxon countdown, and the
    /// endless rotation after the scripted run.
    /// </summary>
    public sealed class WaveDirector : MonoBehaviour, ISimSystem
    {
        public CanyonSystem Canyon;
        public SineCorridorSystem SineCorridor;
        public ZipperSystem Zipper;
        public SlalomSystem Slalom;
        public AngledWallSystem AngledWalls;
        public ObstacleSpawner Obstacles;

        public SpawnMode SpawnMode { get; private set; } = SpawnMode.None;
        public string ConeDensity { get; private set; } = "normal";
        public float StageRampT01 { get; private set; }   // for 'ramp' density cadence
        public int StageIndex { get; private set; }
        public string StageName => _stages != null && StageIndex < _stages.Length ? _stages[StageIndex].name : "—";

        const float PreCanyonQuietS = 4f;
        const float SpeedDeferDeadline = 8f;

        SequenceStage[] _stages;
        float _stageElapsed;
        bool _corridorLaunched;
        bool _klaxonFired;
        float _structuredWallTimer;

        // Deferred speed bump
        bool _speedPending; float _pendingSpeed; float _pendingSince;

        // Endless
        const float EndlessBlock = 15f, EndlessRest = 4f;
        static readonly string[] EndlessRotation = {
            "random_cones", "angled_random", "lethal", "fat_cones",
            "angled_struct", "zipper", "slalom", "l3_corridor", "l4_corridor" };
        int _endlessIdx; float _endlessT; bool _endlessResting; int _waveCount; int _wavesSinceCorridor;

        RunSession S => GameManager.I.Session;

        public void ResetSystem()
        {
            if (_stages == null) _stages = SequenceAsset.Load().stages;
            StageIndex = 0; _stageElapsed = 0f; _corridorLaunched = false; _klaxonFired = false;
            _structuredWallTimer = 0f;
            _speedPending = false;
            _endlessIdx = 0; _endlessT = 0f; _endlessResting = true; _waveCount = 0; _wavesSinceCorridor = 99;
            SpawnMode = SpawnMode.None; ConeDensity = "normal"; StageRampT01 = 0f;
            if (GameManager.I != null)
            {
                S.Speed = Tuning.BaseSpeed * 1.5f;   // S1 launch speed
                S.SpeedFloor = 1f;
            }
            EnterStage(0);
        }

        public void SimTick(float dt)
        {
            if (_stages == null || _stages.Length == 0) return;
            var s = S;
            var stage = _stages[StageIndex];

            // Overdrive burns stage time faster (spec/02 §4.2)
            float stageDt = s.OverdriveActive ? dt * 1.8f : dt;
            _stageElapsed += stageDt;

            // Deferred speed bump application
            if (_speedPending)
            {
                _pendingSince += dt;
                if (HazardsClear() || _pendingSince > SpeedDeferDeadline)
                {
                    float from = s.Speed;
                    s.Speed = _pendingSpeed;
                    _speedPending = false;
                    GameEvents.RaiseSpeedChanged(from, s.Speed);
                }
            }
            else if (!s.AnyCorridorActive && !s.OverdriveActive)
            {
                // steady-state ramp toward stage speed (only outside canyons)
                float target = Tuning.BaseSpeed * Mathf.Max(stage.speed, s.SpeedFloor);
                if (Mathf.Abs(s.Speed - target) > 0.5f && target < s.Speed)
                    s.Speed = target; // decreases apply instantly (rare)
            }

            switch (stage.type)
            {
                case "rest":
                    s.RestBeat = Mathf.Max(s.RestBeat, 0.5f);
                    if (_stageElapsed >= stage.duration) Advance();
                    break;

                case "corridor":
                case "l3_cone_corridor":
                    if (!_corridorLaunched)
                    {
                        _corridorLaunched = true;
                        SpawnMode = SpawnMode.None;
                        s.RestBeat = 1.5f;
                        Obstacles.WipeAllHazards();
                        LaunchFamily(stage);
                    }
                    else
                    {
                        bool familyDone = !FamilyActive(stage);
                        bool timedOut = stage.duration > 0f && _stageElapsed >= stage.duration;
                        if (familyDone || timedOut) Advance();
                    }
                    break;

                case "endless_mix":
                    EndlessTick(dt);
                    break;

                default:  // timed obstacle stages
                    TickTimedStage(stage, dt);
                    if (_stageElapsed >= stage.duration) Advance();
                    break;
            }

            // Klaxon: 1.5 s before a speed increase at the next boundary.
            // For canyons (natural end) the drift-out phase is the "1.5 s left" signal.
            if (!_klaxonFired && StageIndex + 1 < _stages.Length)
            {
                var next = _stages[StageIndex + 1];
                bool nearEnd = (stage.duration > 0f && stage.duration - _stageElapsed <= 1.5f)
                            || (stage.type == "corridor" && s.CanyonExiting);
                if (next.speed > stage.speed && nearEnd)
                {
                    _klaxonFired = true;
                    GameEvents.RaiseKlaxonCountdown();
                }
            }
        }

        void TickTimedStage(SequenceStage stage, float dt)
        {
            var s = S;

            // Pre-canyon quiet window: last 4 s before a corridor → no new spawns
            bool quiet = false;
            if (StageIndex + 1 < _stages.Length)
            {
                var next = _stages[StageIndex + 1];
                bool nextIsCorridor = next.type == "corridor" || next.type == "l3_cone_corridor";
                quiet = nextIsCorridor && stage.duration - _stageElapsed <= PreCanyonQuietS;
            }

            switch (stage.type)
            {
                case "random_cones":
                    SpawnMode = quiet ? SpawnMode.None : SpawnMode.Cones;
                    ConeDensity = stage.density ?? "normal";
                    StageRampT01 = ConeDensity == "ramp" ? Mathf.Clamp01(_stageElapsed / stage.duration) : 0f;
                    break;
                case "fat_cones":
                    SpawnMode = quiet ? SpawnMode.None : SpawnMode.FatCones;
                    break;
                case "lethal_rings":
                    SpawnMode = quiet ? SpawnMode.None : SpawnMode.Lethal;
                    break;
                case "angled_walls":   // S4: walls 0-15s, break 15-17s, walls 17-30s
                    bool inBreak = _stageElapsed >= 15f && _stageElapsed < 17f;
                    SpawnMode = (quiet || inBreak) ? SpawnMode.None : SpawnMode.Angled;
                    break;
                case "structured_walls":  // S5: grid burst every 3 s
                    SpawnMode = SpawnMode.None;
                    _structuredWallTimer -= dt;
                    if (!quiet && _structuredWallTimer <= 0f && !s.AngledWallsActive)
                    {
                        _structuredWallTimer = 3f;
                        AngledWalls.StartStructuredBurst();
                    }
                    break;
                case "slalom_only":
                    SpawnMode = SpawnMode.None;
                    if (!quiet && !s.SlalomActive)
                        Slalom.Begin(Tuning.SlalomGapWidthDR, 16 + Random.Range(0, 3));
                    break;
                case "zipper_only":
                    SpawnMode = SpawnMode.None;
                    if (!quiet && !s.ZipperActive) Zipper.Begin(Tuning.ZipperRows);
                    else if (quiet) Zipper.Abort();
                    break;
            }
        }

        void LaunchFamily(SequenceStage stage)
        {
            string fam = stage.type == "l3_cone_corridor" ? "L3_KNIFE" : stage.family;
            switch (fam)
            {
                case "PRE_T4A_CANYON": Canyon.Activate(CanyonPresets.PreT4A(stage.darkSlabs), stage.speed); break;
                case "PRE_T4B_CANYON": Canyon.Activate(CanyonPresets.PreT4B(), stage.speed); break;
                case "L3_KNIFE":       Canyon.Activate(CanyonPresets.L3Knife(), stage.speed); break;
                case "L4_SINE_CORRIDOR": SineCorridor.Begin(SineCorridorSystem.Kind.L4); break;
                case "L5_SINE_CORRIDOR":
                    S.SpeedFloor = Mathf.Max(S.SpeedFloor, 2.5f);   // permanent ratchet
                    SineCorridor.Begin(SineCorridorSystem.Kind.L5);
                    break;
                default:
                    Debug.LogWarning($"[WaveDirector] Unknown family '{fam}'");
                    break;
            }
        }

        bool FamilyActive(SequenceStage stage)
        {
            if (stage.type == "l3_cone_corridor") return S.CanyonActive || S.CanyonExiting;
            return stage.family switch
            {
                "PRE_T4A_CANYON" or "PRE_T4B_CANYON" => S.CanyonActive || S.CanyonExiting,
                "L4_SINE_CORRIDOR" or "L5_SINE_CORRIDOR" => S.SineCorridorActive,
                _ => false
            };
        }

        void Advance()
        {
            var s = S;
            var prev = _stages[StageIndex];
            if (StageIndex + 1 >= _stages.Length) return;
            StageIndex++;
            var stage = _stages[StageIndex];
            _stageElapsed = 0f; _corridorLaunched = false; _klaxonFired = false;

            // Clear mechanic flags defensively (single ownership rule)
            Zipper.Abort(); Slalom.Abort(); AngledWalls.Abort();
            SpawnMode = SpawnMode.Cones; ConeDensity = "normal"; StageRampT01 = 0f;

            if (prev.type == "rest") s.RestBeat = Mathf.Max(s.RestBeat, 0.4f);
            if (stage.type == "rest") Obstacles.WipeAllHazards();

            s.PhysTier = stage.physTier;
            GameEvents.RaiseStageChanged(StageIndex);
            GameEvents.RaiseVibeChanged(stage.vibeIdx);

            // Speed: increases deferred until in-flight hazards clear
            float target = Tuning.BaseSpeed * Mathf.Max(stage.speed, s.SpeedFloor);
            if (target > s.Speed + 0.01f)
            {
                _speedPending = true; _pendingSpeed = target; _pendingSince = 0f;
            }
            else if (target < s.Speed - 0.01f && !s.AnyCorridorActive)
            {
                float from = s.Speed; s.Speed = target;
                GameEvents.RaiseSpeedChanged(from, target);
            }
        }

        bool HazardsClear() =>
            Obstacles.ActiveHazardCount == 0 && !S.AnyCorridorActive
            && !S.ZipperActive && !S.SlalomActive && !S.AngledWallsActive;

        // ── ENDLESS (spec/02 §4.4) ──────────────────────────────────────────
        void EndlessTick(float dt)
        {
            var s = S;
            _endlessT += s.OverdriveActive ? dt * 1.8f : dt;

            if (_endlessResting)
            {
                SpawnMode = SpawnMode.None;
                s.RestBeat = Mathf.Max(s.RestBeat, 0.5f);
                if (_endlessT >= EndlessRest)
                {
                    _endlessResting = false; _endlessT = 0f;
                    ActivateEndlessBlock();
                }
                return;
            }

            bool blockRunning = s.AnyCorridorActive || s.ZipperActive || s.SlalomActive || s.AngledWallsActive;
            if (_endlessT >= EndlessBlock && !blockRunning)
            {
                // block over → rest
                _endlessResting = true; _endlessT = 0f;
                SpawnMode = SpawnMode.None;
                Zipper.Abort(); Slalom.Abort(); AngledWalls.Abort();
                Obstacles.WipeAllHazards();
                s.RestBeat = EndlessRest;
                _waveCount++; _wavesSinceCorridor++;
                GameEvents.RaiseVibeChanged((_waveCount + 4) % Vibes.Count);
            }
        }

        void ActivateEndlessBlock()
        {
            var s = S;
            string type = EndlessRotation[_endlessIdx % EndlessRotation.Length];
            _endlessIdx++;

            bool corridorAllowed = _waveCount >= 3 && _wavesSinceCorridor >= 5;
            if ((type == "l3_corridor" || type == "l4_corridor") && !corridorAllowed)
            {
                type = "random_cones";
            }

            s.RestBeat = 1.0f;
            switch (type)
            {
                case "random_cones":  SpawnMode = SpawnMode.Cones; ConeDensity = "ramp"; StageRampT01 = 1f; break;
                case "angled_random": SpawnMode = SpawnMode.Angled; break;
                case "lethal":        SpawnMode = SpawnMode.Lethal; break;
                case "fat_cones":     SpawnMode = SpawnMode.FatCones; break;
                case "angled_struct": SpawnMode = SpawnMode.None; AngledWalls.StartStructuredBurst(); break;
                case "zipper":        SpawnMode = SpawnMode.None; Zipper.Begin(18 + Random.Range(0, 6)); break;
                case "slalom":        SpawnMode = SpawnMode.None; Slalom.Begin(9f, 16 + Random.Range(0, 4)); break;
                case "l3_corridor":   SpawnMode = SpawnMode.None; _wavesSinceCorridor = 0; Canyon.Activate(CanyonPresets.L3Knife(), 2.5f); break;
                case "l4_corridor":   SpawnMode = SpawnMode.None; _wavesSinceCorridor = 0; SineCorridor.Begin(SineCorridorSystem.Kind.L4); break;
            }
        }

        void EnterStage(int idx)
        {
            StageIndex = idx;
            var stage = _stages != null && _stages.Length > idx ? _stages[idx] : null;
            if (stage == null) return;
            SpawnMode = SpawnMode.Cones;
            ConeDensity = stage.density ?? "normal";
            GameEvents.RaiseVibeChanged(stage.vibeIdx);
        }
    }
}
