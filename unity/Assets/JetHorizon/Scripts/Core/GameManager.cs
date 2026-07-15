using System;
using UnityEngine;
using JetHorizon.Simulation;
using JetHorizon.Application;
using JetHorizon.Platform;

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
        public PowerupPresentationSystem PowerupPresentation;
        public ShipSkinController ShipSkins;

        public readonly GameStateMachine State = new GameStateMachine();
        public RunSession Session { get; private set; } = new RunSession();

        float _accumulator;
        float _deathTimer;
        bool  _killedThisFrame;   // JS `return` after killPlayer aborts remaining checks
        JetHorizonSimulation _coreSimulation;
        RunEventRouter _applicationEvents;
        static long _lastIssuedRunId;

        public GamePhase Phase => State.Phase;
        /// <summary>Viewer toggle: gameplay continues, but every lethal collision is suppressed.</summary>
        public bool GodMode { get; private set; }
        public SimulationSnapshot CoreSnapshot => _coreSimulation?.Snapshot;
        public SimulationEventBuffer CoreEvents => _coreSimulation?.Events;
        public StageCommandBuffer CoreStageCommands => _coreSimulation?.StageCommands;
        public RunCompletionOutcome? LastCompletion => _applicationEvents?.LastCompletion;

        void Awake()
        {
            if (I != null && I != this) { Destroy(gameObject); return; }
            I = this;
            var runDefinition = SequenceAsset.Load().ToCoreDefinition();
            _coreSimulation = new JetHorizonSimulation(new SimulationConfig
            {
                // The core owns live ship, progression, stages, random wave decisions,
                // registered hazards, and coin-pattern decisions. Unity presents snapshots.
                ProgressionEnabled = true,
                HazardSpawningEnabled = true,
                HazardSimulationEnabled = true,
                CollisionEnabled = true,
                InitialSpawnDistance = 5f,
                SpawnIntervalDistance = 30f,
                MaxHazards = 600,
                MaxPickups = 128
            }, 20260714u, runDefinition);
            _applicationEvents = new RunEventRouter(UnityGameServicesFactory.CreateDefault());
            // Match the web build: 60 fps cap (sim is fixed 60 Hz; rendering above it
            // just shows duplicate sim states as judder on high-refresh displays).
            QualitySettings.vSyncCount = 0;
            UnityEngine.Application.targetFrameRate = 60;
        }

        void Start()
        {
            // The scene's serialized transforms are only authoring defaults. Initialize
            // the title presentation through the same reset paths used by StartRun so
            // the title is an honest preview of the gameplay camera and ship framing.
            Ship?.ResetSystem();
            Camera?.ResetSystem();
            if (PowerupPresentation == null)
                PowerupPresentation = gameObject.GetComponent<PowerupPresentationSystem>() ?? gameObject.AddComponent<PowerupPresentationSystem>();
            PowerupPresentation.ShipRoot = Ship != null ? Ship.ShipRoot : null;
            PowerupPresentation.ResetSystem();
            if (ShipSkins == null)
                ShipSkins = gameObject.GetComponent<ShipSkinController>() ?? gameObject.AddComponent<ShipSkinController>();
            ShipSkins.Initialize(Ship != null ? Ship.ShipRoot : null);
            State.TransitionTo(GamePhase.Title);
        }

        void OnDestroy() { if (I == this) { I = null; GameEvents.Reset(); } }

        void Update()
        {
            // The simulation has its own explicit pause phase. Unscaled host time keeps
            // Unity timeScale changes from silently altering deterministic gameplay.
            float rawDt = Mathf.Min(Time.unscaledDeltaTime, Tuning.MaxRawDt);
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
            TickCoreShip(dt);                                    // engine-neutral input→snapshot→Unity presentation
            if (_killedThisFrame) return;
            Camera.SimTick(dt);                                  // 5: pivot follow (fixed part)

            if (s.InvincibleTimer > 0f) s.InvincibleTimer = Mathf.Max(0f, s.InvincibleTimer - dt);
            if (!(_coreSimulation?.Snapshot.StageDirectorEnabled ?? false) && s.RestBeat > 0f)
                s.RestBeat -= dt;
            if (s.PostLaunchGrace > 0f) s.PostLaunchGrace -= dt;

            Waves.SimTick(dt);                                   // 16: DR sequencer
            Canyon.SimTick(dt);                                  // 16: canyon slabs + collision
            if (_killedThisFrame) return;
            AngledWalls.SimTick(dt);                             // walls move + OBB collision
            if (_killedThisFrame) return;
            Lightning.SimTick(dt);
            if (_killedThisFrame) return;

            Obstacles.SimTick(dt);                               // 18: move + fade + collision + near-miss
            if (_killedThisFrame) return;
            Pickups.SimTick(dt);                                 // 19: coins/powerups move + magnet + collect
            PowerupPresentation?.SimTick(dt);                    // 20: snapshot/event-driven hero VFX
        }

        void TickCoreShip(float dt)
        {
            if (_coreSimulation == null || Ship == null)
            {
                Ship?.SimTick(dt);
                return;
            }

            _coreSimulation.SetSpeed(Session.Speed);
            var s = Session;
            var input = Ship.Input;
            // Unity's gameplay camera faces -Z, making screen-left world +X. The adapter
            // swaps left/right so the engine-neutral core keeps conventional coordinates.
            var frame = input == null
                ? default
                : new InputFrame(input.SteerRight, input.SteerLeft, input.RollHeld ? input.RollDir : 0);
            var world = new WorldFrame(s.IntroActive || s.IntroLiftActive, s.OverdriveActive)
            {
                CanyonActive = s.CanyonActive,
                CanyonExiting = s.CanyonExiting,
                SineCorridorActive = s.SineCorridorActive,
                ZipperActive = s.ZipperActive,
                SlalomActive = s.SlalomActive,
                AngledWallsActive = s.AngledWallsActive,
                CollisionSuppressed = GodMode || s.InvincibleTimer > 0f || s.IntroActive || s.IntroLiftActive,
                SpawningSuppressed = s.IntroActive || s.IntroLiftActive || s.PostLaunchGrace > 0f,
                ShipMovementSuppressed = s.IntroActive || s.IntroLiftActive
            };
            if (Canyon != null && Canyon.TryGetCollisionBounds(out float leftBoundary, out float rightBoundary))
            {
                world.CorridorCollisionActive = true;
                world.CorridorLeftBoundary = leftBoundary;
                world.CorridorRightBoundary = rightBoundary;
            }
            world.HazardsClear = (Obstacles == null || Obstacles.ActiveHazardCount == 0)
                && !world.AnyStructuredMechanicActive;
            _coreSimulation.Step(frame, world);

            var snapshot = _coreSimulation.Snapshot;
            SyncCoreSession(snapshot);
            Session.RollHeld = input != null && input.RollHeld;
            Session.RollDir = input != null ? input.RollDir : 0;
            Ship.ApplyCorePresentation(snapshot, dt);
            DispatchCorePresentationEvents();
            if (snapshot.Phase == CoreGamePhase.Dead)
            {
                FinishPlayerDeath(coreAlreadyDead: true);
                return;
            }
            _applicationEvents.Dispatch(_coreSimulation.Events);
        }

        void SyncCoreSession(SimulationSnapshot snapshot = null)
        {
            snapshot ??= _coreSimulation?.Snapshot;
            if (snapshot == null) return;
            Session.Elapsed = snapshot.Elapsed;
            Session.Distance = snapshot.Distance;
            Session.Score = snapshot.Score;
            Session.Speed = snapshot.Speed;
            if (snapshot.StageDirectorEnabled)
            {
                Session.SpeedFloor = snapshot.SpeedFloor;
                Session.RestBeat = snapshot.RestBeat;
                Session.PhysTier = snapshot.PhysicsTier;
            }
            Session.ShipX = snapshot.ShipX;
            Session.ShipY = snapshot.ShipY;
            Session.ShipVelX = snapshot.ShipVelocityX;
            Session.RollAngle = snapshot.ShipRollRadians;
            Session.BankRoll = snapshot.ShipBankRadians;
            Session.TiltTimer = snapshot.ShipTiltTimer;
            Session.ShieldTimer = snapshot.ShieldSeconds;
            Session.ShieldHits = snapshot.ShieldHits;
            Session.LaserTimer = snapshot.LaserSeconds;
            Session.OverdriveTimer = snapshot.OverdriveSeconds;
            Session.OverdriveSpeedTimer = snapshot.OverdriveSpeedSeconds;
            Session.OverdriveActive = snapshot.OverdriveSpeedSeconds > 0f;
            Session.MagnetTimer = snapshot.MagnetSeconds;
            Session.SineCorridorActive = snapshot.SineCorridorActive;
            Session.ZipperActive = snapshot.ZipperActive;
            Session.SlalomActive = snapshot.SlalomActive;
            Session.AngledWallsActive = snapshot.AngledWallsActive;
            if (snapshot.SineCorridorActive || snapshot.SlalomActive)
                Session.CorridorGapCenter = snapshot.CorridorGapCenter;
        }

        public void ReportNearMiss()
        {
            _coreSimulation?.AwardScore(Tuning.NearMissScore, ScoreSource.NearMiss);
            SyncCoreSession();
            GameEvents.RaiseNearMiss();
        }

        public void ReportCoinCollected()
        {
            _coreSimulation?.AwardScore(Tuning.CoinScore, ScoreSource.Pickup);
            SyncCoreSession();
            GameEvents.RaiseCoinCollected();
        }

        public int RegisterHazard(HazardSpawn spawn) => _coreSimulation?.RegisterHazard(spawn) ?? 0;
        public bool RemoveHazard(int id) => _coreSimulation != null && _coreSimulation.RemoveHazard(id);
        public void ClearRegisteredHazards() => _coreSimulation?.ClearHazards();
        public int RegisterPickup(PickupSpawn spawn) => _coreSimulation?.RegisterPickup(spawn) ?? 0;
        public void ClearRegisteredPickups() => _coreSimulation?.ClearPickups();

        void DispatchCorePresentationEvents()
        {
            var events = _coreSimulation?.Events;
            if (events == null) return;
            for (int i = 0; i < events.Count; i++)
            {
                switch (events[i].Type)
                {
                    case SimulationEventType.NearMiss:
                        GameEvents.RaiseNearMiss();
                        break;
                    case SimulationEventType.PickupCollected:
                        GameEvents.RaiseCoinCollected();
                        break;
                    case SimulationEventType.PowerupCollected:
                        GameEvents.RaisePowerupCollected((PowerupType)(int)events[i].ValueA);
                        break;
                    case SimulationEventType.PowerupActivated:
                        GameEvents.RaisePowerupActivated((PowerupType)(int)events[i].ValueA, events[i].ValueB);
                        break;
                    case SimulationEventType.PowerupExpired:
                        GameEvents.RaisePowerupExpired((PowerupType)(int)events[i].ValueA);
                        break;
                    case SimulationEventType.ShieldHit:
                        GameEvents.RaiseShieldHit((int)events[i].ValueA);
                        break;
                    case SimulationEventType.ShieldBroken:
                        GameEvents.RaiseShieldBroken();
                        break;
                    case SimulationEventType.LaserFired:
                        GameEvents.RaiseLaserFired(events[i].ValueA);
                        break;
                }
            }
        }

        // ── Flow control ───────────────────────────────────────────────────
        public void StartRun(bool skipIntro = false)
        {
            if (State.Phase != GamePhase.Title && State.Phase != GamePhase.Dead) return;

            Session.ResetForNewRun();
            _accumulator = 0f;
            _coreSimulation.StartRun(IssueRunId());
            if (GodMode)
                _coreSimulation.MarkLeaderboardIneligible(LeaderboardIneligibility.GodMode);
            _applicationEvents.Dispatch(_coreSimulation.Events);
            SyncCoreSession();
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
            if (State.Phase == GamePhase.Playing)
            {
                if (State.TransitionTo(GamePhase.Paused))
                {
                    _accumulator = 0f;
                    _coreSimulation?.SetPaused(true);
                }
            }
            else if (State.Phase == GamePhase.Paused)
            {
                if (State.TransitionTo(GamePhase.Playing))
                {
                    _accumulator = 0f;
                    _coreSimulation?.SetPaused(false);
                }
            }
        }

        public void ReturnToTitle()
        {
            if (State.TransitionTo(GamePhase.Title))
            {
                _accumulator = 0f;
                Session.ResetForNewRun();
                _coreSimulation.ResetToTitle();
                SyncCoreSession();
                ResetAllSystems();
                Camera.ResetToTitle();
            }
        }

        /// <summary>Enables or disables uninterrupted viewer mode without changing simulation speed.</summary>
        public void SetGodMode(bool enabled)
        {
            GodMode = enabled;
            if (enabled)
            {
                Session.InvincibleTimer = Mathf.Max(Session.InvincibleTimer, Tuning.FixedDt * 2f);
                if (State.Phase == GamePhase.Playing)
                    _coreSimulation?.MarkLeaderboardIneligible(LeaderboardIneligibility.GodMode);
            }
        }

        public void ToggleGodMode() => SetGodMode(!GodMode);

        void ResetAllSystems()
        {
            Ship.ResetSystem(); Camera.ResetSystem(); Waves.ResetSystem();
            Canyon.ResetSystem(); SineCorridor.ResetSystem(); Zipper.ResetSystem();
            Slalom.ResetSystem(); AngledWalls.ResetSystem(); Lightning.ResetSystem();
            Obstacles.ResetSystem(); Pickups.ResetSystem();
            PowerupPresentation?.ResetSystem();
        }

        /// <summary>killPlayer() port — resolution order per spec/01 §4.6 (no shields yet: 1:1 minus meta).</summary>
        public void KillPlayer()
        {
            FinishPlayerDeath(coreAlreadyDead: false);
        }

        void FinishPlayerDeath(bool coreAlreadyDead)
        {
            var s = Session;
            if (State.Phase != GamePhase.Playing) return;      // duplicate-frame guard
            if (GodMode) return;                                // viewer mode never ends the run
            if (s.InvincibleTimer > 0f) return;                 // grace absorbs
            if (_coreSimulation != null && _coreSimulation.TryAbsorbExternalHit())
            {
                SyncCoreSession();
                DispatchCorePresentationEvents();
                return;
            }

            _killedThisFrame = true;
            _deathTimer = 0f;
            if (!coreAlreadyDead) _coreSimulation?.ForcePlayerDeath();
            if (_coreSimulation != null)
                _applicationEvents.Dispatch(_coreSimulation.Events, _coreSimulation.LatestRunResult);
            SyncCoreSession();

            State.TransitionTo(GamePhase.Dead);
            Camera.OnPlayerDied(new Vector3(s.ShipX, s.ShipY, Tuning.ShipZ));
            GameEvents.RaisePlayerDied();
        }

        /// <summary>Seconds since death — UI shows game-over after Tuning.GameOverDelay.</summary>
        public float DeathTimer => _deathTimer;

        static long IssueRunId()
        {
            long candidate = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if (candidate <= _lastIssuedRunId) candidate = _lastIssuedRunId + 1L;
            _lastIssuedRunId = candidate;
            return candidate;
        }
    }
}
