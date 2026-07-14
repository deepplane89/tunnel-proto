using UnityEngine;

namespace JetHorizon
{
    /// <summary>A gameplay system ticked at fixed 60 Hz in an explicit order.</summary>
    public interface ISimSystem
    {
        /// <summary>Fixed-step gameplay tick (dt = 1/60). Only called while Playing/Tutorial.</summary>
        void SimTick(float dt);
        /// <summary>Hard reset to pristine state for a new run.</summary>
        void ResetSystem();
    }

    /// <summary>
    /// Composition root. Owns the state machine, the run session, and the fixed-step
    /// accumulator loop (mirrors the JS rAF + accumulator: rawDt clamp 50 ms, sim 1/60).
    /// Update ORDER is explicit and matches spec/01 §7.2.
    /// </summary>
    public sealed class GameManager : MonoBehaviour
    {
        public static GameManager I { get; private set; }

        [Header("Systems (wired by bootstrap, ticked in this order)")]
        public ShipController Ship;
        public CameraRig Camera;
        public WaveDirector Waves;
        public CanyonSystem Canyon;
        public SineCorridorSystem SineCorridor;
        public ZipperSystem Zipper;
        public SlalomSystem Slalom;
        public AngledWallSystem AngledWalls;
        public LightningSystem Lightning;
        public ObstacleSpawner Obstacles;
        public PickupSystem Pickups;

        public readonly GameStateMachine State = new GameStateMachine();
        public RunSession Session { get; private set; } = new RunSession();

        float _accumulator;
        float _deathTimer;
        bool  _killedThisFrame;   // JS `return` after killPlayer aborts remaining checks

        public GamePhase Phase => State.Phase;

        void Awake()
        {
            if (I != null && I != this) { Destroy(gameObject); return; }
            I = this;
            // Match the web build: 60 fps cap (sim is fixed 60 Hz; rendering above it
            // just shows duplicate sim states as judder on high-refresh displays).
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = 60;
        }

        void Start()
        {
            State.TransitionTo(GamePhase.Title);
        }

        void OnDestroy() { if (I == this) { I = null; GameEvents.Reset(); } }

        void Update()
        {
            float rawDt = Mathf.Min(Time.deltaTime, Tuning.MaxRawDt);
            State.Tick(rawDt);

            switch (State.Phase)
            {
                case GamePhase.Title:
                case GamePhase.Paused:
                    return; // sim frozen; UI handles input for transitions

                case GamePhase.Playing:
                case GamePhase.Tutorial:
                    _accumulator += rawDt;
                    int safety = 8;
                    while (_accumulator >= Tuning.FixedDt && safety-- > 0)
                    {
                        SimTick(Tuning.FixedDt);
                        _accumulator -= Tuning.FixedDt;
                    }
                    break;

                case GamePhase.Dead:
                    _deathTimer += rawDt;
                    break;
            }
            // Variable-rate visual work (camera FOV lerp, shake, water, sun) runs in
            // each system's own Update()/LateUpdate on rawDt — matching the JS split.
        }

        // ── Fixed-step sim, explicit order (spec/01 §7.2) ──────────────────
        void SimTick(float dt)
        {
            var s = Session;
            _killedThisFrame = false;
            s.Elapsed += dt;

            float eff = s.EffectiveSpeed;

            Ship.SimTick(dt);                                    // 3-11: input→velX→shipX, bank, roll, hover
            Camera.SimTick(dt);                                  // 5: pivot follow (fixed part)

            if (!s.IntroActive)
                s.Distance += eff * dt;

            // Score accumulation (playerScore per frame)
            if (!s.IntroActive)
                s.PlayerScore += Tuning.ScoreRatePerSec * Mathf.Max(1f, s.Speed / Tuning.BaseSpeed) * dt;

            if (s.InvincibleTimer > 0f) s.InvincibleTimer = Mathf.Max(0f, s.InvincibleTimer - dt);
            if (s.RestBeat > 0f) s.RestBeat -= dt;
            if (s.PostLaunchGrace > 0f) s.PostLaunchGrace -= dt;

            Waves.SimTick(dt);                                   // 16: DR sequencer
            Canyon.SimTick(dt);                                  // 16: canyon slabs + collision
            if (_killedThisFrame) return;
            SineCorridor.SimTick(dt);                            // 16: L3/L4/L5 row spawners
            Zipper.SimTick(dt);
            Slalom.SimTick(dt);
            AngledWalls.SimTick(dt);                             // walls move + OBB collision
            if (_killedThisFrame) return;
            Lightning.SimTick(dt);
            if (_killedThisFrame) return;

            // 17: random spawner gate
            if (CanSpawnWaves())
            {
                s.NextSpawnZ += eff * dt;
                if (s.NextSpawnZ >= 0f)
                {
                    float baseZ = Obstacles.CurrentSpawnZBase();
                    s.NextSpawnZ = baseZ + (Random.value - 0.5f) * 10f;
                    Obstacles.SpawnWave();
                }
            }

            Obstacles.SimTick(dt);                               // 18: move + fade + collision + near-miss
            if (_killedThisFrame) return;
            Pickups.SimTick(dt);                                 // 19: coins/powerups move + magnet + collect
        }

        bool CanSpawnWaves()
        {
            var s = Session;
            return !s.IntroActive
                && s.PostLaunchGrace <= 0f
                && s.RestBeat <= 0f
                && !s.AnyCorridorActive
                && !s.ZipperActive
                && !s.SlalomActive
                && !s.AngledWallsActive
                && Waves.SpawnMode != SpawnMode.None;
        }

        // ── Flow control ───────────────────────────────────────────────────
        public void StartRun(bool skipIntro = false)
        {
            if (State.Phase != GamePhase.Title && State.Phase != GamePhase.Dead) return;

            Session.ResetForNewRun();
            ResetAllSystems();

            if (!State.TransitionTo(GamePhase.Playing)) return;

            // Launch choreography: takeoff lift → post-launch grace.
            Session.IntroLiftActive = true;
            Session.IntroLiftT = 0f;
            Session.PostLaunchGrace = Tuning.IntroLiftDur + Tuning.PostLaunchGrace;
            Camera.OnRunStart(skipIntro);
            GameEvents.RaiseRunStarted();
        }

        public void RetryRun()
        {
            if (State.Phase != GamePhase.Dead) return;
            _deathTimer = 0f;
            StartRun(skipIntro: true);
            Camera.PlayRetrySweep();
        }

        public void TogglePause()
        {
            if (State.Phase == GamePhase.Playing) State.TransitionTo(GamePhase.Paused);
            else if (State.Phase == GamePhase.Paused) State.TransitionTo(GamePhase.Playing);
        }

        public void ReturnToTitle()
        {
            if (State.TransitionTo(GamePhase.Title))
            {
                Session.ResetForNewRun();
                ResetAllSystems();
                Camera.ResetToTitle();
            }
        }

        void ResetAllSystems()
        {
            Ship.ResetSystem(); Camera.ResetSystem(); Waves.ResetSystem();
            Canyon.ResetSystem(); SineCorridor.ResetSystem(); Zipper.ResetSystem();
            Slalom.ResetSystem(); AngledWalls.ResetSystem(); Lightning.ResetSystem();
            Obstacles.ResetSystem(); Pickups.ResetSystem();
        }

        /// <summary>killPlayer() port — resolution order per spec/01 §4.6 (no shields yet: 1:1 minus meta).</summary>
        public void KillPlayer()
        {
            var s = Session;
            if (State.Phase != GamePhase.Playing) return;      // duplicate-frame guard
            if (s.InvincibleTimer > 0f) return;                 // grace absorbs

            _killedThisFrame = true;
            _deathTimer = 0f;

            // Final score: playerScore × distance bonus
            float distBonus = Mathf.Max(1f, 1f + Mathf.Floor(s.Distance / 5000f) * 0.1f);
            s.PlayerScore = Mathf.Floor(s.PlayerScore) * distBonus;

            State.TransitionTo(GamePhase.Dead);
            Camera.OnPlayerDied(new Vector3(s.ShipX, s.ShipY, Tuning.ShipZ));
            GameEvents.RaisePlayerDied();
        }

        /// <summary>Seconds since death — UI shows game-over after Tuning.GameOverDelay.</summary>
        public float DeathTimer => _deathTimer;
    }
}
