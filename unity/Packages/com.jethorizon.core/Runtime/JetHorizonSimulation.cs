using System;

namespace JetHorizon.Simulation
{
    /// <summary>
    /// First engine-neutral vertical slice: fixed-step ship movement, roll-aware collision,
    /// deterministic standard-hazard spawning, scoring, near misses, and death.
    /// </summary>
    public sealed class JetHorizonSimulation
    {
        struct HazardState
        {
            public bool Active;
            public bool NearMissArmed;
            public int Id;
            public HazardKind Kind;
            public HazardStyle Style;
            public HazardRole Role;
            public int VisualVariant;
            public float X;
            public float Y;
            public float Z;
            public float HalfWidth;
            public float HalfHeight;
            public float HalfDepth;
            public float VisualScale;
            public float VisualScaleY;
            public float VisualScaleZ;
            public float RotationXRadians;
            public float RotationYRadians;
            public float RotationZRadians;
            public float RingRadius;
            public float RingTubeRadius;
            public float VelocityX;
            public float VelocityY;
            public float VelocityZ;
            public float AgeSeconds;
            public float CollisionDelaySeconds;
            public float LifetimeSeconds;
        }

        struct PickupState
        {
            public bool Active;
            public int Id;
            public PickupKind Kind;
            public PowerupType Powerup;
            public RunCargoKind CargoKind;
            public PickupMotionKind MotionKind;
            public int CargoUnits;
            public float X;
            public float Y;
            public float Z;
            public float ScoreValue;
            public float CollectHalfWidth;
            public float CollectHalfDepth;
            public float VelocityX;
            public float VelocityY;
            public float VelocityZ;
            public float AgeSeconds;
            public float AttractionDelaySeconds;
        }

        struct CorridorSliceState
        {
            public bool Active;
            public int Id;
            public CorridorFamily Family;
            public int RowIndex;
            public float CenterX;
            public float HalfWidth;
            public float Z;
            public CanyonEnvironmentPhase EnvironmentPhase;
            public bool CorridorBoundaryActive;
            public TraversalRequirement TraversalRequirement;
        }

        readonly SimulationConfig _config;
        readonly uint _seed;
        readonly DeterministicRandom _random;
        readonly HazardState[] _hazards;
        readonly PickupState[] _pickups;
        readonly RunCargoLedger _cargo;
        readonly CorridorSliceState[] _corridorSlices;
        readonly StageDirector _stageDirector;
        readonly ShipCapabilityProfile _shipCapability;
        readonly ProofEncounterRuntime _proofEncounters;
        readonly TerrainWorldRuntime _terrainWorld;
        readonly SectorRunRuntime _gateRun;
        readonly RunParcelCommandBuffer _runParcelCommands;
        readonly EnvironmentEncounterRuntime _environmentEncounter;
        readonly EncounterCommandBuffer _encounterCommands;
        readonly LightningSequenceRuntime _lightningSequences;
        readonly LightningStrikeRequestBuffer _lightningStrikeRequests;
        readonly AsteroidSequenceRuntime _asteroidSequences;
        readonly AsteroidImpactRequestBuffer _asteroidImpactRequests;
        readonly HazardPatternScheduler _hazardPatternScheduler;
        readonly ScheduledHazardPatternRequestBuffer _scheduledHazardRequests;
        readonly int[] _laneScratch;
        readonly int[] _blockedLaneScratch;

        long _tick;
        long _eligibleRunTick;
        long _fallbackRunId;
        long _runId;
        float _elapsed;
        float _distance;
        double _score;
        float _speed;
        float _effectiveSpeed;
        RunPaceState _paceState;
        bool _hasExternalSpeed;
        float _externalSpeed;
        float _shipX;
        float _shipY;
        float _shipVelocityX;
        float _rollRadians;
        float _tiltTimer;
        float _bankVelocityX;
        float _bankRadians;
        float _bobSteerBlend;
        float _distanceUntilSpawn;
        int _nextEntityId;
        int _wavesSinceCoin;
        int _wavesSincePowerup;
        int _wavesSinceCargo;
        int _heatLevel;
        bool _extractionWindowOpen;
        float _nextExtractionDistance;
        float _extractionWindowEndDistance;
        int _nextPowerupType;
        float _shieldSeconds;
        int _shieldHits;
        int _hullHitsRemaining;
        float _laserSeconds;
        float _laserShotTimer;
        bool _laserFormationActive;
        bool _laserFormationOverloaded;
        int _laserFormationId;
        int _laserFormationRemaining;
        int _laserFormationDestroyed;
        int _laserDestructionChain;
        float _laserChainTimer;
        float _laserFormationCenterX;
        float _overdriveSeconds;
        float _magnetSeconds;
        CorridorFamily _lightningFamily;
        float _lightningTimer;
        bool _zipperActive;
        int _zipperRowsLeft;
        int _zipperRowsTotal;
        int _zipperSide;
        float _zipperTimer;
        bool _slalomActive;
        bool _slalomFirstRow;
        int _slalomRowsLeft;
        float _slalomGapWidth;
        float _slalomDistanceUntilRow;
        float _slalomGapCenter;
        float _slalomGapVelocity;
        bool _sineCorridorActive;
        SineCorridorDefinition _sineCorridor;
        int _sineRowsDone;
        float _sineSpawnZ;
        float _sinePhase;
        float _sineAnchor;
        float _sineDelaySeconds;
        float _sineGapCenter;
        readonly StructuredWallFieldDefinition _structuredWallField;
        bool _structuredWallsActive;
        bool _structuredWallsScheduling;
        int _structuredWallRowsDone;
        float _structuredWallSpawnZ;
        int _repairCount;
        LeaderboardIneligibility _leaderboardIneligibility;
        bool _automaticExtractionPending;
        RunCargoManifest _automaticExtractionManifest;
        float _patternSafeCenterX;
        float _patternSafeHalfWidth;
        int _heroEncountersCompleted;
        bool _environmentCompletionScored;

        public CoreGamePhase Phase { get; private set; }
        public SimulationSnapshot Snapshot { get; }
        public SimulationEventBuffer Events { get; }
        public StageCommandBuffer StageCommands { get; }
        public SimulationConfig Config => _config.Clone();
        public float FixedDeltaSeconds => _config.FixedDeltaSeconds;
        public RunResult LatestRunResult { get; private set; }

        public JetHorizonSimulation(SimulationConfig config, uint seed, RunDefinition runDefinition = null)
        {
            if (config == null) throw new ArgumentNullException(nameof(config));
            config.Validate();
            _config = config.Clone();
            _seed = seed;
            _random = new DeterministicRandom(seed);
            _hazards = new HazardState[_config.MaxHazards];
            _pickups = new PickupState[_config.MaxPickups];
            _cargo = new RunCargoLedger(_config.CargoCapacity);
            _corridorSlices = new CorridorSliceState[_config.MaxCorridorSlices];
            _stageDirector = _config.ProofEncounterMode || _config.GateRunMode || _config.TerrainWorldMode || runDefinition == null
                ? null
                : new StageDirector(runDefinition);
            _shipCapability = ShipCapabilityProfile.FromConfig(_config);
            _proofEncounters = _config.ProofEncounterMode
                ? new ProofEncounterRuntime(
                    EncounterPlanCatalog.CreateProofSequence(
                        _shipCapability.CruiseSpeed / 42f,
                        _config.CanyonPathOverride),
                    _shipCapability)
                : null;
            _gateRun = _config.GateRunMode
                ? new SectorRunRuntime(_shipCapability, _random)
                : null;
            _terrainWorld = _config.TerrainWorldMode
                ? new TerrainWorldRuntime(_shipCapability)
                : null;
            _runParcelCommands = new RunParcelCommandBuffer(32);
            _environmentEncounter = new EnvironmentEncounterRuntime(
                EncounterPlanCatalog.CreateProofSequence(
                    _shipCapability.CruiseSpeed / 42f,
                    _config.CanyonPathOverride));
            // A complete canyon publishes every validated route knot in one tick.
            // Keep command capacity derived from the same fixed corridor capacity,
            // with room for cargo/power-up dressing emitted alongside those knots.
            _encounterCommands = new EncounterCommandBuffer(Math.Max(64, _config.MaxCorridorSlices + 16));
            _lightningSequences = new LightningSequenceRuntime();
            _lightningStrikeRequests = new LightningStrikeRequestBuffer(16);
            _asteroidSequences = new AsteroidSequenceRuntime();
            _asteroidImpactRequests = new AsteroidImpactRequestBuffer(16);
            _hazardPatternScheduler = new HazardPatternScheduler();
            _scheduledHazardRequests = new ScheduledHazardPatternRequestBuffer(4);
            _structuredWallField = StructuredWallFieldCatalog.Production;
            _laneScratch = new int[_config.LaneCount];
            _blockedLaneScratch = new int[_config.LaneCount];
            Snapshot = new SimulationSnapshot(
                _config.MaxHazards,
                _config.MaxPickups,
                _config.MaxCorridorSlices,
                _config.MaxGates,
                _config.MaxTerrainWorldSections,
                _config.MaxTerrainWorldFeatures);
            Events = new SimulationEventBuffer(64);
            StageCommands = new StageCommandBuffer(16);
            ResetToTitle();
        }

        public void ResetToTitle()
        {
            Phase = CoreGamePhase.Title;
            Events.Clear();
            StageCommands.Clear();
            ResetRunState(null);
            _shipY = _config.ShipPreLaunchY;
            RefreshSnapshot();
        }

        public void StartRun(long runId = 0L)
        {
            Events.Clear();
            StageCommands.Clear();
            ResetRunState(Events);
            _runId = runId > 0L ? runId : ++_fallbackRunId;
            Phase = CoreGamePhase.Playing;
            Events.Add(new SimulationEvent(SimulationEventType.RunStarted));
            RefreshSnapshot();
        }

        public void SetPaused(bool paused)
        {
            if (paused && Phase == CoreGamePhase.Playing) Phase = CoreGamePhase.Paused;
            else if (!paused && Phase == CoreGamePhase.Paused) Phase = CoreGamePhase.Playing;
            RefreshSnapshot();
        }

        /// <summary>
        /// Migration seam for specialized corridor presenters that still animate speed
        /// during entry/exit. The stage director remains authoritative outside corridors.
        /// </summary>
        public void SetSpeed(float speed)
        {
            if (float.IsNaN(speed) || float.IsInfinity(speed))
                throw new ArgumentOutOfRangeException(nameof(speed));
            _externalSpeed = Math.Max(0f, speed);
            _hasExternalSpeed = true;
            _speed = _externalSpeed;
            _stageDirector?.SetExternalSpeed(_speed);
            RefreshSnapshot();
        }

        public void ForcePlayerDeath()
        {
            Events.Clear();
            if (Phase == CoreGamePhase.Dead) return;
            FinalizeRun();
            Phase = CoreGamePhase.Dead;
            Events.Add(new SimulationEvent(SimulationEventType.PlayerDied, 0, (float)_score, _distance));
            RefreshSnapshot();
        }

        public bool TryExtract(out RunCargoManifest manifest)
        {
            Events.Clear();
            if (Phase != CoreGamePhase.Playing || !_extractionWindowOpen)
            {
                manifest = default;
                RefreshSnapshot();
                return false;
            }

            manifest = _cargo.Snapshot(_heatLevel, HeatRewardMultiplier());
            FinalizeRun(RunCompletionReason.Extracted);
            Phase = CoreGamePhase.Extracted;
            Events.Add(new SimulationEvent(SimulationEventType.RunExtracted, 0, manifest.TotalWeight, manifest.CreditValue));
            RefreshSnapshot();
            return true;
        }

        /// <summary>Resolves the terrain-run breather choice and next deterministic sector.</summary>
        public bool TryResolveExtractionDecision(bool extract, out RunCargoManifest manifest)
        {
            Events.Clear();
            manifest = default;
            bool decisionOpen = _terrainWorld != null
                ? _terrainWorld.ExtractionDecisionOpen
                : _gateRun != null && _gateRun.ExtractionDecisionOpen;
            if (Phase != CoreGamePhase.Playing || !decisionOpen)
            {
                RefreshSnapshot();
                return false;
            }

            if (extract)
            {
                bool accepted = _terrainWorld != null
                    ? _terrainWorld.TryAcceptExtraction(Events)
                    : _gateRun.TryAcceptExtraction(Events);
                if (!accepted)
                {
                    RefreshSnapshot();
                    return false;
                }
                manifest = _cargo.Snapshot(_heatLevel, HeatRewardMultiplier());
                FinalizeRun(RunCompletionReason.Extracted);
                Phase = CoreGamePhase.Extracted;
                Events.Add(new SimulationEvent(
                    SimulationEventType.RunExtracted,
                    0,
                    manifest.TotalWeight,
                    manifest.CreditValue));
                RefreshSnapshot();
                return true;
            }

            bool continued = _terrainWorld != null
                ? _terrainWorld.TryContinueDeeper(_distance, Events)
                : _gateRun.TryContinueDeeper(
                    _distance,
                    _paceState.PersistentCruiseSpeed,
                    Events);
            if (!continued)
            {
                RefreshSnapshot();
                return false;
            }

            _heatLevel = _terrainWorld != null ? _terrainWorld.Heat : _gateRun.Heat;
            float nextDecision = _terrainWorld != null
                ? _terrainWorld.Snapshot.ExtractionDistance
                : _gateRun.Snapshot.NextGateDistance;
            Events.Add(new SimulationEvent(
                SimulationEventType.ExtractionWindowPassed,
                _heatLevel,
                nextDecision,
                HeatRewardMultiplier()));
            Events.Add(new SimulationEvent(
                SimulationEventType.HeatChanged,
                _heatLevel,
                1f,
                HeatRewardMultiplier()));
            RefreshSnapshot();
            return true;
        }

        /// <summary>Consumes the manifest produced by crossing the core-owned world-space extraction gate.</summary>
        public bool TryConsumeAutomaticExtraction(out RunCargoManifest manifest)
        {
            if (!_automaticExtractionPending)
            {
                manifest = default;
                return false;
            }
            manifest = _automaticExtractionManifest;
            _automaticExtractionPending = false;
            return true;
        }

        float HeatRewardMultiplier() => 1f + _heatLevel * _config.HeatRewardPerLevel;
        float HeatSpeedMultiplier() => 1f + _heatLevel * _config.HeatSpeedPerLevel;
        float EncounterIntensity() => 1f + _heatLevel * _config.HeatEncounterIntensityPerLevel;
        float OverdriveSpeedMultiplier() => 1f + (PowerupCatalog.OverdriveSpeedMultiplier - 1f) * _config.OverdrivePowerMultiplier;

        void TickExtractionWindows()
        {
            if (!_extractionWindowOpen && _distance >= _nextExtractionDistance)
            {
                _extractionWindowOpen = true;
                _extractionWindowEndDistance = _nextExtractionDistance + _config.ExtractionWindowLengthDistance;
                Events.Add(new SimulationEvent(
                    SimulationEventType.ExtractionWindowOpened,
                    _heatLevel,
                    _extractionWindowEndDistance,
                    HeatRewardMultiplier()));
            }

            if (!_extractionWindowOpen || _distance <= _extractionWindowEndDistance) return;

            _extractionWindowOpen = false;
            _heatLevel = Math.Min(_config.MaximumHeat, _heatLevel + 1);
            _nextExtractionDistance += _config.ExtractionIntervalDistance;
            Events.Add(new SimulationEvent(
                SimulationEventType.ExtractionWindowPassed,
                _heatLevel,
                _nextExtractionDistance,
                HeatRewardMultiplier()));
            Events.Add(new SimulationEvent(
                SimulationEventType.HeatChanged,
                _heatLevel,
                HeatSpeedMultiplier(),
                HeatRewardMultiplier()));
        }

        /// <summary>Marks the active run as ineligible without changing deterministic gameplay.</summary>
        public void MarkLeaderboardIneligible(LeaderboardIneligibility reason)
        {
            if (reason == LeaderboardIneligibility.None || Phase == CoreGamePhase.Dead) return;
            _leaderboardIneligibility |= reason;
        }

        /// <summary>
        /// Development-only caller seam for previewing an authored proof encounter.
        /// The encounter runtime remains authoritative for streaming and validation.
        /// </summary>
        public bool DebugJumpToProofEncounter(EncounterKind kind)
        {
            if (Phase != CoreGamePhase.Playing) return false;
            if (_terrainWorld != null)
            {
                TerrainRegionKind region = kind == EncounterKind.PrismaticSineCorridor
                    ? TerrainRegionKind.PrismaticReach
                    : kind == EncounterKind.CrystallineCanyon
                        ? TerrainRegionKind.CrystallineCanyon
                        : default;
                if ((kind != EncounterKind.PrismaticSineCorridor && kind != EncounterKind.CrystallineCanyon)
                    || !_terrainWorld.TryGetRegionStart(region, out float regionStart))
                    return false;
                _distance = Math.Max(_terrainWorld.World.StartDistance, regionStart - 70f);
                Array.Clear(_hazards, 0, _hazards.Length);
                Array.Clear(_pickups, 0, _pickups.Length);
                Array.Clear(_corridorSlices, 0, _corridorSlices.Length);
                _environmentEncounter.Reset();
                _shipX = 0f;
                _shipVelocityX = 0f;
                _bankVelocityX = 0f;
                _bankRadians = 0f;
                _leaderboardIneligibility |= LeaderboardIneligibility.DebugStart;
                RefreshSnapshot();
                return true;
            }
            if (_proofEncounters == null) return false;
            float previewLeadDistance = kind == EncounterKind.CrystallineCanyon ? 520f : 25f;
            if (!_proofEncounters.JumpTo(kind, _distance, _config.ShipZ, previewLeadDistance)) return false;

            Array.Clear(_hazards, 0, _hazards.Length);
            Array.Clear(_pickups, 0, _pickups.Length);
            Array.Clear(_corridorSlices, 0, _corridorSlices.Length);
            _encounterCommands.Clear();
            _shipX = 0f;
            _shipVelocityX = 0f;
            _bankVelocityX = 0f;
            _bankRadians = 0f;
            _leaderboardIneligibility |= LeaderboardIneligibility.DebugStart;
            RefreshSnapshot();
            return true;
        }

        /// <summary>Records source-parity repair policy: distance survives, score resets, leaderboard is disabled.</summary>
        public void RegisterRepair()
        {
            if (Phase != CoreGamePhase.Playing) return;
            _repairCount++;
            _leaderboardIneligibility |= LeaderboardIneligibility.RepairUsed;
            _score = 0d;
            Events.Add(new SimulationEvent(SimulationEventType.ScoreChanged, 0, 0f, (float)ScoreSource.Bonus));
            RefreshSnapshot();
        }

        public void AwardScore(float amount, ScoreSource source, int entityId = 0)
        {
            if (float.IsNaN(amount) || float.IsInfinity(amount) || amount < 0f)
                throw new ArgumentOutOfRangeException(nameof(amount));
            if (amount == 0f || Phase == CoreGamePhase.Dead) return;
            _score += amount;
            Events.Add(new SimulationEvent(SimulationEventType.ScoreChanged, entityId, (float)_score, (float)source));
            RefreshSnapshot();
        }

        public int RegisterHazard(HazardSpawn spawn)
        {
            if (Phase != CoreGamePhase.Playing) return 0;
            ValidateHazard(spawn);
            int id = SpawnHazard(spawn);
            RefreshSnapshot();
            return id;
        }

        public bool RemoveHazard(int id)
        {
            if (id <= 0) return false;
            for (int i = 0; i < _hazards.Length; i++)
            {
                if (!_hazards[i].Active || _hazards[i].Id != id) continue;
                if (_hazards[i].Role == HazardRole.LaserFormationTarget)
                    RetireLaserFormationTarget();
                _hazards[i].Active = false;
                RefreshSnapshot();
                return true;
            }
            return false;
        }

        public void ClearHazards()
        {
            Array.Clear(_hazards, 0, _hazards.Length);
            ResetLaserFormationState();
            RefreshSnapshot();
        }

        public int RegisterPickup(PickupSpawn spawn)
        {
            if (Phase != CoreGamePhase.Playing) return 0;
            ValidatePickup(spawn);
            int id = SpawnPickup(spawn);
            RefreshSnapshot();
            return id;
        }

        int SpawnPickup(PickupSpawn spawn)
        {
            int slot = -1;
            for (int i = 0; i < _pickups.Length; i++)
            {
                if (!_pickups[i].Active) { slot = i; break; }
            }
            if (slot < 0) return 0;

            int id = _nextEntityId++;
            _pickups[slot] = new PickupState
            {
                Active = true,
                Id = id,
                Kind = spawn.Kind,
                Powerup = spawn.Powerup,
                CargoKind = spawn.CargoKind,
                MotionKind = spawn.MotionKind,
                CargoUnits = spawn.CargoUnits,
                X = spawn.X,
                Y = spawn.Y,
                Z = spawn.Z,
                ScoreValue = spawn.ScoreValue,
                CollectHalfWidth = spawn.CollectHalfWidth,
                CollectHalfDepth = spawn.CollectHalfDepth,
                VelocityX = spawn.VelocityX,
                VelocityY = spawn.VelocityY,
                VelocityZ = spawn.VelocityZ,
                AgeSeconds = 0f,
                AttractionDelaySeconds = spawn.AttractionDelaySeconds
            };
            return id;
        }

        public void ClearPickups()
        {
            Array.Clear(_pickups, 0, _pickups.Length);
            RefreshSnapshot();
        }

        public void Step(InputFrame input)
        {
            Step(input, default);
        }

        public void Step(InputFrame input, WorldFrame world)
        {
            Events.Clear();
            StageCommands.Clear();
            if (Phase != CoreGamePhase.Playing)
            {
                RefreshSnapshot();
                return;
            }

            float dt = _config.FixedDeltaSeconds;
            _tick++;
            _elapsed = (float)(_tick * (double)dt);
            if ((_terrainWorld != null && _terrainWorld.ExtractionDecisionOpen)
                || (_gateRun != null && _gateRun.ExtractionDecisionOpen))
            {
                TickExtractionBreather(dt);
                RefreshSnapshot();
                return;
            }
            if (!world.ProgressionSuspended) _eligibleRunTick++;
            TickPowerups(dt);

            UpdateShip(input, dt, world.ShipMovementSuppressed);

            if (ResolveCorridorCollision(world))
            {
                RefreshSnapshot();
                return;
            }

            float encounterApproachModifier = 1f;
            if (_stageDirector != null)
            {
                world.SineCorridorActive = _sineCorridorActive;
                world.ZipperActive = _zipperActive;
                world.SlalomActive = _slalomActive;
                world.AngledWallsActive = _structuredWallsActive;
                _stageDirector.Tick(dt, world, _random, Events, StageCommands);
                encounterApproachModifier = _stageDirector.Speed
                    / Math.Max(0.001f, _config.BaseSpeed * _config.StartSpeedMultiplier);
                ApplyStageCommandsToCore();
                world.SineCorridorActive = _sineCorridorActive;
                world.ZipperActive = _zipperActive;
                world.SlalomActive = _slalomActive;
                world.AngledWallsActive = _structuredWallsActive;
            }
            else if (_proofEncounters != null)
            {
                encounterApproachModifier = _proofEncounters.CurrentApproachModifier;
            }

            float temporaryModifier = world.OverdriveActive || OverdriveSpeedActive
                ? OverdriveSpeedMultiplier()
                : 1f;
            if (_terrainWorld != null)
            {
                _paceState = RunPaceModel.Resolve(new RunPaceInput(
                    _config.BaseSpeed * _config.StartSpeedMultiplier,
                    _config.PersistentCruiseSpeedMultiplier,
                    1f,
                    encounterApproachModifier,
                    temporaryModifier,
                    _config.MinimumOperationalSpeed,
                    _terrainWorld.EarnedSpeedBonus,
                    _terrainWorld.SoftSpeedCap));
            }
            else if (_gateRun != null)
            {
                _paceState = RunPaceModel.Resolve(new RunPaceInput(
                    _config.BaseSpeed * _config.StartSpeedMultiplier,
                    _config.PersistentCruiseSpeedMultiplier,
                    1f,
                    encounterApproachModifier,
                    temporaryModifier,
                    _config.MinimumOperationalSpeed,
                    _gateRun.EarnedSpeedBonus,
                    _gateRun.SoftSpeedCap));
            }
            else if (_hasExternalSpeed && _stageDirector == null && _proofEncounters == null)
            {
                _paceState = RunPaceModel.Resolve(new RunPaceInput(
                    Math.Max(0.001f, _externalSpeed), 1f, HeatSpeedMultiplier(), 1f, temporaryModifier,
                    _config.MinimumOperationalSpeed));
            }
            else
            {
                _paceState = RunPaceModel.Resolve(new RunPaceInput(
                    _config.BaseSpeed * _config.StartSpeedMultiplier,
                    _config.PersistentCruiseSpeedMultiplier,
                    HeatSpeedMultiplier(),
                    encounterApproachModifier,
                    temporaryModifier,
                    _config.MinimumOperationalSpeed));
            }
            _speed = _paceState.CruiseSpeedBeforePowerup;
            _effectiveSpeed = _paceState.EffectiveSpeed;
            TickLightningSpawner(dt, world);
            TickScheduledHazardPatterns(dt);
            TickLightningSequences(dt);
            TickZipper(dt);
            TickSlalom(dt);
            TickSineCorridor(dt);
            if (ResolvePrismaticCorridorCollision(world))
            {
                RefreshSnapshot();
                return;
            }
            TickStructuredWalls(dt);

            float step = _effectiveSpeed * dt;
            if (_config.ProgressionEnabled && !world.ProgressionSuspended)
            {
                _distance += step;
                _score += _config.ScoreRatePerSecond * Math.Max(1f, _effectiveSpeed / _config.BaseSpeed) * HeatRewardMultiplier() * dt;
                if (_proofEncounters != null)
                {
                    ProofEncounterTickResult encounterResult = _proofEncounters.Tick(
                        _distance,
                        _shipX,
                        _heatLevel,
                        _paceState.PersistentCruiseSpeed * _paceState.DepthHeatModifier,
                        _config.ShipZ,
                        _encounterCommands);
                    ApplyProofEncounterCommands();
                    if (encounterResult == ProofEncounterTickResult.ContinuedDeeper)
                    {
                        _heatLevel = Math.Min(_config.MaximumHeat, _heatLevel + 1);
                        Events.Add(new SimulationEvent(
                            SimulationEventType.ExtractionWindowPassed,
                            _heatLevel,
                            _proofEncounters.Snapshot.ExtractionGateDistance,
                            HeatRewardMultiplier()));
                        Events.Add(new SimulationEvent(
                            SimulationEventType.HeatChanged,
                            _heatLevel,
                            HeatSpeedMultiplier(),
                            HeatRewardMultiplier()));
                    }
                    else if (encounterResult == ProofEncounterTickResult.Extracted)
                    {
                        CompleteAutomaticExtraction();
                        RefreshSnapshot();
                        return;
                    }
                }
                else if (_terrainWorld != null)
                {
                    TerrainWorldTickResult terrainResult = _terrainWorld.Tick(
                        _distance,
                        _shipX,
                        _rollRadians,
                        _config.RollMaxRadians,
                        !_config.CollisionEnabled || world.CollisionSuppressed || _overdriveSeconds > 0f,
                        Events);
                    _heatLevel = _terrainWorld.Heat;
                    if (terrainResult.CollisionEntered)
                    {
                        Events.Add(new SimulationEvent(
                            SimulationEventType.TerrainCollision,
                            terrainResult.CollisionEntityId,
                            terrainResult.CollisionCenterX,
                            (float)terrainResult.Region));
                        if (!ConsumeShieldHit(terrainResult.CollisionEntityId)
                            && !ConsumeHullHit(terrainResult.CollisionEntityId))
                        {
                            FinalizeRun();
                            Phase = CoreGamePhase.Dead;
                            Events.Add(new SimulationEvent(
                                SimulationEventType.PlayerDied,
                                terrainResult.CollisionEntityId,
                                (float)_score,
                                _distance));
                            RefreshSnapshot();
                            return;
                        }
                    }
                    if (terrainResult.BeginLightning)
                    {
                        _terrainWorld.GetActiveSafeWindow(out float safeCenter, out float safeHalfWidth);
                        _hazardPatternScheduler.BeginLightning(
                            LightningSequenceKind.Random,
                            Math.Min(_config.MaximumHeat, _heatLevel + 2),
                            safeCenter,
                            Math.Max(7f, safeHalfWidth * .62f));
                    }
                    if (terrainResult.BeginPrismatic)
                    {
                        _environmentEncounter.Activate(
                            RunEnvironmentKind.PrismaticCorridor,
                            _terrainWorld.CurrentRegionStartDistance);
                        Array.Clear(_corridorSlices, 0, _corridorSlices.Length);
                    }
                    if (_environmentEncounter.Active)
                    {
                        _environmentEncounter.Tick(_distance, _config.ShipZ, _encounterCommands);
                        ApplyProofEncounterCommands();
                    }
                    if (terrainResult.ExtractionDecisionOpened)
                    {
                        EnterExtractionBreather();
                        RefreshSnapshot();
                        return;
                    }
                }
                else if (_gateRun != null)
                {
                    GateRunTickResult gateResult = _gateRun.Tick(
                        _distance,
                        _shipX,
                        _config.ShipZ,
                        _paceState.PersistentCruiseSpeed,
                        _runParcelCommands,
                        Events);
                    _heatLevel = _gateRun.Heat;
                    ApplyRunParcelCommands();
                    if (gateResult.ScoreAward > 0f)
                    {
                        _score += gateResult.ScoreAward;
                        Events.Add(new SimulationEvent(
                            SimulationEventType.ScoreChanged,
                            0,
                            (float)_score,
                            (float)ScoreSource.Bonus));
                    }
                    if (gateResult.EnvironmentActivated)
                    {
                        _environmentEncounter.Activate(
                            gateResult.ActivatedEnvironment,
                            _distance + Math.Max(24f, _effectiveSpeed * .45f));
                        Array.Clear(_corridorSlices, 0, _corridorSlices.Length);
                        _environmentCompletionScored = false;
                    }
                    _environmentEncounter.Tick(_distance, _config.ShipZ, _encounterCommands);
                    ApplyProofEncounterCommands();
                    if (_environmentEncounter.Plan != null
                        && _environmentEncounter.Lifecycle == EnvironmentLifecycle.Retired)
                    {
                        if (!_environmentCompletionScored)
                        {
                            _environmentCompletionScored = true;
                            _heroEncountersCompleted++;
                            float heroScore = RunScoreModel.HeroEncounterCompletion(_environmentEncounter.Plan.Kind);
                            _score += heroScore;
                            Events.Add(new SimulationEvent(
                                SimulationEventType.ScoreChanged,
                                0,
                                (float)_score,
                                (float)ScoreSource.Bonus));
                        }
                        _gateRun.RetireEnvironment();
                    }
                    if (gateResult.ExtractionDecisionOpened)
                    {
                        EnterExtractionBreather();
                        RefreshSnapshot();
                        return;
                    }
                }
                else
                {
                    TickExtractionWindows();
                }
            }

            if (_config.HazardSpawningEnabled && _proofEncounters == null && _terrainWorld == null && _gateRun == null)
                TickWorldSpawner(step, world);

            if (_laserSeconds > 0f)
                TickLaserWeapon(dt);

            if (_config.HazardSimulationEnabled)
                UpdateHazards(step, world.CollisionSuppressed || _overdriveSeconds > 0f);

            if (_config.PickupSimulationEnabled && Phase == CoreGamePhase.Playing)
                UpdatePickups(step);

            RefreshSnapshot();
        }

        void ApplyProofEncounterCommands()
        {
            for (int i = 0; i < _encounterCommands.Count; i++)
            {
                EncounterCommand command = _encounterCommands[i];
                switch (command.Type)
                {
                    case EncounterCommandType.MonumentBarrierRow:
                        SpawnMonumentBarrier(command);
                        break;
                    case EncounterCommandType.CanyonSlice:
                        SpawnProofCorridorSlice(command, CorridorFamily.CrystallineCanyon);
                        break;
                    case EncounterCommandType.LightningStrikeCluster:
                        SpawnPlannedLightningCluster(command);
                        break;
                    case EncounterCommandType.PrismaticSlice:
                        SpawnProofCorridorSlice(command, CorridorFamily.L4Sine);
                        break;
                    case EncounterCommandType.Cargo:
                        SpawnPickup(PickupSpawn.Cargo(command.CargoKind, 1, command.X, 1.35f, command.Z));
                        break;
                    case EncounterCommandType.Powerup:
                        SpawnPickup(PickupSpawn.PowerupPickup(command.Powerup, command.X, 1.4f, command.Z));
                        break;
                    case EncounterCommandType.LaserFormation:
                        SpawnLaserFormation(command);
                        break;
                }
            }
        }

        void ApplyRunParcelCommands()
        {
            for (int i = 0; i < _runParcelCommands.Count; i++)
            {
                RunParcelCommand command = _runParcelCommands[i];
                switch (command.Type)
                {
                    case RunParcelCommandType.CargoTrail:
                        SpawnCargoTrail(command);
                        break;
                    case RunParcelCommandType.Powerup:
                        SpawnPickup(PickupSpawn.PowerupPickup(command.Powerup, command.X, 1.4f, command.Z));
                        break;
                    case RunParcelCommandType.LightningPattern:
                        _hazardPatternScheduler.BeginLightning(
                            command.LightningSequence,
                            _heatLevel,
                            command.SafeCenterX,
                            command.SafeHalfWidth);
                        break;
                    case RunParcelCommandType.AsteroidPattern:
                        _hazardPatternScheduler.BeginAsteroid(
                            command.AsteroidSequence,
                            _heatLevel,
                            command.SafeCenterX,
                            command.SafeHalfWidth);
                        break;
                    case RunParcelCommandType.FatCone:
                        SpawnValidatedFatCone(command);
                        break;
                    case RunParcelCommandType.LaserFormation:
                        SpawnLaserFormation(new EncounterCommand(
                            EncounterCommandType.LaserFormation,
                            EncounterKind.MonumentalBroadWeave,
                            i,
                            command.SafeCenterX,
                            command.SafeHalfWidth,
                            command.Z));
                        break;
                }
            }
        }

        void TickScheduledHazardPatterns(float dt)
        {
            _hazardPatternScheduler.Tick(dt, _scheduledHazardRequests);
            for (int i = 0; i < _scheduledHazardRequests.Count; i++)
            {
                ScheduledHazardPatternRequest request = _scheduledHazardRequests[i];
                _patternSafeCenterX = request.SafeCenterX;
                _patternSafeHalfWidth = request.SafeHalfWidth;
                if (request.Family == ScheduledHazardFamily.Lightning)
                {
                    _lightningSequences.Begin(request.Lightning, _shipX, _random);
                    Events.Add(new SimulationEvent(
                        SimulationEventType.LightningStrikeTelegraphed,
                        (int)request.Lightning,
                        request.SafeCenterX,
                        request.SafeHalfWidth));
                }
                else if (request.Family == ScheduledHazardFamily.Asteroid)
                {
                    SpawnAsteroidPattern(new RunParcelCommand(
                        RunParcelCommandType.AsteroidPattern,
                        request.SafeCenterX,
                        _config.ShipZ,
                        asteroidSequence: request.Asteroid,
                        safeCenterX: request.SafeCenterX,
                        safeHalfWidth: request.SafeHalfWidth));
                }
            }
        }

        void SpawnCargoTrail(RunParcelCommand command)
        {
            int count = Math.Max(1, command.Count);
            for (int i = 0; i < count; i++)
            {
                float t = count <= 1 ? 1f : i / (float)(count - 1);
                float smooth = t * t * (3f - 2f * t);
                float x = command.X + (command.ReturnX - command.X) * smooth;
                SpawnPickup(PickupSpawn.Cargo(
                    command.CargoKind,
                    1,
                    x,
                    1.35f,
                    command.Z - i * command.Spacing));
            }
        }

        void SpawnValidatedFatCone(RunParcelCommand command)
        {
            HazardSpawn cone = HazardSpawn.Cone(
                command.X,
                command.Z,
                4f,
                2.7f,
                HazardStyle.FatCone,
                Math.Abs((int)command.Z) % 3);
            cone.Y = -2f;
            cone.CollisionHalfDepth = _config.CollisionHalfDepth + 1.2f;
            if (EncounterGeometryValidator.PreservesOpening(
                cone,
                command.SafeCenterX,
                command.SafeHalfWidth,
                _config.CorridorShipHalfWidth,
                .65f))
                SpawnHazard(cone);
        }

        void SpawnAsteroidPattern(RunParcelCommand command)
        {
            _asteroidSequences.Build(
                command.AsteroidSequence,
                _shipX,
                _shipVelocityX,
                _random,
                _asteroidImpactRequests);
            for (int i = 0; i < _asteroidImpactRequests.Count; i++)
            {
                AsteroidImpactRequest request = _asteroidImpactRequests[i];
                float target = ReservePatternOpening(
                    request.TargetX,
                    command.SafeCenterX,
                    command.SafeHalfWidth,
                    2.8f);
                float radius = .8f + _random.NextFloat() * .8f;
                int id = SpawnHazard(HazardSpawn.Asteroid(
                    target,
                    _config.ShipZ,
                    radius,
                    1.8f,
                    request.DelaySeconds));
                Events.Add(new SimulationEvent(
                    SimulationEventType.AsteroidImpactTelegraphed,
                    id,
                    target,
                    (float)request.Sequence));
            }
        }

        void SpawnMonumentBarrier(EncounterCommand command)
        {
            const float wallWidth = 44f;
            const float wallHeight = 19f;
            const float wallDepth = 6f;
            float offset = command.HalfWidth + wallWidth * 0.5f;
            int variant = Math.Abs(command.RowIndex) % 3;
            float lean = ((command.RowIndex & 1) == 0 ? 1f : -1f) * 0.08f;
            SpawnEncounterHazard(command, HazardSpawn.Wall(
                command.X - offset, wallHeight * 0.5f, command.Z,
                wallWidth, wallHeight, wallDepth, 0f, lean, 0f,
                HazardStyle.MonumentWall, variant));
            SpawnEncounterHazard(command, HazardSpawn.Wall(
                command.X + offset, wallHeight * 0.5f, command.Z,
                wallWidth, wallHeight, wallDepth, 0f, -lean, 0f,
                HazardStyle.MonumentWall, (variant + 1) % 3));
        }

        void SpawnPlannedLightningCluster(EncounterCommand command)
        {
            // The proof storm now runs the exact five pattern families authored
            // in Three.js instead of manufacturing a disconnected three-bolt wall.
            LightningSequenceKind sequence = (LightningSequenceKind)(command.RowIndex % 5);
            _lightningSequences.Begin(sequence, _shipX, _random);
            Events.Add(new SimulationEvent(
                SimulationEventType.LightningStrikeTelegraphed,
                (int)sequence,
                command.X,
                command.RowIndex));
        }

        void TickLightningSequences(float dt)
        {
            _lightningSequences.Tick(dt, _shipX, _lightningStrikeRequests);
            if (_lightningStrikeRequests.Count == 0) return;

            float spawnZ = _config.ShipZ - 83f;
            float travelTime = 83f / Math.Max(1f, _effectiveSpeed);
            for (int i = 0; i < _lightningStrikeRequests.Count; i++)
            {
                LightningStrikeRequest request = _lightningStrikeRequests[i];
                float targetX = request.TargetX + _shipVelocityX * travelTime * .6f;
                targetX = ReservePatternOpening(
                    targetX,
                    _patternSafeCenterX,
                    _patternSafeHalfWidth,
                    _config.LightningCollisionHalfWidth + _config.CorridorShipHalfWidth);
                SpawnHazard(HazardSpawn.Lightning(
                    Clamp(targetX, -40f, 40f),
                    spawnZ,
                    _config.LightningWarningSeconds,
                    4.8f,
                    _config.LightningCollisionHalfWidth,
                    4f));
                Events.Add(new SimulationEvent(
                    SimulationEventType.LightningStrikeTelegraphed,
                    (int)request.Sequence,
                    targetX,
                    spawnZ));
            }
        }

        static float ReservePatternOpening(float targetX, float safeCenter, float safeHalfWidth, float hazardHalfWidth)
        {
            float protectedHalf = Math.Max(0f, safeHalfWidth - hazardHalfWidth);
            if (Math.Abs(targetX - safeCenter) >= protectedHalf) return targetX;
            float sign = targetX >= safeCenter ? 1f : -1f;
            return safeCenter + sign * (safeHalfWidth + hazardHalfWidth + .5f);
        }

        void SpawnProofCorridorSlice(EncounterCommand command, CorridorFamily family)
        {
            for (int i = 0; i < _corridorSlices.Length; i++)
            {
                if (_corridorSlices[i].Active) continue;
                _corridorSlices[i] = new CorridorSliceState
                {
                    Active = true,
                    Id = _nextEntityId++,
                    Family = family,
                    RowIndex = command.RowIndex,
                    CenterX = command.X,
                    HalfWidth = command.HalfWidth,
                    Z = command.Z,
                    EnvironmentPhase = command.EnvironmentPhase,
                    CorridorBoundaryActive = command.CorridorBoundaryActive,
                    TraversalRequirement = command.TraversalRequirement
                };
                return;
            }
        }

        void SpawnLaserFormation(EncounterCommand command)
        {
            const int rows = 3;
            const float bypassHalfWidth = 6.5f;
            float bypassDirection = (command.RowIndex & 1) == 0 ? 1f : -1f;
            float bypassCenter = Clamp(command.X + bypassDirection * 16f, -28f, 28f);
            BeginLaserFormation(command.X);

            for (int row = 0; row < rows; row++)
            {
                float z = command.Z - row * 8f;
                SpawnLaserTarget(command.X - .35f, z, bypassCenter, bypassHalfWidth, row * 2);
                SpawnLaserTarget(command.X + .35f, z - 1.4f, bypassCenter, bypassHalfWidth, row * 2 + 1);

                int column = 0;
                for (float x = -33f; x <= 33.01f; x += 5.5f, column++)
                {
                    if (Math.Abs(x - command.X) < 2.2f) continue;
                    SpawnLaserTarget(
                        x,
                        z + ((column + row) % 3) * 1.35f,
                        bypassCenter,
                        bypassHalfWidth,
                        row * 31 + column);
                }
            }
        }

        void BeginLaserFormation(float centerX)
        {
            _laserFormationActive = true;
            _laserFormationOverloaded = false;
            _laserFormationId = _nextEntityId++;
            _laserFormationRemaining = 0;
            _laserFormationDestroyed = 0;
            _laserDestructionChain = 0;
            _laserChainTimer = 0f;
            _laserFormationCenterX = centerX;
        }

        void ResetLaserFormationState()
        {
            _laserFormationActive = false;
            _laserFormationOverloaded = false;
            _laserFormationId = 0;
            _laserFormationRemaining = 0;
            _laserFormationDestroyed = 0;
            _laserDestructionChain = 0;
            _laserChainTimer = 0f;
            _laserFormationCenterX = 0f;
        }

        void RetireLaserFormationTarget()
        {
            if (!_laserFormationActive || _laserFormationRemaining <= 0) return;
            _laserFormationRemaining--;
            if (_laserFormationRemaining <= 0)
            {
                _laserFormationActive = false;
                _laserDestructionChain = 0;
                _laserChainTimer = 0f;
            }
        }

        void SpawnLaserTarget(
            float x,
            float z,
            float bypassCenter,
            float bypassHalfWidth,
            int variant)
        {
            HazardSpawn cone = HazardSpawn.Cone(
                    x,
                    z,
                    2.45f,
                    1.35f,
                    HazardStyle.FatCone,
                    Math.Abs(variant) % 3);
            cone.Y = -2f;
            cone.CollisionHalfDepth = _config.CollisionHalfDepth + .8f;
            cone.Role = HazardRole.LaserFormationTarget;
            if (!EncounterGeometryValidator.PreservesOpening(
                cone,
                bypassCenter,
                bypassHalfWidth,
                _config.CorridorShipHalfWidth,
                .65f)) return;
            SpawnHazard(cone);
        }

        void SpawnEncounterHazard(EncounterCommand command, HazardSpawn hazard)
        {
            if (!EncounterGeometryValidator.PreservesOpening(
                hazard,
                command.X,
                command.HalfWidth,
                _config.CorridorShipHalfWidth,
                .65f))
                throw new InvalidOperationException(
                    "Encounter hazard intrudes into its validated opening: " + command.EncounterKind);
            SpawnHazard(hazard);
        }

        void CompleteAutomaticExtraction()
        {
            _automaticExtractionManifest = _cargo.Snapshot(_heatLevel, HeatRewardMultiplier());
            _automaticExtractionPending = true;
            FinalizeRun(RunCompletionReason.Extracted);
            Phase = CoreGamePhase.Extracted;
            Events.Add(new SimulationEvent(
                SimulationEventType.RunExtracted,
                0,
                _automaticExtractionManifest.TotalWeight,
                _automaticExtractionManifest.CreditValue));
        }

        void EnterExtractionBreather()
        {
            Array.Clear(_hazards, 0, _hazards.Length);
            Array.Clear(_pickups, 0, _pickups.Length);
            Array.Clear(_corridorSlices, 0, _corridorSlices.Length);
            _lightningSequences.Reset();
            _lightningStrikeRequests.Clear();
            _asteroidImpactRequests.Clear();
            _hazardPatternScheduler.Reset();
            _scheduledHazardRequests.Clear();
            _environmentEncounter.Reset();
            _gateRun?.RetireEnvironment();
            _lightningFamily = CorridorFamily.None;
            _lightningTimer = 0f;
            _zipperActive = false;
            _slalomActive = false;
            _sineCorridorActive = false;
            _structuredWallsActive = false;
            _structuredWallsScheduling = false;
        }

        void TickExtractionBreather(float dt)
        {
            float settle = (float)Math.Exp(-7f * dt);
            _shipVelocityX *= settle;
            _bankVelocityX *= settle;
            _bankRadians *= settle;
            _rollRadians *= settle;
            _tiltTimer = 0f;
            _shipX += _shipVelocityX * dt;
        }

        bool ResolveCorridorCollision(WorldFrame world)
        {
            if (!_config.CollisionEnabled
                || world.CollisionSuppressed
                || !world.CorridorCollisionActive)
                return false;

            float halfWidth = _config.CorridorShipHalfWidth;
            float grace = _config.CorridorCollisionGrace;
            bool hitRight = _shipX + halfWidth >= world.CorridorRightBoundary + grace;
            bool hitLeft = _shipX - halfWidth <= world.CorridorLeftBoundary - grace;
            if (!hitRight && !hitLeft) return false;

            if (_overdriveSeconds > 0f) return false;
            if (ConsumeShieldHit(0)) return false;
            if (ConsumeHullHit(0)) return false;

            FinalizeRun();
            Phase = CoreGamePhase.Dead;
            Events.Add(new SimulationEvent(SimulationEventType.PlayerDied, 0, (float)_score, _distance));
            return true;
        }

        public bool OverdriveSpeedActive => _overdriveSeconds > PowerupCatalog.Overdrive.GraceSeconds;

        public void ActivatePowerup(PowerupType type)
        {
            PowerupDefinition definition = PowerupCatalog.Get(type);
            if (definition.Type == PowerupType.None) return;
            float power = PowerMultiplier(type);
            float duration = definition.DurationSeconds * power;

            switch (type)
            {
                case PowerupType.Shield:
                    _shieldSeconds = Math.Max(_shieldSeconds, duration);
                    _shieldHits = Math.Max(_shieldHits, Math.Max(1, (int)Math.Floor(definition.HitPoints * power + .35f)));
                    break;
                case PowerupType.Laser:
                    _laserSeconds = Math.Max(_laserSeconds, duration);
                    _laserShotTimer = 0f;
                    break;
                case PowerupType.Overdrive:
                    _overdriveSeconds = Math.Max(_overdriveSeconds, duration);
                    break;
                case PowerupType.Magnet:
                    _magnetSeconds = Math.Max(_magnetSeconds, duration);
                    break;
            }
            Events.Add(new SimulationEvent(SimulationEventType.PowerupActivated, 0, (float)type, duration));
            RefreshSnapshot();
        }

        float PowerMultiplier(PowerupType type)
        {
            switch (type)
            {
                case PowerupType.Shield: return _config.ShieldPowerMultiplier;
                case PowerupType.Laser: return _config.LaserPowerMultiplier;
                case PowerupType.Magnet: return _config.MagnetPowerMultiplier;
                case PowerupType.Overdrive: return _config.OverdrivePowerMultiplier;
                default: return 1f;
            }
        }

        /// <summary>Migration seam for a legacy Unity collision presenter.</summary>
        public bool TryAbsorbExternalHit(int hazardId = 0)
        {
            if (_overdriveSeconds > 0f) return true;
            bool absorbed = ConsumeShieldHit(hazardId) || ConsumeHullHit(hazardId);
            if (absorbed) RefreshSnapshot();
            return absorbed;
        }

        void TickPowerups(float dt)
        {
            TickTimer(ref _shieldSeconds, PowerupType.Shield, dt);
            TickTimer(ref _laserSeconds, PowerupType.Laser, dt);
            TickTimer(ref _overdriveSeconds, PowerupType.Overdrive, dt);
            TickTimer(ref _magnetSeconds, PowerupType.Magnet, dt);
            if (_shieldSeconds <= 0f) _shieldHits = 0;
            if (_laserChainTimer > 0f)
            {
                _laserChainTimer = Math.Max(0f, _laserChainTimer - dt);
                if (_laserChainTimer <= 0f) _laserDestructionChain = 0;
            }
        }

        void TickTimer(ref float timer, PowerupType type, float dt)
        {
            if (timer <= 0f) return;
            float previous = timer;
            timer = Math.Max(0f, timer - dt);
            if (previous > 0f && timer <= 0f)
                Events.Add(new SimulationEvent(SimulationEventType.PowerupExpired, 0, (float)type));
        }

        bool ConsumeShieldHit(int hazardId)
        {
            if (_shieldSeconds <= 0f || _shieldHits <= 0) return false;
            _shieldHits--;
            Events.Add(new SimulationEvent(SimulationEventType.ShieldHit, hazardId, _shieldHits, _shieldSeconds));
            if (_shieldHits <= 0)
            {
                _shieldSeconds = 0f;
                Events.Add(new SimulationEvent(SimulationEventType.ShieldBroken, hazardId));
            }
            return true;
        }

        bool ConsumeHullHit(int hazardId)
        {
            if (_hullHitsRemaining <= 1) return false;
            _hullHitsRemaining--;
            Events.Add(new SimulationEvent(SimulationEventType.HullDamaged, hazardId, _hullHitsRemaining, _config.HullHitCapacity));
            return true;
        }

        void ResetRunState(SimulationEventBuffer events)
        {
            _random.Reset(_seed);
            Array.Clear(_hazards, 0, _hazards.Length);
            Array.Clear(_pickups, 0, _pickups.Length);
            Array.Clear(_corridorSlices, 0, _corridorSlices.Length);
            _tick = 0;
            _eligibleRunTick = 0;
            _runId = 0L;
            _elapsed = 0f;
            _distance = 0f;
            _score = 0d;
            _repairCount = 0;
            _leaderboardIneligibility = LeaderboardIneligibility.None;
            _automaticExtractionPending = false;
            _automaticExtractionManifest = default;
            LatestRunResult = null;
            _paceState = RunPaceModel.Resolve(new RunPaceInput(
                _config.BaseSpeed * _config.StartSpeedMultiplier,
                _config.PersistentCruiseSpeedMultiplier,
                1f,
                1f,
                1f,
                _config.MinimumOperationalSpeed));
            _speed = _paceState.CruiseSpeedBeforePowerup;
            _effectiveSpeed = _paceState.EffectiveSpeed;
            _hasExternalSpeed = false;
            _externalSpeed = 0f;
            _shipX = 0f;
            _shipY = _config.ShipHoverY;
            _shipVelocityX = 0f;
            _rollRadians = 0f;
            _tiltTimer = 0f;
            _bankVelocityX = 0f;
            _bankRadians = 0f;
            _bobSteerBlend = 1f;
            _distanceUntilSpawn = _config.InitialSpawnDistance;
            _nextEntityId = 1;
            _wavesSinceCoin = 99;
            _wavesSincePowerup = 0;
            _wavesSinceCargo = 0;
            _heatLevel = 0;
            _extractionWindowOpen = false;
            _nextExtractionDistance = _config.FirstExtractionDistance;
            _extractionWindowEndDistance = 0f;
            _nextPowerupType = 0;
            _shieldSeconds = 0f;
            _shieldHits = 0;
            _hullHitsRemaining = _config.HullHitCapacity;
            _laserSeconds = 0f;
            _laserShotTimer = 0f;
            ResetLaserFormationState();
            _overdriveSeconds = 0f;
            _magnetSeconds = 0f;
            _cargo.Reset();
            _lightningFamily = CorridorFamily.None;
            _lightningTimer = 0f;
            _lightningSequences.Reset();
            _lightningStrikeRequests.Clear();
            _asteroidImpactRequests.Clear();
            _hazardPatternScheduler.Reset();
            _scheduledHazardRequests.Clear();
            _patternSafeCenterX = 0f;
            _patternSafeHalfWidth = 0f;
            _heroEncountersCompleted = 0;
            _environmentCompletionScored = false;
            _zipperActive = false;
            _zipperRowsLeft = 0;
            _zipperRowsTotal = 0;
            _zipperSide = 1;
            _zipperTimer = 0f;
            _slalomActive = false;
            _slalomFirstRow = false;
            _slalomRowsLeft = 0;
            _slalomGapWidth = 0f;
            _slalomDistanceUntilRow = 0f;
            _slalomGapCenter = 0f;
            _slalomGapVelocity = 0f;
            _sineCorridorActive = false;
            _sineCorridor = null;
            _sineRowsDone = 0;
            _sineSpawnZ = 0f;
            _sinePhase = 0f;
            _sineAnchor = 0f;
            _sineDelaySeconds = 0f;
            _sineGapCenter = 0f;
            _structuredWallsActive = false;
            _structuredWallsScheduling = false;
            _structuredWallRowsDone = 0;
            _structuredWallSpawnZ = 0f;
            _proofEncounters?.Reset();
            _terrainWorld?.Reset();
            _gateRun?.Reset(_config.BaseSpeed * _config.StartSpeedMultiplier * _config.PersistentCruiseSpeedMultiplier);
            _environmentEncounter.Reset();
            _runParcelCommands.Clear();
            _encounterCommands.Clear();
            if (_stageDirector != null)
            {
                _stageDirector.Reset(events);
                _speed = _stageDirector.Speed;
                _effectiveSpeed = _speed;
            }
        }

        void UpdateShip(InputFrame input, float dt, bool movementSuppressed)
        {
            // The web update uses `if left, else if right`: simultaneous input is
            // intentionally left-biased rather than cancelling both directions.
            int steer = movementSuppressed ? 0 : input.SteerLeft ? -1 : input.SteerRight ? 1 : 0;
            if (movementSuppressed)
            {
                _shipX = 0f;
                _shipVelocityX = 0f;
            }

            if (Math.Abs(_rollRadians) > 0.1f)
                _tiltTimer = Math.Min(_tiltTimer + dt, _config.TiltGraceSeconds + 1f);
            else
                _tiltTimer = Math.Max(0f, _tiltTimer - dt * 3f);

            float penaltyT = Clamp01(_tiltTimer - _config.TiltGraceSeconds);
            float tiltPenalty = 0.35f + 0.65f * (float)Math.Cos(_rollRadians);
            float tiltFactor = 1f - penaltyT * (1f - tiltPenalty);
            float maxVelocity = _config.MaxLateralVelocity * tiltFactor;

            if (steer != 0)
            {
                bool counterSteer = (steer < 0 && _shipVelocityX > 0f) || (steer > 0 && _shipVelocityX < 0f);
                float boost = counterSteer ? _config.CounterSteerBoost : 1f;
                _shipVelocityX += steer * _config.Acceleration * boost * tiltFactor * dt;
            }
            else
            {
                _shipVelocityX *= Math.Max(0f, 1f - _config.Deceleration * dt);
            }

            _shipVelocityX = Clamp(_shipVelocityX, -maxVelocity, maxVelocity);
            _shipX += _shipVelocityX * dt;

            if (steer != 0)
            {
                if ((steer < 0 && _bankVelocityX > 0f) || (steer > 0 && _bankVelocityX < 0f))
                    _bankVelocityX = 0f;
                _bankVelocityX += (_shipVelocityX - _bankVelocityX) * Math.Min(1f, 20f * dt);
            }
            else
            {
                _bankVelocityX *= Math.Max(0f, 1f - _config.BankReturnRate * dt);
            }

            float velocityNormal = maxVelocity > 0f ? Clamp(_bankVelocityX / maxVelocity, -1f, 1f) : 0f;
            float bankTarget = -velocityNormal * _config.BankMaxRadians;
            bool crossingZero = (_bankRadians > 0.01f && bankTarget < -0.01f)
                || (_bankRadians < -0.01f && bankTarget > 0.01f);
            float bankRate = _config.BankSmoothing * (crossingZero ? _config.BankZeroCrossMultiplier : 1f);
            _bankRadians += (bankTarget - _bankRadians) * Math.Min(1f, bankRate * dt);

            float bobTarget = Math.Abs(_shipVelocityX) > 0.5f ? 0f : 1f;
            float bobRate = bobTarget < _bobSteerBlend ? 4f : 2f;
            _bobSteerBlend += (bobTarget - _bobSteerBlend) * Math.Min(1f, bobRate * dt);
            _shipY = _config.ShipHoverY
                + (float)Math.Sin(_elapsed * _config.HoverFrequency * Math.PI * 2.0)
                * _config.HoverAmplitude * _bobSteerBlend;

            // The production loop updates knife-edge roll after lateral movement,
            // banking, and hover. Tilt therefore affects steering on the following
            // fixed tick, not retroactively on the tick that begins the roll.
            if (input.RollDirection != 0)
            {
                _rollRadians = Clamp(
                    _rollRadians + input.RollDirection * _config.RollSpeed * dt,
                    -_config.RollMaxRadians,
                    _config.RollMaxRadians);
            }
            else
            {
                _rollRadians = MoveTowards(
                    _rollRadians,
                    0f,
                    _config.RollSpeed * _config.RollReturnMultiplier * dt);
            }
        }

        void SpawnStandardHazard()
        {
            int lane = _random.NextInt(0, _config.LaneCount);
            float centerLane = (_config.LaneCount - 1) * 0.5f;
            float x = _shipX + (lane - centerLane) * _config.LaneWidth;
            SpawnHazard(new HazardSpawn
            {
                Kind = HazardKind.Cone,
                X = x,
                Z = _config.SpawnZ,
                CollisionHalfWidth = _config.HazardHalfWidth,
                CollisionHalfDepth = _config.CollisionHalfDepth,
                VisualScale = 1f,
                NearMissEnabled = true
            });
        }

        void TickWorldSpawner(float distanceStep, WorldFrame world)
        {
            if (_stageDirector == null)
            {
                _distanceUntilSpawn -= distanceStep;
                while (_distanceUntilSpawn <= 0f)
                {
                    SpawnStandardHazard();
                    _distanceUntilSpawn += _config.SpawnIntervalDistance;
                }
                return;
            }

            if (world.SpawningSuppressed
                || world.AnyStructuredMechanicActive
                || _stageDirector.RestBeat > 0f
                || _stageDirector.SpawnPattern == SpawnPattern.None)
                return;

            _distanceUntilSpawn -= distanceStep;
            int safety = 4;
            while (_distanceUntilSpawn <= 0f && safety-- > 0)
            {
                SpawnStageWave();
                _distanceUntilSpawn += NextWaveDistance();
            }
        }

        float NextWaveDistance()
        {
            float distance;
            switch (_stageDirector.SpawnPattern)
            {
                case SpawnPattern.FatCones:
                    distance = 28f;
                    break;
                case SpawnPattern.Cones when _stageDirector.Density == DensityCurve.Ramp:
                    distance = 32f - 6f * _stageDirector.StageRamp01;
                    break;
                default:
                    distance = 30f;
                    break;
            }
            return Math.Max(10f, distance + (_random.NextFloat() - 0.5f) * 10f);
        }

        void SpawnStageWave()
        {
            SpawnPattern pattern = _stageDirector.SpawnPattern;
            float travelSeconds = Math.Abs(_config.SpawnZ) / Math.Max(1f, _speed);
            float predictedX = Clamp(
                _shipX + _shipVelocityX * travelSeconds * 0.85f,
                _shipX - 8f,
                _shipX + 8f);

            int count;
            int minimumLaneGap;
            float spreadMultiplier = 1f;
            switch (pattern)
            {
                case SpawnPattern.Lethal:
                    count = _random.NextInt(3, 5);
                    minimumLaneGap = 4;
                    break;
                case SpawnPattern.Angled:
                    count = _random.NextInt(6, 9);
                    minimumLaneGap = 4;
                    break;
                case SpawnPattern.FatCones:
                    count = _random.NextInt(4, 6);
                    minimumLaneGap = 5;
                    spreadMultiplier = 1.35f;
                    break;
                case SpawnPattern.EndlessMix:
                    count = _random.NextInt(3, 5);
                    minimumLaneGap = 4;
                    break;
                default:
                    count = _stageDirector.Density == DensityCurve.Ramp
                        ? 5 + (int)Math.Floor(_stageDirector.StageRamp01 * 4.999f)
                        : 7 + (int)Math.Floor(_stageDirector.PhysicsTier * 0.5f) + (_random.NextFloat() < 0.5f ? 1 : 0);
                    minimumLaneGap = _stageDirector.Density == DensityCurve.Ramp ? 3 : 1;
                    break;
            }

            for (int i = 0; i < _laneScratch.Length; i++) _laneScratch[i] = i;
            for (int i = _laneScratch.Length - 1; i > 0; i--)
            {
                int j = _random.NextInt(0, i + 1);
                int temp = _laneScratch[i];
                _laneScratch[i] = _laneScratch[j];
                _laneScratch[j] = temp;
            }

            int guaranteedGapStart = _random.NextInt(0, _config.LaneCount - 1);
            int blockedCount = 0;
            for (int i = 0; i < _laneScratch.Length && blockedCount < count; i++)
            {
                int lane = _laneScratch[i];
                if (lane == guaranteedGapStart || lane == guaranteedGapStart + 1) continue;
                bool clashes = false;
                for (int b = 0; b < blockedCount; b++)
                {
                    if (Math.Abs(_blockedLaneScratch[b] - lane) < minimumLaneGap)
                    {
                        clashes = true;
                        break;
                    }
                }
                if (!clashes) _blockedLaneScratch[blockedCount++] = lane;
            }

            float centerLane = (_config.LaneCount - 1) * 0.5f;
            for (int i = 0; i < blockedCount; i++)
            {
                int lane = _blockedLaneScratch[i];
                float x = predictedX + (lane - centerLane) * _config.LaneWidth * spreadMultiplier
                    + (_random.NextFloat() - 0.5f) * 0.6f;
                float z = _config.SpawnZ + (_random.NextFloat() - 0.5f) * 8f;
                SpawnPatternEntity(pattern, x, z);
            }

            _wavesSinceCoin++;
            if (_wavesSinceCoin > 1)
            {
                SpawnCoinPattern(predictedX, blockedCount);
                _wavesSinceCoin = 0;
            }

            // Production attempts a pickup after roughly six eligible wave calls.
            // Keep the cadence deterministic and rotate all four types so every run
            // exposes the complete mechanic set instead of depending on unlock UI.
            _wavesSincePowerup++;
            if (_wavesSincePowerup >= 6 && CountActivePowerups() < 2)
            {
                SpawnPowerup(predictedX, blockedCount);
                _wavesSincePowerup = 0;
            }

            _wavesSinceCargo++;
            if (_wavesSinceCargo >= _config.CargoWaveInterval && _cargo.UsedWeight < _cargo.CapacityWeight)
            {
                SpawnCargo(predictedX, blockedCount);
                _wavesSinceCargo = 0;
            }
        }

        void SpawnCargo(float centerX, int blockedCount)
        {
            int freeCount = 0;
            for (int lane = 0; lane < _config.LaneCount; lane++)
            {
                bool blocked = false;
                for (int i = 0; i < blockedCount; i++)
                    if (_blockedLaneScratch[i] == lane) { blocked = true; break; }
                if (!blocked) _laneScratch[freeCount++] = lane;
            }
            if (freeCount == 0) return;
            int laneIndex = _laneScratch[_random.NextInt(0, freeCount)];
            float centerLane = (_config.LaneCount - 1) * .5f;
            float x = centerX + (laneIndex - centerLane) * _config.LaneWidth;
            RunCargoKind kind = CargoCatalog.Select(_random.NextFloat(), _heatLevel);
            SpawnPickup(PickupSpawn.Cargo(kind, 1, x, 1.35f, _config.SpawnZ));
        }

        int CountActivePowerups()
        {
            int count = 0;
            for (int i = 0; i < _pickups.Length; i++)
                if (_pickups[i].Active && _pickups[i].Kind == PickupKind.Powerup) count++;
            return count;
        }

        void SpawnPowerup(float centerX, int blockedCount)
        {
            int freeCount = 0;
            for (int lane = 0; lane < _config.LaneCount; lane++)
            {
                bool blocked = false;
                for (int i = 0; i < blockedCount; i++)
                {
                    if (_blockedLaneScratch[i] == lane) { blocked = true; break; }
                }
                if (!blocked) _laneScratch[freeCount++] = lane;
            }
            if (freeCount == 0) return;

            int laneIndex = _laneScratch[_random.NextInt(0, freeCount)];
            float centerLane = (_config.LaneCount - 1) * 0.5f;
            float x = centerX + (laneIndex - centerLane) * _config.LaneWidth;
            PowerupType type = (PowerupType)(1 + (_nextPowerupType++ % 4));
            SpawnPickup(PickupSpawn.PowerupPickup(type, x, 1.4f, _config.SpawnZ));
        }

        void SpawnPatternEntity(SpawnPattern pattern, float x, float z)
        {
            int color = _random.NextInt(0, 3);
            if (pattern == SpawnPattern.Lethal)
            {
                SpawnHazard(HazardSpawn.Ring(x, 2f, z, 5.25f, 2.2f));
                return;
            }
            if (pattern == SpawnPattern.Angled)
            {
                SpawnRandomWall(x, z, color);
                return;
            }
            if (pattern == SpawnPattern.FatCones)
            {
                SpawnHazard(HazardSpawn.Cone(x, z, 4f, 2.7f, HazardStyle.FatCone, color));
                return;
            }
            if (pattern == SpawnPattern.EndlessMix)
            {
                float roll = _random.NextFloat();
                if (roll < 0.25f)
                    SpawnHazard(HazardSpawn.Ring(x, 2f, z, 5.25f, 2.2f));
                else if (roll < 0.5f)
                    SpawnRandomWall(x, z, color);
                else
                {
                    bool fat = _random.NextFloat() < 0.5f;
                    SpawnHazard(HazardSpawn.Cone(
                        x,
                        z,
                        fat ? 4f : 1f,
                        fat ? 2.7f : 0f,
                        fat ? HazardStyle.FatCone : HazardStyle.StandardCone,
                        color));
                }
                return;
            }
            SpawnHazard(HazardSpawn.Cone(x, z, 1f, 0f, HazardStyle.StandardCone, color));
        }

        void SpawnRandomWall(float x, float z, int color)
        {
            float sign = _random.NextFloat() < 0.5f ? -1f : 1f;
            float angle = sign * (25f + _random.NextFloat() * 20f) * (float)(Math.PI / 180.0);
            SpawnHazard(HazardSpawn.Wall(x, 2f, z, 8f, 4f, 0.3f, 0f, angle, 0f, HazardStyle.AngledWall, color));
        }

        void SpawnCoinPattern(float centerX, int blockedCount)
        {
            int freeCount = 0;
            for (int lane = 0; lane < _config.LaneCount; lane++)
            {
                bool blocked = false;
                for (int i = 0; i < blockedCount; i++)
                {
                    if (_blockedLaneScratch[i] == lane) { blocked = true; break; }
                }
                if (!blocked) _laneScratch[freeCount++] = lane;
            }
            if (freeCount == 0) return;

            float roll = _random.NextFloat();
            float centerLane = (_config.LaneCount - 1) * 0.5f;
            if (roll < 0.45f)
            {
                int lane = _laneScratch[_random.NextInt(0, freeCount)];
                float x = centerX + (lane - centerLane) * _config.LaneWidth;
                SpawnPickup(PickupSpawn.Coin(x, 1.2f, _config.SpawnZ, 75f));
                return;
            }
            if (roll < 0.80f)
            {
                int count = 10 + _random.NextInt(0, 6);
                float zSpan = 28f + _random.NextFloat() * 16f;
                float baseX = centerX + (_random.NextFloat() - 0.5f) * 8f;
                float xSwing = (_random.NextFloat() - 0.5f) * 10f;
                for (int i = 0; i < count; i++)
                {
                    float fraction = i / (float)(count - 1);
                    float arc = (float)Math.Sin(fraction * Math.PI);
                    SpawnPickup(PickupSpawn.Coin(
                        baseX + arc * xSwing,
                        1.2f + arc * 0.7f,
                        _config.SpawnZ + fraction * zSpan,
                        75f));
                }
                return;
            }

            int lineCount = 8 + _random.NextInt(0, 5);
            float lineSpan = 20f + _random.NextFloat() * 12f;
            int lineLane = _laneScratch[_random.NextInt(0, freeCount)];
            float lineX = centerX + (lineLane - centerLane) * _config.LaneWidth;
            for (int i = 0; i < lineCount; i++)
            {
                float fraction = i / (float)(lineCount - 1);
                SpawnPickup(PickupSpawn.Coin(lineX, 1.2f, _config.SpawnZ + fraction * lineSpan, 75f));
            }
        }

        void TickLightningSpawner(float dt, WorldFrame world)
        {
            CorridorFamily family = CorridorFamily.None;
            if (_stageDirector != null
                && _stageDirector.CurrentStage.Kind == StageKind.Corridor
                && world.CanyonActive
                && !world.CanyonExiting)
            {
                CorridorFamily candidate = _stageDirector.CurrentStage.Family;
                if (candidate == CorridorFamily.PreT4A || candidate == CorridorFamily.PreT4B)
                    family = candidate;
            }

            if (family == CorridorFamily.None)
            {
                _lightningFamily = CorridorFamily.None;
                _lightningTimer = 0f;
                return;
            }
            if (family != _lightningFamily)
            {
                _lightningFamily = family;
                _lightningTimer = 0f;
            }

            float frequency = family == CorridorFamily.PreT4A ? 0.3f : 2f;
            _lightningTimer += dt;
            while (_lightningTimer >= frequency)
            {
                _lightningTimer -= frequency;
                SpawnPredictedLightningStrike();
            }
        }

        void SpawnPredictedLightningStrike()
        {
            float spawnZ = _config.ShipZ - 83f;
            float travelTime = 83f / Math.Max(1f, _effectiveSpeed);
            float targetX = _shipX
                + (_random.NextFloat() - 0.5f) * 3f
                + _shipVelocityX * travelTime * 0.6f;
            SpawnHazard(HazardSpawn.Lightning(
                targetX,
                spawnZ,
                _config.LightningWarningSeconds,
                4.8f,
                _config.LightningCollisionHalfWidth,
                4f));
            Events.Add(new SimulationEvent(
                SimulationEventType.LightningStrikeTelegraphed,
                0,
                targetX,
                0f));
        }

        void ApplyStageCommandsToCore()
        {
            for (int i = 0; i < StageCommands.Count; i++)
            {
                StageCommand command = StageCommands[i];
                switch (command.Type)
                {
                    case StageCommandType.WipeHazards:
                        Array.Clear(_hazards, 0, _hazards.Length);
                        break;
                    case StageCommandType.AbortTransientMechanics:
                        _slalomActive = false;
                        _slalomRowsLeft = 0;
                        _zipperActive = false;
                        _zipperRowsLeft = 0;
                        StopSineCorridor();
                        StopStructuredWalls();
                        break;
                    case StageCommandType.AbortZipper:
                        _zipperActive = false;
                        _zipperRowsLeft = 0;
                        break;
                    case StageCommandType.StartSlalom:
                        if (!_slalomActive)
                            StartSlalom(command.ValueA, Math.Max(1, (int)Math.Round(command.ValueB)));
                        break;
                    case StageCommandType.StartZipper:
                        if (!_zipperActive) StartZipper(Math.Max(1, (int)Math.Round(command.ValueA)));
                        break;
                    case StageCommandType.LaunchCorridor:
                        if (command.Family == CorridorFamily.L4Sine || command.Family == CorridorFamily.L5Sine)
                            StartSineCorridor(command.Family);
                        break;
                    case StageCommandType.StartStructuredWalls:
                        if (!_structuredWallsActive) StartStructuredWalls();
                        break;
                }
            }
        }

        void StartSineCorridor(CorridorFamily family)
        {
            _sineCorridor = SineCorridorCatalog.For(family);
            _sineRowsDone = 0;
            _sineSpawnZ = -_config.PrismaticTunnelRowSpacing;
            _sinePhase = 0f;
            _sineAnchor = _shipX;
            _sineDelaySeconds = _sineCorridor.StartDelaySeconds;
            _sineGapCenter = _sineAnchor;
            _sineCorridorActive = true;
        }

        void StopSineCorridor()
        {
            _sineCorridorActive = false;
            _sineCorridor = null;
            _sineRowsDone = 0;
            _sineDelaySeconds = 0f;
            Array.Clear(_corridorSlices, 0, _corridorSlices.Length);
        }

        void TickSineCorridor(float dt)
        {
            TickCorridorSlices(dt);
            if (!_sineCorridorActive || _sineCorridor == null) return;
            if (_sineDelaySeconds > 0f)
            {
                _sineDelaySeconds -= dt;
                return;
            }

            _sineSpawnZ += _effectiveSpeed * dt;
            while (_sineSpawnZ >= 0f && _sineRowsDone < _sineCorridor.TotalRows)
            {
                _sineSpawnZ = -_config.PrismaticTunnelRowSpacing;
                SpawnSineCorridorRow();
                _sineRowsDone++;
            }
            if (_sineRowsDone >= _sineCorridor.TotalRows && !_config.PrismaticSineTunnelEnabled)
                _sineCorridorActive = false;
            else if (_sineRowsDone >= _sineCorridor.TotalRows && CountCorridorSlices() == 0)
                _sineCorridorActive = false;
        }

        void SpawnSineCorridorRow()
        {
            float halfWidth = _sineCorridor.HalfWidthAtRow(_sineRowsDone);
            float center = _sineCorridor.CenterAtRow(_sineRowsDone, _sineAnchor, ref _sinePhase);
            _sineGapCenter = center;

            if (_config.PrismaticSineTunnelEnabled)
            {
                SpawnCorridorSlice(center, halfWidth, _sineRowsDone);
                return;
            }

            SpawnSineCorridorCone(center - halfWidth, true);
            SpawnSineCorridorCone(center - halfWidth - _config.LaneWidth, true);
            SpawnSineCorridorCone(center + halfWidth, true);
            SpawnSineCorridorCone(center + halfWidth + _config.LaneWidth, true);
            if (_sineCorridor.ShouldSpawnCenterCone(_sineRowsDone))
                SpawnSineCorridorCone(center, false);
        }

        void SpawnCorridorSlice(float center, float halfWidth, int rowIndex)
        {
            for (int i = 0; i < _corridorSlices.Length; i++)
            {
                if (_corridorSlices[i].Active) continue;
                _corridorSlices[i] = new CorridorSliceState
                {
                    Active = true,
                    Id = _nextEntityId++,
                    Family = _sineCorridor.Family,
                    RowIndex = rowIndex,
                    CenterX = center,
                    HalfWidth = halfWidth,
                    Z = _config.PrismaticTunnelSpawnZ
                };
                return;
            }
        }

        void TickCorridorSlices(float dt)
        {
            float step = _effectiveSpeed * dt;
            for (int i = 0; i < _corridorSlices.Length; i++)
            {
                CorridorSliceState slice = _corridorSlices[i];
                if (!slice.Active) continue;
                slice.Z += step;
                if (slice.Z > _config.DespawnZ + _config.PrismaticTunnelRowSpacing)
                    slice.Active = false;
                _corridorSlices[i] = slice;
            }
        }

        int CountCorridorSlices()
        {
            int count = 0;
            for (int i = 0; i < _corridorSlices.Length; i++)
                if (_corridorSlices[i].Active) count++;
            return count;
        }

        int FindNearestCorridorSlice(float z)
        {
            int best = -1;
            float bestDistance = float.MaxValue;
            for (int i = 0; i < _corridorSlices.Length; i++)
            {
                if (!_corridorSlices[i].Active) continue;
                float distance = Math.Abs(_corridorSlices[i].Z - z);
                if (distance >= bestDistance) continue;
                best = i;
                bestDistance = distance;
            }
            return best;
        }

        bool ResolvePrismaticCorridorCollision(WorldFrame world)
        {
            if (!_config.PrismaticSineTunnelEnabled
                || !_config.CollisionEnabled
                || world.CollisionSuppressed)
                return false;

            int index = FindNearestCorridorSlice(_config.ShipZ);
            if (index < 0 || Math.Abs(_corridorSlices[index].Z - _config.ShipZ) > _config.PrismaticTunnelCollisionDepth)
                return false;

            CorridorSliceState slice = _corridorSlices[index];
            _sineGapCenter = slice.CenterX;
            if (slice.TraversalRequirement == TraversalRequirement.KnifeEdge
                && Math.Abs(_rollRadians) < 0.95f)
            {
                _corridorSlices[index].TraversalRequirement = TraversalRequirement.None;
                if (_overdriveSeconds > 0f) return false;
                if (ConsumeShieldHit(slice.Id) || ConsumeHullHit(slice.Id))
                {
                    Events.Add(new SimulationEvent(SimulationEventType.TraversalGateHit, slice.Id, _rollRadians, slice.Z));
                    return false;
                }
                Events.Add(new SimulationEvent(SimulationEventType.TraversalGateHit, slice.Id, _rollRadians, slice.Z));
                FinalizeRun();
                Phase = CoreGamePhase.Dead;
                Events.Add(new SimulationEvent(SimulationEventType.PlayerDied, slice.Id, (float)_score, _distance));
                return true;
            }
            if (!slice.CorridorBoundaryActive) return false;
            float allowed = Math.Max(0f, slice.HalfWidth - _config.CorridorShipHalfWidth + _config.CorridorCollisionGrace);
            if (Math.Abs(_shipX - slice.CenterX) < allowed) return false;
            if (_overdriveSeconds > 0f) return false;
            if (ConsumeShieldHit(slice.Id)) return false;
            if (ConsumeHullHit(slice.Id)) return false;

            Events.Add(new SimulationEvent(SimulationEventType.PrismaticBoundaryHit, slice.Id, slice.CenterX, slice.HalfWidth));
            FinalizeRun();
            Phase = CoreGamePhase.Dead;
            Events.Add(new SimulationEvent(SimulationEventType.PlayerDied, slice.Id, (float)_score, _distance));
            return true;
        }

        void SpawnSineCorridorCone(float x, bool jitter)
        {
            int visualVariant = _random.NextInt(0, 3);
            if (jitter) x += (_random.NextFloat() - 0.5f) * 0.6f;
            HazardSpawn cone = HazardSpawn.Cone(
                x,
                _config.SpawnZ,
                1f,
                0.9f,
                _sineCorridor.ConeStyle,
                visualVariant);
            cone.CollisionHalfDepth = _config.CollisionHalfDepth;
            SpawnHazard(cone);
        }

        void StartStructuredWalls()
        {
            _structuredWallsActive = true;
            _structuredWallsScheduling = true;
            _structuredWallRowsDone = 0;
            _structuredWallSpawnZ = -_structuredWallField.RowSpacing;
        }

        void StopStructuredWalls()
        {
            _structuredWallsActive = false;
            _structuredWallsScheduling = false;
            _structuredWallRowsDone = 0;
        }

        void TickStructuredWalls(float dt)
        {
            if (!_structuredWallsActive) return;
            if (_structuredWallsScheduling)
            {
                _structuredWallSpawnZ += _effectiveSpeed * dt;
                if (_structuredWallSpawnZ >= 0f && _structuredWallRowsDone < _structuredWallField.RowCount)
                {
                    _structuredWallSpawnZ = -_structuredWallField.RowSpacing;
                    SpawnStructuredWallRow(_structuredWallRowsDone);
                    _structuredWallRowsDone++;
                    if (_structuredWallRowsDone >= _structuredWallField.RowCount)
                        _structuredWallsScheduling = false;
                }
            }

            if (!_structuredWallsScheduling && !HasActiveStructuredWalls())
                _structuredWallsActive = false;
        }

        void SpawnStructuredWallRow(int row)
        {
            for (int copyX = 0; copyX < _structuredWallField.CopiesX; copyX++)
                for (int copyY = 0; copyY < _structuredWallField.CopiesY; copyY++)
                    for (int copyZ = 0; copyZ < _structuredWallField.CopiesZ; copyZ++)
                        SpawnHazard(_structuredWallField.CreateWall(
                            row,
                            copyX,
                            copyY,
                            copyZ,
                            _shipX,
                            _config.SpawnZ));
        }

        bool HasActiveStructuredWalls()
        {
            for (int i = 0; i < _hazards.Length; i++)
                if (_hazards[i].Active && _hazards[i].Style == HazardStyle.StructuredWall)
                    return true;
            return false;
        }

        void StartZipper(int rows)
        {
            _zipperRowsTotal = rows;
            _zipperRowsLeft = rows;
            _zipperSide = _random.NextFloat() < 0.5f ? -1 : 1;
            _zipperTimer = -1f;
            _zipperActive = true;
        }

        void TickZipper(float dt)
        {
            if (!_zipperActive) return;
            if (_zipperRowsLeft <= 0)
            {
                _zipperActive = false;
                return;
            }

            _zipperTimer += dt;
            int rowsDone = _zipperRowsTotal - _zipperRowsLeft;
            float ramp = Math.Min(rowsDone / (float)Math.Max(1, _zipperRowsTotal - 1), 1f);
            float interval = 1.5f - ramp * 0.65f;
            if (_zipperTimer < interval) return;
            _zipperTimer = 0f;
            SpawnZipperRow(rowsDone);
            _zipperRowsLeft--;
        }

        void SpawnZipperRow(int rowsDone)
        {
            float gapCenter = _shipX + _zipperSide * _config.ZipperLateralOffset;
            float gapHalf = rowsDone >= _config.ZipperReferenceRows - 2
                ? _config.ZipperGapHalfWidth * 1.9f
                : _config.ZipperGapHalfWidth;
            float span = _config.LaneCount * _config.ZipperSpanPerLane;
            for (float x = _shipX - span * 0.5f; x <= _shipX + span * 0.5f; x += _config.LaneWidth)
            {
                if (Math.Abs(x - gapCenter) <= gapHalf) continue;
                HazardSpawn cone = HazardSpawn.Cone(
                    x + (_random.NextFloat() - 0.5f) * 0.5f,
                    _config.SpawnZ,
                    1f,
                    0f,
                    HazardStyle.CorridorCone,
                    _random.NextInt(0, 3));
                cone.Y = -2f;
                cone.CollisionHalfDepth = _config.CollisionHalfDepth;
                SpawnHazard(cone);
            }
            _zipperSide = -_zipperSide;
        }

        void StartSlalom(float gapWidth, int rows)
        {
            _slalomGapWidth = gapWidth;
            _slalomRowsLeft = rows;
            _slalomDistanceUntilRow = 0f;
            _slalomFirstRow = true;
            _slalomActive = true;
        }

        void TickSlalom(float dt)
        {
            if (!_slalomActive) return;
            if (_slalomRowsLeft <= 0)
            {
                _slalomActive = false;
                return;
            }

            _slalomDistanceUntilRow += _effectiveSpeed * dt;
            if (_slalomDistanceUntilRow < 0f) return;
            _slalomDistanceUntilRow = -_config.SlalomRowSpacing;
            SpawnSlalomRow();
            _slalomRowsLeft--;
        }

        void SpawnSlalomRow()
        {
            if (_slalomFirstRow)
            {
                _slalomFirstRow = false;
                _slalomGapCenter = _shipX + (_random.NextFloat() < 0.5f ? -18f : 18f);
                _slalomGapVelocity = 0f;
            }
            else
            {
                _slalomGapVelocity += (_random.NextFloat() - 0.5f) * 14f;
                _slalomGapVelocity *= 0.7f;
                _slalomGapCenter += _slalomGapVelocity;
                _slalomGapCenter = Clamp(
                    _slalomGapCenter,
                    _shipX - _config.SlalomMaximumWander,
                    _shipX + _config.SlalomMaximumWander);
                float delta = _slalomGapCenter - _shipX;
                if (Math.Abs(delta) < _config.SlalomMinimumGapFromShip)
                {
                    float sign = delta == 0f
                        ? (_random.NextFloat() < 0.5f ? -1f : 1f)
                        : Math.Sign(delta);
                    _slalomGapCenter = _shipX + sign * _config.SlalomMinimumGapFromShip;
                }
            }

            float halfGap = _slalomGapWidth * 0.5f;
            for (float offset = halfGap + 2f; offset < 90f; offset += _config.SlalomConeStep)
            {
                if (_random.NextFloat() > 0.30f) SpawnSlalomCone(_slalomGapCenter + offset);
                if (_random.NextFloat() > 0.30f) SpawnSlalomCone(_slalomGapCenter - offset);
            }

            float coinWidth = _slalomGapWidth * 0.6f;
            for (int i = 0; i < 3; i++)
            {
                float fraction = i / 2f;
                SpawnPickup(PickupSpawn.Coin(
                    _slalomGapCenter + (fraction - 0.5f) * coinWidth,
                    1.2f,
                    _config.SpawnZ,
                    75f));
            }
        }

        void SpawnSlalomCone(float x)
        {
            HazardSpawn cone = HazardSpawn.Cone(
                x,
                _config.SpawnZ,
                4f,
                2.7f,
                HazardStyle.FatCone,
                _random.NextInt(0, 3));
            cone.Y = -2f;
            cone.CollisionHalfDepth = _config.CollisionHalfDepth + 1.2f;
            SpawnHazard(cone);
        }

        int SpawnHazard(HazardSpawn spawn)
        {
            int slot = -1;
            for (int i = 0; i < _hazards.Length; i++)
            {
                if (!_hazards[i].Active) { slot = i; break; }
            }
            if (slot < 0) return 0;

            int id = _nextEntityId++;
            _hazards[slot] = new HazardState
            {
                Active = true,
                NearMissArmed = spawn.NearMissEnabled,
                Id = id,
                Kind = spawn.Kind,
                Style = spawn.Style,
                Role = spawn.Role,
                VisualVariant = spawn.VisualVariant,
                X = spawn.X,
                Y = spawn.Y,
                Z = spawn.Z,
                HalfWidth = spawn.CollisionHalfWidth,
                HalfHeight = spawn.CollisionHalfHeight,
                HalfDepth = spawn.CollisionHalfDepth,
                VisualScale = spawn.VisualScale,
                VisualScaleY = spawn.VisualScaleY,
                VisualScaleZ = spawn.VisualScaleZ,
                RotationXRadians = spawn.RotationXRadians,
                RotationYRadians = spawn.RotationYRadians,
                RotationZRadians = spawn.RotationZRadians,
                RingRadius = spawn.RingRadius,
                RingTubeRadius = spawn.RingTubeRadius,
                VelocityX = spawn.VelocityX,
                VelocityY = spawn.VelocityY,
                VelocityZ = spawn.VelocityZ,
                AgeSeconds = 0f,
                CollisionDelaySeconds = spawn.CollisionDelaySeconds,
                LifetimeSeconds = spawn.LifetimeSeconds
            };
            if (spawn.Role == HazardRole.LaserFormationTarget)
            {
                if (!_laserFormationActive)
                    BeginLaserFormation(spawn.X);
                _laserFormationRemaining++;
            }
            Events.Add(new SimulationEvent(SimulationEventType.HazardSpawned, id, spawn.X, spawn.Z));
            return id;
        }

        void UpdateHazards(float step, bool collisionSuppressed)
        {
            float rollFraction = Clamp01(Math.Abs(_rollRadians) / _config.RollMaxRadians);
            float shipHalfWidth = Lerp(
                _config.WingCollisionHalfWidth,
                _config.BodyCollisionHalfWidth,
                rollFraction);

            for (int i = 0; i < _hazards.Length; i++)
            {
                HazardState hazard = _hazards[i];
                if (!hazard.Active) continue;

                hazard.AgeSeconds += _config.FixedDeltaSeconds;
                if (hazard.Kind == HazardKind.Asteroid)
                {
                    hazard.X += hazard.VelocityX * _config.FixedDeltaSeconds;
                    hazard.Y += hazard.VelocityY * _config.FixedDeltaSeconds;
                    hazard.Z += hazard.VelocityZ * _config.FixedDeltaSeconds;
                }
                else
                {
                    hazard.Z += step;
                }
                if (hazard.Z > _config.DespawnZ
                    || (hazard.LifetimeSeconds > 0f && hazard.AgeSeconds >= hazard.LifetimeSeconds))
                {
                    hazard.Active = false;
                    _hazards[i] = hazard;
                    if (hazard.Role == HazardRole.LaserFormationTarget)
                        RetireLaserFormationTarget();
                    continue;
                }

                float dx = Math.Abs(hazard.X - _shipX);
                float dz = Math.Abs(hazard.Z - _config.ShipZ);
                float collisionX = shipHalfWidth + hazard.HalfWidth;

                bool hit;
                if (hazard.Kind == HazardKind.Ring)
                    hit = dz < hazard.HalfDepth && RingHit(hazard);
                else if (hazard.Kind == HazardKind.Wall)
                    hit = WallHit(hazard);
                else if (hazard.Kind == HazardKind.Lightning)
                    hit = hazard.AgeSeconds >= hazard.CollisionDelaySeconds
                        && dx < hazard.HalfWidth
                        && dz < hazard.HalfDepth;
                else if (hazard.Kind == HazardKind.Asteroid)
                    hit = hazard.AgeSeconds >= hazard.CollisionDelaySeconds
                        && dx < collisionX
                        && dz < hazard.HalfDepth;
                else
                    hit = dx < collisionX && dz < hazard.HalfDepth;
                if (_config.CollisionEnabled && !collisionSuppressed && hit)
                {
                    hazard.Active = false;
                    _hazards[i] = hazard;
                    if (hazard.Role == HazardRole.LaserFormationTarget)
                        RetireLaserFormationTarget();
                    if (ConsumeShieldHit(hazard.Id)) continue;
                    if (ConsumeHullHit(hazard.Id)) continue;
                    FinalizeRun();
                    Phase = CoreGamePhase.Dead;
                    Events.Add(new SimulationEvent(SimulationEventType.PlayerDied, hazard.Id, (float)_score, _distance));
                    return;
                }

                if (hazard.NearMissArmed
                    && hazard.Kind != HazardKind.Ring
                    && dx >= collisionX
                    && dx < collisionX + _config.NearMissBand
                    && dz < _config.NearMissDepth)
                {
                    hazard.NearMissArmed = false;
                    AwardScore(_config.NearMissScore, ScoreSource.NearMiss, hazard.Id);
                    Events.Add(new SimulationEvent(SimulationEventType.NearMiss, hazard.Id, (float)_score, 0f));
                }

                _hazards[i] = hazard;
            }
        }

        void RefreshSnapshot()
        {
            Snapshot.Phase = Phase;
            Snapshot.Tick = _tick;
            Snapshot.EligibleRunTick = _eligibleRunTick;
            Snapshot.Elapsed = _elapsed;
            Snapshot.EligibleRunElapsed = (float)(_eligibleRunTick * (double)_config.FixedDeltaSeconds);
            Snapshot.Distance = _distance;
            Snapshot.Score = (float)_score;
            Snapshot.Speed = _speed;
            Snapshot.EffectiveSpeed = _effectiveSpeed;
            Snapshot.PacePersistentCruiseSpeed = _paceState.PersistentCruiseSpeed;
            Snapshot.PaceHeatModifier = _paceState.DepthHeatModifier;
            Snapshot.PaceEncounterModifier = _paceState.EncounterApproachModifier;
            Snapshot.PacePowerupModifier = _paceState.TemporaryPowerupModifier;
            Snapshot.ShipX = _shipX;
            Snapshot.ShipY = _shipY;
            Snapshot.ShipZ = _config.ShipZ;
            Snapshot.ShipVelocityX = _shipVelocityX;
            Snapshot.ShipBankRadians = _bankRadians;
            Snapshot.ShipRollRadians = _rollRadians;
            Snapshot.ShipTiltTimer = _tiltTimer;
            Snapshot.ShieldSeconds = _shieldSeconds;
            Snapshot.ShieldHits = _shieldHits;
            Snapshot.LaserSeconds = _laserSeconds;
            Snapshot.LaserDestructionChain = _laserDestructionChain;
            Snapshot.LaserFormationDestroyed = _laserFormationDestroyed;
            Snapshot.LaserFormationRemaining = _laserFormationRemaining;
            Snapshot.LaserFormationOverloaded = _laserFormationOverloaded;
            Snapshot.OverdriveSeconds = _overdriveSeconds;
            Snapshot.OverdriveSpeedSeconds = Math.Max(0f, _overdriveSeconds - PowerupCatalog.Overdrive.GraceSeconds);
            Snapshot.MagnetSeconds = _magnetSeconds;
            Snapshot.CargoSalvage = _cargo.Salvage;
            Snapshot.CargoAlloy = _cargo.Alloy;
            Snapshot.CargoPrism = _cargo.Prism;
            Snapshot.CargoUnits = _cargo.TotalUnits;
            Snapshot.CargoCapacity = _cargo.CapacityWeight;
            Snapshot.CargoWeight = _cargo.UsedWeight;
            Snapshot.CargoCapacityWeight = _cargo.CapacityWeight;
            Snapshot.CargoBaseCreditValue = _cargo.BaseCreditValue;
            Snapshot.CargoProjectedCreditValue = (int)Math.Round(_cargo.BaseCreditValue * HeatRewardMultiplier(), MidpointRounding.AwayFromZero);
            Snapshot.HeatLevel = _heatLevel;
            Snapshot.HeatRewardMultiplier = HeatRewardMultiplier();
            Snapshot.HeatSpeedMultiplier = _terrainWorld != null || _gateRun != null ? 1f : HeatSpeedMultiplier();
            Snapshot.EncounterIntensity = EncounterIntensity();
            EncounterRuntimeSnapshot encounter = _proofEncounters != null
                ? _proofEncounters.Snapshot
                : default;
            TerrainWorldState terrainWorld = _terrainWorld != null ? _terrainWorld.Snapshot : default;
            GateRunSnapshot gateRun = _gateRun != null ? _gateRun.Snapshot : default;
            Snapshot.GateCount = _terrainWorld == null && _gateRun != null
                ? _gateRun.WriteVisibleGates(
                    _distance,
                    _config.ShipZ,
                    Snapshot.GateBuffer,
                    _config.MaxGates)
                : 0;
            Snapshot.TerrainWorldSectionCount = _terrainWorld != null
                ? _terrainWorld.WriteSections(
                    _distance,
                    _config.ShipZ,
                    Snapshot.TerrainWorldSectionBuffer)
                : 0;
            Snapshot.TerrainWorldFeatureCount = _terrainWorld != null
                ? _terrainWorld.WriteFeatures(
                    _distance,
                    _config.ShipZ,
                    Snapshot.TerrainWorldFeatureBuffer)
                : 0;
            bool gateExtractionVisible = false;
            float gateExtractionX = 0f;
            float gateExtractionZ = 0f;
            float gateExtractionHalfWidth = 0f;
            for (int i = 0; i < Snapshot.GateCount; i++)
            {
                GateSnapshot gate = Snapshot.GetGate(i);
                if (!gate.Active || gate.Kind != SpeedGateKind.Extraction) continue;
                gateExtractionVisible = gate.Z >= -300f && gate.Z <= 40f;
                gateExtractionX = gate.X;
                gateExtractionZ = gate.Z;
                gateExtractionHalfWidth = gate.HalfWidth;
                break;
            }
            Snapshot.ExtractionAvailable = _terrainWorld != null
                ? terrainWorld.ExtractionDecisionOpen
                : _gateRun != null
                ? gateRun.ExtractionDecisionOpen
                : _proofEncounters == null
                    && Phase == CoreGamePhase.Playing
                    && _extractionWindowOpen;
            Snapshot.ExtractionWindowOpen = _terrainWorld != null
                ? terrainWorld.ExtractionDecisionOpen
                : _gateRun != null
                ? gateRun.ExtractionDecisionOpen
                : _proofEncounters == null && _extractionWindowOpen;
            Snapshot.ExtractionDecisionOpen = Phase == CoreGamePhase.Playing
                && (_terrainWorld != null
                    ? terrainWorld.ExtractionDecisionOpen
                    : _gateRun != null && gateRun.ExtractionDecisionOpen);
            Snapshot.ExtractionWindowDistanceRemaining = _terrainWorld != null
                ? terrainWorld.ExtractionDecisionOpen
                    ? 0f
                    : Math.Max(0f, terrainWorld.ExtractionDistance - _distance)
                : _gateRun != null
                ? gateRun.ExtractionDecisionOpen
                    ? 0f
                    : Math.Max(0f, gateRun.NextGateDistance - _distance)
                : _proofEncounters == null && _extractionWindowOpen
                    ? Math.Max(0f, _extractionWindowEndDistance - _distance)
                    : 0f;
            Snapshot.NextExtractionDistance = _terrainWorld != null
                ? terrainWorld.ExtractionDistance
                : _gateRun != null
                ? gateRun.NextGateDistance
                : _proofEncounters != null
                    ? encounter.ExtractionGateDistance
                    : _extractionWindowOpen
                        ? _extractionWindowEndDistance
                        : _nextExtractionDistance;
            Snapshot.HullHitsRemaining = _hullHitsRemaining;
            Snapshot.HullHitCapacity = _config.HullHitCapacity;
            Snapshot.StageDirectorEnabled = _stageDirector != null;
            Snapshot.CoreWorldDirectorEnabled = _stageDirector != null || _proofEncounters != null || _terrainWorld != null || _gateRun != null;
            Snapshot.ProofEncounterMode = _proofEncounters != null;
            Snapshot.GateRunMode = _gateRun != null;
            Snapshot.TerrainWorldMode = _terrainWorld != null;
            Snapshot.TerrainWorldId = terrainWorld.WorldId ?? string.Empty;
            Snapshot.ActiveTerrainRegion = terrainWorld.ActiveRegion;
            Snapshot.ActiveTerrainRegionIndex = terrainWorld.ActiveRegionIndex;
            Snapshot.TerrainRegionProgress01 = terrainWorld.RegionProgress01;
            Snapshot.TerrainWorldStartDistance = terrainWorld.WorldStartDistance;
            Snapshot.TerrainWorldLength = terrainWorld.WorldLength;
            Snapshot.SectorIndex = _terrainWorld != null ? terrainWorld.Sector : gateRun.Sector;
            Snapshot.GateStreak = _terrainWorld != null ? 0 : gateRun.GateStreak;
            Snapshot.HighestGateStreak = _terrainWorld != null ? 0 : gateRun.HighestGateStreak;
            Snapshot.GatesCrossed = _terrainWorld != null ? 0 : gateRun.GatesCrossed;
            Snapshot.GatesMissed = _terrainWorld != null ? 0 : gateRun.GatesMissed;
            Snapshot.GateEarnedSpeed = _terrainWorld != null ? terrainWorld.EarnedSpeedBonus : gateRun.EarnedSpeedBonus;
            Snapshot.SpeedSoftCap = _terrainWorld != null ? terrainWorld.SoftSpeedCap : gateRun.SoftSpeedCap;
            Snapshot.RunEnvironment = _terrainWorld != null
                ? terrainWorld.ActiveRegion == TerrainRegionKind.CrystallineCanyon
                    ? RunEnvironmentKind.CrystallineCanyon
                    : terrainWorld.ActiveRegion == TerrainRegionKind.PrismaticReach
                        ? RunEnvironmentKind.PrismaticCorridor
                        : RunEnvironmentKind.OpenWater
                : gateRun.Environment;
            Snapshot.EnvironmentLifecycle = _environmentEncounter.Active
                ? _environmentEncounter.Lifecycle
                : _terrainWorld != null
                    ? EnvironmentLifecycle.Active
                    : gateRun.EnvironmentLifecycle;
            if (_environmentEncounter.Active)
            {
                EncounterPlan activeEnvironment = _environmentEncounter.Plan;
                Snapshot.EncounterPlanId = activeEnvironment.Id;
                Snapshot.EncounterKind = activeEnvironment.Kind;
                Snapshot.EncounterPlanIndex = _terrainWorld != null ? terrainWorld.Sector : gateRun.Sector;
                Snapshot.EncounterCycle = _terrainWorld != null ? terrainWorld.Sector : gateRun.Sector;
                Snapshot.EncounterProgress01 = Clamp01(
                    (_distance - _environmentEncounter.StartDistance) / activeEnvironment.Length);
                Snapshot.EncounterValidationMargin = 1f;
                Snapshot.EncounterStartZ = _config.ShipZ - (_environmentEncounter.StartDistance - _distance);
                Snapshot.UpcomingEncounterKind = default;
                Snapshot.UpcomingEncounterStartZ = 0f;
            }
            else if (_terrainWorld != null
                && _terrainWorld.TryGetUpcomingPrismatic(out float terrainPrismaticStart))
            {
                Snapshot.EncounterPlanId = string.Empty;
                Snapshot.EncounterKind = default;
                Snapshot.EncounterPlanIndex = terrainWorld.Sector;
                Snapshot.EncounterCycle = terrainWorld.Sector;
                Snapshot.EncounterProgress01 = 0f;
                Snapshot.EncounterValidationMargin = 1f;
                Snapshot.EncounterStartZ = 0f;
                Snapshot.UpcomingEncounterKind = EncounterKind.PrismaticSineCorridor;
                Snapshot.UpcomingEncounterStartZ = _config.ShipZ - (terrainPrismaticStart - _distance);
            }
            else if (_gateRun != null
                && _gateRun.TryGetUpcomingEnvironment(out RunEnvironmentKind upcomingEnvironment, out float upcomingStart))
            {
                Snapshot.EncounterPlanId = string.Empty;
                Snapshot.EncounterKind = default;
                Snapshot.EncounterPlanIndex = gateRun.Sector;
                Snapshot.EncounterCycle = gateRun.Sector;
                Snapshot.EncounterProgress01 = 0f;
                Snapshot.EncounterValidationMargin = 1f;
                Snapshot.EncounterStartZ = 0f;
                Snapshot.UpcomingEncounterKind = upcomingEnvironment == RunEnvironmentKind.CrystallineCanyon
                    ? EncounterKind.CrystallineCanyon
                    : EncounterKind.PrismaticSineCorridor;
                Snapshot.UpcomingEncounterStartZ = _config.ShipZ - (upcomingStart - _distance);
            }
            else
            {
                Snapshot.EncounterPlanId = encounter.PlanId ?? string.Empty;
                Snapshot.EncounterKind = encounter.Kind;
                Snapshot.EncounterPlanIndex = encounter.PlanIndex;
                Snapshot.EncounterCycle = encounter.Cycle;
                Snapshot.EncounterProgress01 = encounter.Progress01;
                Snapshot.EncounterValidationMargin = encounter.ValidationMargin;
                Snapshot.EncounterStartZ = encounter.StartZ;
                Snapshot.UpcomingEncounterKind = encounter.UpcomingKind;
                Snapshot.UpcomingEncounterStartZ = encounter.UpcomingStartZ;
            }
            Snapshot.ExtractionGateVisible = _terrainWorld != null || _gateRun != null ? false : encounter.ExtractionGateVisible;
            Snapshot.ExtractionGateX = _terrainWorld != null ? 0f : _gateRun != null ? gateExtractionX : encounter.ExtractionGateX;
            Snapshot.ExtractionGateHalfWidth = _terrainWorld != null ? 0f : _gateRun != null ? gateExtractionHalfWidth : encounter.ExtractionGateHalfWidth;
            Snapshot.ExtractionGateZ = _terrainWorld != null ? 0f : _gateRun != null ? gateExtractionZ : encounter.ExtractionGateZ;
            bool proofPrismatic = _proofEncounters != null
                && encounter.Kind == EncounterKind.PrismaticSineCorridor
                && CountCorridorSlices() > 0;
            bool gatePrismatic = _environmentEncounter.Active
                && _environmentEncounter.Plan.Kind == EncounterKind.PrismaticSineCorridor
                && CountCorridorSlices() > 0;
            Snapshot.SineCorridorActive = _sineCorridorActive || proofPrismatic || gatePrismatic;
            Snapshot.ZipperActive = _zipperActive;
            Snapshot.SlalomActive = _slalomActive;
            Snapshot.AngledWallsActive = _structuredWallsActive;
            int nearestCorridorSlice = FindNearestCorridorSlice(_config.ShipZ);
            Snapshot.CorridorGapCenter = nearestCorridorSlice >= 0
                ? _corridorSlices[nearestCorridorSlice].CenterX
                : _sineCorridorActive ? _sineGapCenter : _slalomGapCenter;
            Snapshot.ActiveCorridorFamily = nearestCorridorSlice >= 0
                ? _corridorSlices[nearestCorridorSlice].Family
                : _sineCorridor != null ? _sineCorridor.Family : CorridorFamily.None;
            if (_stageDirector != null)
            {
                Snapshot.StageIndex = _stageDirector.StageIndex;
                Snapshot.StageName = _stageDirector.CurrentStage.Name;
                Snapshot.StageElapsed = _stageDirector.StageElapsed;
                Snapshot.SpeedFloor = _stageDirector.SpeedFloor;
                Snapshot.RestBeat = _stageDirector.RestBeat;
                Snapshot.PhysicsTier = _stageDirector.PhysicsTier;
                Snapshot.VibeIndex = _stageDirector.VibeIndex;
                Snapshot.SpawnPattern = _stageDirector.SpawnPattern;
                Snapshot.Density = _stageDirector.Density;
                Snapshot.StageRamp01 = _stageDirector.StageRamp01;
            }
            else
            {
                Snapshot.StageIndex = 0;
                Snapshot.StageName = string.Empty;
                Snapshot.StageElapsed = 0f;
                Snapshot.SpeedFloor = 1f;
                Snapshot.RestBeat = 0f;
                Snapshot.PhysicsTier = 1;
                Snapshot.VibeIndex = 0;
                Snapshot.SpawnPattern = SpawnPattern.None;
                Snapshot.Density = DensityCurve.Normal;
                Snapshot.StageRamp01 = 0f;
            }

            int count = 0;
            for (int i = 0; i < _hazards.Length; i++)
            {
                HazardState hazard = _hazards[i];
                if (!hazard.Active) continue;
                Snapshot.SetHazard(count++, new HazardSnapshot(
                    hazard.Id,
                    hazard.Kind,
                    hazard.Style,
                    hazard.Role,
                    hazard.VisualVariant,
                    hazard.X,
                    hazard.Y,
                    hazard.Z,
                    hazard.HalfWidth,
                    hazard.VisualScale,
                    hazard.VisualScaleY,
                    hazard.VisualScaleZ,
                    hazard.RotationXRadians,
                    hazard.RotationYRadians,
                    hazard.RotationZRadians,
                    hazard.CollisionDelaySeconds,
                    hazard.AgeSeconds,
                    hazard.AgeSeconds >= hazard.CollisionDelaySeconds));
            }
            Snapshot.HazardCount = count;

            int pickupCount = 0;
            for (int i = 0; i < _pickups.Length; i++)
            {
                PickupState pickup = _pickups[i];
                if (!pickup.Active) continue;
                Snapshot.SetPickup(pickupCount++, new PickupSnapshot(
                    pickup.Id,
                    pickup.Kind,
                    pickup.Powerup,
                    pickup.CargoKind,
                    pickup.MotionKind,
                    pickup.CargoUnits,
                    pickup.X,
                    pickup.Y,
                    pickup.Z,
                    pickup.AgeSeconds));
            }
            Snapshot.PickupCount = pickupCount;

            int sliceCount = 0;
            for (int i = 0; i < _corridorSlices.Length; i++)
            {
                CorridorSliceState slice = _corridorSlices[i];
                if (!slice.Active) continue;
                Snapshot.SetCorridorSlice(sliceCount++, new CorridorSliceSnapshot(
                    slice.Id,
                    slice.Family,
                    slice.RowIndex,
                    slice.CenterX,
                    slice.HalfWidth,
                    slice.Z,
                    slice.EnvironmentPhase,
                    slice.CorridorBoundaryActive,
                    slice.TraversalRequirement));
            }
            Snapshot.CorridorSliceCount = sliceCount;
        }

        static float Clamp(float value, float minimum, float maximum)
        {
            return value < minimum ? minimum : value > maximum ? maximum : value;
        }

        static float Clamp01(float value) => Clamp(value, 0f, 1f);
        static float Lerp(float a, float b, float t) => a + (b - a) * Clamp01(t);

        static float MoveTowards(float current, float target, float maximumDelta)
        {
            float delta = target - current;
            if (Math.Abs(delta) <= maximumDelta) return target;
            return current + Math.Sign(delta) * maximumDelta;
        }

        bool RingHit(HazardState ring)
        {
            const int sides = 8;
            for (int i = 0; i < sides; i++)
            {
                float a0 = i / (float)sides * (float)(Math.PI * 2.0) + (float)Math.PI / sides;
                float a1 = (i + 1) / (float)sides * (float)(Math.PI * 2.0) + (float)Math.PI / sides;
                float x0 = ring.X + (float)Math.Cos(a0) * ring.RingRadius;
                float y0 = ring.Y + (float)Math.Sin(a0) * ring.RingRadius;
                float x1 = ring.X + (float)Math.Cos(a1) * ring.RingRadius;
                float y1 = ring.Y + (float)Math.Sin(a1) * ring.RingRadius;
                float sx = x1 - x0;
                float sy = y1 - y0;
                float lengthSquared = sx * sx + sy * sy;
                float t = lengthSquared > 0f
                    ? Clamp(((_shipX - x0) * sx + (_shipY - y0) * sy) / lengthSquared, 0f, 1f)
                    : 0f;
                float dx = _shipX - (x0 + sx * t);
                float dy = _shipY - (y0 + sy * t);
                if (dx * dx + dy * dy < ring.RingTubeRadius * ring.RingTubeRadius) return true;
            }
            return false;
        }

        bool WallHit(HazardState wall)
        {
            float dx = _shipX - wall.X;
            float dy = _shipY - wall.Y;
            float dz = _config.ShipZ - wall.Z;

            // Source geometry uses three.js Euler XYZ (R_x * R_y * R_z). With
            // the production walls' zero Z rotation, inverse OBB projection
            // removes pitch first and yaw second.
            float cx = (float)Math.Cos(wall.RotationXRadians);
            float sx = (float)Math.Sin(wall.RotationXRadians);
            float localY = cx * dy + sx * dz;
            float pitchRemovedZ = -sx * dy + cx * dz;

            float cy = (float)Math.Cos(wall.RotationYRadians);
            float sy = (float)Math.Sin(wall.RotationYRadians);
            float localX = cy * dx - sy * pitchRemovedZ;
            float localZ = sy * dx + cy * pitchRemovedZ;

            const float shipHalf = 0.3f;
            return Math.Abs(localX) < wall.HalfWidth + shipHalf
                && Math.Abs(localY) < wall.HalfHeight + shipHalf
                && Math.Abs(localZ) < wall.HalfDepth + shipHalf;
        }

        static void ValidateHazard(HazardSpawn spawn)
        {
            if (float.IsNaN(spawn.X) || float.IsNaN(spawn.Y) || float.IsNaN(spawn.Z))
                throw new ArgumentOutOfRangeException(nameof(spawn));
            if (spawn.CollisionHalfDepth <= 0f) throw new ArgumentOutOfRangeException(nameof(spawn.CollisionHalfDepth));
            if (spawn.VisualScale <= 0f) throw new ArgumentOutOfRangeException(nameof(spawn.VisualScale));
            if (spawn.Kind == HazardKind.Wall && spawn.CollisionHalfHeight <= 0f)
                throw new ArgumentOutOfRangeException(nameof(spawn.CollisionHalfHeight));
            if (spawn.Kind == HazardKind.Ring && (spawn.RingRadius <= 0f || spawn.RingTubeRadius <= 0f))
                throw new ArgumentOutOfRangeException(nameof(spawn.RingRadius));
        }

        void TickLaserWeapon(float dt)
        {
            _laserShotTimer += dt;
            float interval = 1f / (ShipCatalog.Runner.Lasers.FireRate
                * (0.85f + _config.LaserPowerMultiplier * .15f));
            while (_laserShotTimer >= interval)
            {
                _laserShotTimer -= interval;
                FireLaserLane(-0.35f);
                FireLaserLane(0.35f);
            }
        }

        void FireLaserLane(float laneOffset)
        {
            float laneX = _shipX + laneOffset;
            int bestIndex = -1;
            float bestZ = float.MinValue;
            for (int i = 0; i < _hazards.Length; i++)
            {
                HazardState hazard = _hazards[i];
                if (!hazard.Active || hazard.Style == HazardStyle.CorridorCone || hazard.Style == HazardStyle.L4CorridorCone || hazard.Style == HazardStyle.L5CorridorCone)
                    continue;
                if (hazard.Z >= _config.ShipZ || hazard.Z < -200f) continue;
                if (Math.Abs(hazard.X - laneX) >= 1.5f) continue;
                if (hazard.Z > bestZ) { bestZ = hazard.Z; bestIndex = i; }
            }

            int destroyedId = 0;
            if (bestIndex >= 0)
            {
                HazardState hazard = _hazards[bestIndex];
                destroyedId = hazard.Id;
                hazard.Active = false;
                _hazards[bestIndex] = hazard;
                if (hazard.Role == HazardRole.LaserFormationTarget)
                    RewardLaserFormationDestruction(hazard);
                Events.Add(new SimulationEvent(SimulationEventType.HazardDestroyed, destroyedId, hazard.X, hazard.Z));
            }
            Events.Add(new SimulationEvent(SimulationEventType.LaserFired, destroyedId, laneOffset, bestZ));
        }

        void RewardLaserFormationDestruction(HazardState hazard)
        {
            if (!_laserFormationActive || _laserFormationOverloaded) return;
            _laserFormationRemaining = Math.Max(0, _laserFormationRemaining - 1);
            _laserFormationDestroyed++;
            _laserDestructionChain = _laserChainTimer > 0f
                ? _laserDestructionChain + 1
                : 1;
            _laserChainTimer = LaserRewardModel.ChainWindowSeconds;
            Events.Add(new SimulationEvent(
                SimulationEventType.LaserChainAdvanced,
                hazard.Id,
                _laserDestructionChain,
                _laserFormationDestroyed));

            float score = RunScoreModel.LaserDestructionScore(_laserDestructionChain);
            _score += score;
            Events.Add(new SimulationEvent(
                SimulationEventType.ScoreChanged,
                hazard.Id,
                (float)_score,
                (float)ScoreSource.Bonus));

            if (LaserRewardModel.AwardsMilestoneCargo(_laserFormationDestroyed))
            {
                SpawnLaserRewardCargo(
                    LaserRewardModel.MilestoneCargo(_laserFormationDestroyed),
                    hazard.X,
                    hazard.Z,
                    _laserFormationDestroyed);
            }

            if (_laserFormationDestroyed >= LaserRewardModel.OverloadTargetCount)
                CompleteLaserFormation(hazard.Z);
        }

        void CompleteLaserFormation(float burstZ)
        {
            if (!_laserFormationActive || _laserFormationOverloaded) return;
            _laserFormationOverloaded = true;
            _laserFormationActive = false;
            for (int i = 0; i < _hazards.Length; i++)
            {
                HazardState target = _hazards[i];
                if (!target.Active || target.Role != HazardRole.LaserFormationTarget) continue;
                target.Active = false;
                _hazards[i] = target;
            }
            _laserFormationRemaining = 0;
            for (int i = 0; i < LaserRewardModel.FinalCargoCount; i++)
            {
                float offset = (i - 1) * 2.8f;
                SpawnLaserRewardCargo(
                    LaserRewardModel.FinalCargo(i),
                    _laserFormationCenterX + offset,
                    burstZ - 1.2f - i * .7f,
                    20 + i);
            }
            _score += RunScoreModel.LaserFormationOverloadScore;
            Events.Add(new SimulationEvent(
                SimulationEventType.ScoreChanged,
                _laserFormationId,
                (float)_score,
                (float)ScoreSource.Bonus));
            Events.Add(new SimulationEvent(
                SimulationEventType.LaserFormationCompleted,
                _laserFormationId,
                _laserFormationCenterX,
                burstZ));
        }

        void SpawnLaserRewardCargo(RunCargoKind kind, float x, float z, int sequence)
        {
            double phase = sequence * 2.399963229728653;
            float velocityX = (float)Math.Sin(phase) * 8f;
            float velocityY = 3.5f + Math.Abs((float)Math.Cos(phase)) * 2.5f;
            float velocityZ = (float)Math.Cos(phase) * 4f;
            SpawnPickup(PickupSpawn.LaserCargo(
                kind,
                1,
                x,
                1.35f,
                z,
                velocityX,
                velocityY,
                velocityZ));
        }

        void UpdatePickups(float step)
        {
            for (int i = 0; i < _pickups.Length; i++)
            {
                PickupState pickup = _pickups[i];
                if (!pickup.Active) continue;
                pickup.AgeSeconds += _config.FixedDeltaSeconds;
                if (pickup.MotionKind == PickupMotionKind.LaserReward)
                {
                    pickup.X += pickup.VelocityX * _config.FixedDeltaSeconds;
                    pickup.Y += pickup.VelocityY * _config.FixedDeltaSeconds;
                    pickup.Z += step + pickup.VelocityZ * _config.FixedDeltaSeconds;
                    float damping = Math.Max(0f, 1f - 4.8f * _config.FixedDeltaSeconds);
                    pickup.VelocityX *= damping;
                    pickup.VelocityY *= damping;
                    pickup.VelocityZ *= damping;
                    if (pickup.AgeSeconds >= pickup.AttractionDelaySeconds)
                    {
                        float attractionAge = pickup.AgeSeconds - pickup.AttractionDelaySeconds;
                        float xResponse = Math.Min(1f, _config.FixedDeltaSeconds * (3.8f + attractionAge * 1.4f));
                        float zResponse = Math.Min(1f, _config.FixedDeltaSeconds * (2.2f + attractionAge * .8f));
                        pickup.X = Lerp(pickup.X, _shipX, xResponse);
                        pickup.Y = Lerp(pickup.Y, _shipY + .2f, xResponse * .65f);
                        pickup.Z = Lerp(pickup.Z, _config.ShipZ, zResponse);
                    }
                }
                else
                {
                    pickup.Z += step;
                }

                if (_magnetSeconds > 0f && pickup.Kind == PickupKind.Coin)
                {
                    float dx = pickup.X - _shipX;
                    float dz = pickup.Z - _config.ShipZ;
                    float radius = PowerupCatalog.Magnet.Radius * _config.MagnetPowerMultiplier;
                    if (dx * dx + dz * dz < radius * radius)
                    {
                        pickup.X -= dx * 5f * _config.FixedDeltaSeconds;
                        pickup.Z -= dz * 3f * _config.FixedDeltaSeconds;
                    }
                }
                if (pickup.Z > _config.DespawnZ)
                {
                    pickup.Active = false;
                    _pickups[i] = pickup;
                    continue;
                }

                if (Math.Abs(pickup.X - _shipX) < pickup.CollectHalfWidth
                    && Math.Abs(pickup.Z - _config.ShipZ) < pickup.CollectHalfDepth)
                {
                    pickup.Active = false;
                    _pickups[i] = pickup;
                    if (pickup.Kind == PickupKind.Powerup)
                    {
                        Events.Add(new SimulationEvent(
                            SimulationEventType.PowerupCollected,
                            pickup.Id,
                            (float)pickup.Powerup));
                        ActivatePowerup(pickup.Powerup);
                    }
                    else if (pickup.Kind == PickupKind.Cargo)
                    {
                        if (_cargo.TryCollect(pickup.CargoKind, pickup.CargoUnits))
                        {
                            CargoDefinition definition = CargoCatalog.Get(pickup.CargoKind);
                            float cargoScore = RunScoreModel.CargoPickupScore(pickup.CargoKind, pickup.CargoUnits);
                            _score += cargoScore;
                            Events.Add(new SimulationEvent(
                                SimulationEventType.ScoreChanged,
                                pickup.Id,
                                (float)_score,
                                (float)ScoreSource.Pickup));
                            Events.Add(new SimulationEvent(
                                SimulationEventType.CargoCollected,
                                pickup.Id,
                                (float)pickup.CargoKind,
                                definition.CreditValue * pickup.CargoUnits));
                        }
                        else
                        {
                            Events.Add(new SimulationEvent(
                                SimulationEventType.CargoRejectedForWeight,
                                pickup.Id,
                                _cargo.UsedWeight,
                                _cargo.CapacityWeight));
                        }
                    }
                    else
                    {
                        AwardScore(pickup.ScoreValue, ScoreSource.Pickup, pickup.Id);
                        Events.Add(new SimulationEvent(
                            SimulationEventType.PickupCollected,
                            pickup.Id,
                            (float)_score,
                            pickup.ScoreValue));
                    }
                    continue;
                }
                _pickups[i] = pickup;
            }
        }

        static void ValidatePickup(PickupSpawn spawn)
        {
            if (float.IsNaN(spawn.X) || float.IsNaN(spawn.Y) || float.IsNaN(spawn.Z))
                throw new ArgumentOutOfRangeException(nameof(spawn));
            if (spawn.ScoreValue < 0f) throw new ArgumentOutOfRangeException(nameof(spawn.ScoreValue));
            if (spawn.CollectHalfWidth <= 0f) throw new ArgumentOutOfRangeException(nameof(spawn.CollectHalfWidth));
            if (spawn.CollectHalfDepth <= 0f) throw new ArgumentOutOfRangeException(nameof(spawn.CollectHalfDepth));
            if (spawn.Kind == PickupKind.Powerup && spawn.Powerup == PowerupType.None)
                throw new ArgumentOutOfRangeException(nameof(spawn.Powerup));
            if (spawn.Kind == PickupKind.Cargo && spawn.CargoUnits <= 0)
                throw new ArgumentOutOfRangeException(nameof(spawn.CargoUnits));
        }

        RunResult FinalizeRun(RunCompletionReason completionReason = RunCompletionReason.Destroyed)
        {
            if (LatestRunResult != null) return LatestRunResult;
            if (_runId <= 0L) _runId = ++_fallbackRunId;

            long rawScore = Math.Max(0L, (long)Math.Floor(_score));
            float steps = (float)Math.Floor(_distance / _config.DistanceBonusStep);
            float multiplier = Math.Max(1f, 1f + steps * _config.DistanceBonusPerStep);
            long finalScore = Math.Max(0L, (long)Math.Floor(rawScore * (double)multiplier));
            RunCargoManifest cargo = _cargo.Snapshot(_heatLevel, HeatRewardMultiplier());
            bool extracted = completionReason == RunCompletionReason.Extracted;
            _score = finalScore;
            LatestRunResult = new RunResult(
                _runId,
                rawScore,
                finalScore,
                _distance,
                multiplier,
                _tick,
                _eligibleRunTick,
                _config.FixedDeltaSeconds,
                _repairCount,
                _leaderboardIneligibility,
                _gateRun?.Snapshot.GatesCrossed ?? 0,
                _gateRun?.Snapshot.GatesMissed ?? 0,
                _gateRun?.Snapshot.HighestGateStreak ?? 0,
                _terrainWorld?.Snapshot.Sector ?? _gateRun?.Snapshot.Sector ?? 0,
                _terrainWorld?.Snapshot.Heat ?? _gateRun?.Snapshot.Heat ?? _heatLevel,
                _seed,
                _terrainWorld != null ? "terrain-world" : _gateRun != null ? "gate-run" : _proofEncounters != null ? "proof" : "legacy",
                cargo.TotalUnits,
                extracted ? cargo.TotalUnits : 0,
                extracted ? 0 : cargo.TotalUnits,
                _heroEncountersCompleted,
                completionReason);
            Events.Add(new SimulationEvent(
                SimulationEventType.ScoreChanged,
                0,
                (float)finalScore,
                (float)ScoreSource.FinalMultiplier));
            return LatestRunResult;
        }
    }
}
