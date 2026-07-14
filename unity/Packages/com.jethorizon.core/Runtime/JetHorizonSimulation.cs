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
            public float AgeSeconds;
            public float CollisionDelaySeconds;
            public float LifetimeSeconds;
        }

        struct PickupState
        {
            public bool Active;
            public int Id;
            public PickupKind Kind;
            public float X;
            public float Y;
            public float Z;
            public float ScoreValue;
            public float CollectHalfWidth;
            public float CollectHalfDepth;
        }

        readonly SimulationConfig _config;
        readonly uint _seed;
        readonly DeterministicRandom _random;
        readonly HazardState[] _hazards;
        readonly PickupState[] _pickups;
        readonly StageDirector _stageDirector;
        readonly int[] _laneScratch;
        readonly int[] _blockedLaneScratch;

        long _tick;
        float _elapsed;
        float _distance;
        float _score;
        float _speed;
        float _effectiveSpeed;
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
        CorridorFamily _lightningFamily;
        float _lightningTimer;

        public CoreGamePhase Phase { get; private set; }
        public SimulationSnapshot Snapshot { get; }
        public SimulationEventBuffer Events { get; }
        public StageCommandBuffer StageCommands { get; }
        public SimulationConfig Config => _config.Clone();
        public float FixedDeltaSeconds => _config.FixedDeltaSeconds;

        public JetHorizonSimulation(SimulationConfig config, uint seed, RunDefinition runDefinition = null)
        {
            if (config == null) throw new ArgumentNullException(nameof(config));
            config.Validate();
            _config = config.Clone();
            _seed = seed;
            _random = new DeterministicRandom(seed);
            _hazards = new HazardState[_config.MaxHazards];
            _pickups = new PickupState[_config.MaxPickups];
            _stageDirector = runDefinition == null ? null : new StageDirector(runDefinition);
            _laneScratch = new int[_config.LaneCount];
            _blockedLaneScratch = new int[_config.LaneCount];
            Snapshot = new SimulationSnapshot(_config.MaxHazards, _config.MaxPickups);
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

        public void StartRun()
        {
            Events.Clear();
            StageCommands.Clear();
            ResetRunState(Events);
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
            _speed = Math.Max(0f, speed);
            _stageDirector?.SetExternalSpeed(_speed);
            RefreshSnapshot();
        }

        public void ForcePlayerDeath()
        {
            Events.Clear();
            if (Phase == CoreGamePhase.Dead) return;
            ApplyFinalScoreMultiplier();
            Phase = CoreGamePhase.Dead;
            Events.Add(new SimulationEvent(SimulationEventType.PlayerDied, 0, _score, _distance));
            RefreshSnapshot();
        }

        public void AwardScore(float amount, ScoreSource source, int entityId = 0)
        {
            if (float.IsNaN(amount) || float.IsInfinity(amount) || amount < 0f)
                throw new ArgumentOutOfRangeException(nameof(amount));
            if (amount == 0f || Phase == CoreGamePhase.Dead) return;
            _score += amount;
            Events.Add(new SimulationEvent(SimulationEventType.ScoreChanged, entityId, _score, (float)source));
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
                _hazards[i].Active = false;
                RefreshSnapshot();
                return true;
            }
            return false;
        }

        public void ClearHazards()
        {
            Array.Clear(_hazards, 0, _hazards.Length);
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
                X = spawn.X,
                Y = spawn.Y,
                Z = spawn.Z,
                ScoreValue = spawn.ScoreValue,
                CollectHalfWidth = spawn.CollectHalfWidth,
                CollectHalfDepth = spawn.CollectHalfDepth
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
            _elapsed += dt;

            UpdateShip(input, dt);

            if (_stageDirector != null)
            {
                _stageDirector.Tick(dt, world, _random, Events, StageCommands);
                _speed = _stageDirector.Speed;
            }

            TickLightningSpawner(dt, world);

            _effectiveSpeed = world.OverdriveActive ? _speed * 1.8f : _speed;
            float step = _effectiveSpeed * dt;
            if (_config.ProgressionEnabled && !world.ProgressionSuspended)
            {
                _distance += step;
                _score += _config.ScoreRatePerSecond * Math.Max(1f, _speed / _config.BaseSpeed) * dt;
            }

            if (_config.HazardSpawningEnabled)
                TickWorldSpawner(step, world);

            if (_config.HazardSimulationEnabled)
                UpdateHazards(step, world.CollisionSuppressed);

            if (_config.PickupSimulationEnabled && Phase == CoreGamePhase.Playing)
                UpdatePickups(step);

            RefreshSnapshot();
        }

        void ResetRunState(SimulationEventBuffer events)
        {
            _random.Reset(_seed);
            Array.Clear(_hazards, 0, _hazards.Length);
            Array.Clear(_pickups, 0, _pickups.Length);
            _tick = 0;
            _elapsed = 0f;
            _distance = 0f;
            _score = 0f;
            _speed = _config.BaseSpeed * _config.StartSpeedMultiplier;
            _effectiveSpeed = _speed;
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
            _lightningFamily = CorridorFamily.None;
            _lightningTimer = 0f;
            if (_stageDirector != null)
            {
                _stageDirector.Reset(events);
                _speed = _stageDirector.Speed;
                _effectiveSpeed = _speed;
            }
        }

        void UpdateShip(InputFrame input, float dt)
        {
            int steer = input.SteerLeft == input.SteerRight ? 0 : input.SteerLeft ? -1 : 1;

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
            bool crossingZero = Math.Sign(bankTarget) != Math.Sign(_bankRadians) && Math.Abs(_bankRadians) > 0.0001f;
            float bankRate = _config.BankSmoothing * (crossingZero ? _config.BankZeroCrossMultiplier : 1f);
            _bankRadians += (bankTarget - _bankRadians) * Math.Min(1f, bankRate * dt);

            float bobTarget = Math.Abs(_shipVelocityX) > 0.5f ? 0f : 1f;
            float bobRate = bobTarget < _bobSteerBlend ? 4f : 2f;
            _bobSteerBlend = MoveTowards(_bobSteerBlend, bobTarget, bobRate * dt);
            _shipY = _config.ShipHoverY
                + (float)Math.Sin(_elapsed * _config.HoverFrequency * Math.PI * 2.0)
                * _config.HoverAmplitude * _bobSteerBlend;
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
                float travelTime = 83f / Math.Max(1f, _speed);
                float targetX = _shipX
                    + (_random.NextFloat() - 0.5f) * 3f
                    + _shipVelocityX * travelTime * 0.6f;
                SpawnHazard(HazardSpawn.Lightning(targetX, _config.ShipZ - 83f));
            }
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
                AgeSeconds = 0f,
                CollisionDelaySeconds = spawn.CollisionDelaySeconds,
                LifetimeSeconds = spawn.LifetimeSeconds
            };
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
                hazard.Z += step;
                if (hazard.Z > _config.DespawnZ
                    || (hazard.LifetimeSeconds > 0f && hazard.AgeSeconds >= hazard.LifetimeSeconds))
                {
                    hazard.Active = false;
                    _hazards[i] = hazard;
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
                else
                    hit = dx < collisionX && dz < hazard.HalfDepth;
                if (_config.CollisionEnabled && !collisionSuppressed && hit)
                {
                    hazard.Active = false;
                    _hazards[i] = hazard;
                    ApplyFinalScoreMultiplier();
                    Phase = CoreGamePhase.Dead;
                    Events.Add(new SimulationEvent(SimulationEventType.PlayerDied, hazard.Id, _score, _distance));
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
                    Events.Add(new SimulationEvent(SimulationEventType.NearMiss, hazard.Id, _score, 0f));
                }

                _hazards[i] = hazard;
            }
        }

        void RefreshSnapshot()
        {
            Snapshot.Phase = Phase;
            Snapshot.Tick = _tick;
            Snapshot.Elapsed = _elapsed;
            Snapshot.Distance = _distance;
            Snapshot.Score = _score;
            Snapshot.Speed = _speed;
            Snapshot.EffectiveSpeed = _effectiveSpeed;
            Snapshot.ShipX = _shipX;
            Snapshot.ShipY = _shipY;
            Snapshot.ShipZ = _config.ShipZ;
            Snapshot.ShipVelocityX = _shipVelocityX;
            Snapshot.ShipBankRadians = _bankRadians;
            Snapshot.ShipRollRadians = _rollRadians;
            Snapshot.ShipTiltTimer = _tiltTimer;
            Snapshot.StageDirectorEnabled = _stageDirector != null;
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
                    pickup.X,
                    pickup.Y,
                    pickup.Z));
            }
            Snapshot.PickupCount = pickupCount;
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

            // Unity's Quaternion.Euler(x, y, 0) applies X then Y. Inverting the
            // transform therefore removes yaw first and pitch second. Keeping this
            // math here makes the gameplay shape replayable without UnityEngine.
            float cy = (float)Math.Cos(wall.RotationYRadians);
            float sy = (float)Math.Sin(wall.RotationYRadians);
            float localX = cy * dx - sy * dz;
            float yawRemovedZ = sy * dx + cy * dz;

            float cx = (float)Math.Cos(wall.RotationXRadians);
            float sx = (float)Math.Sin(wall.RotationXRadians);
            float localY = cx * dy + sx * yawRemovedZ;
            float localZ = -sx * dy + cx * yawRemovedZ;

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

        void UpdatePickups(float step)
        {
            for (int i = 0; i < _pickups.Length; i++)
            {
                PickupState pickup = _pickups[i];
                if (!pickup.Active) continue;
                pickup.Z += step;
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
                    AwardScore(pickup.ScoreValue, ScoreSource.Pickup, pickup.Id);
                    Events.Add(new SimulationEvent(
                        SimulationEventType.PickupCollected,
                        pickup.Id,
                        _score,
                        pickup.ScoreValue));
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
        }

        void ApplyFinalScoreMultiplier()
        {
            float steps = (float)Math.Floor(_distance / _config.DistanceBonusStep);
            float multiplier = Math.Max(1f, 1f + steps * _config.DistanceBonusPerStep);
            _score = (float)Math.Floor(_score) * multiplier;
            Events.Add(new SimulationEvent(
                SimulationEventType.ScoreChanged,
                0,
                _score,
                (float)ScoreSource.FinalMultiplier));
        }
    }
}
