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
            public float X;
            public float Y;
            public float Z;
            public float HalfWidth;
            public float HalfDepth;
            public float VisualScale;
            public float RingRadius;
            public float RingTubeRadius;
        }

        readonly SimulationConfig _config;
        readonly uint _seed;
        readonly DeterministicRandom _random;
        readonly HazardState[] _hazards;
        readonly StageDirector _stageDirector;

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
            _stageDirector = runDefinition == null ? null : new StageDirector(runDefinition);
            Snapshot = new SimulationSnapshot(_config.MaxHazards);
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

            _effectiveSpeed = world.OverdriveActive ? _speed * 1.8f : _speed;
            float step = _effectiveSpeed * dt;
            if (_config.ProgressionEnabled && !world.ProgressionSuspended)
            {
                _distance += step;
                _score += _config.ScoreRatePerSecond * Math.Max(1f, _speed / _config.BaseSpeed) * dt;
            }

            if (_config.HazardSpawningEnabled)
            {
                _distanceUntilSpawn -= step;
                while (_distanceUntilSpawn <= 0f)
                {
                    SpawnStandardHazard();
                    _distanceUntilSpawn += _config.SpawnIntervalDistance;
                }
            }

            if (_config.HazardSimulationEnabled)
                UpdateHazards(step, world.CollisionSuppressed);

            if (_stageDirector != null && Phase == CoreGamePhase.Playing)
            {
                _stageDirector.Tick(dt, world, _random, Events, StageCommands);
                _speed = _stageDirector.Speed;
                _effectiveSpeed = world.OverdriveActive ? _speed * 1.8f : _speed;
            }
            RefreshSnapshot();
        }

        void ResetRunState(SimulationEventBuffer events)
        {
            _random.Reset(_seed);
            Array.Clear(_hazards, 0, _hazards.Length);
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
                X = spawn.X,
                Y = spawn.Y,
                Z = spawn.Z,
                HalfWidth = spawn.CollisionHalfWidth,
                HalfDepth = spawn.CollisionHalfDepth,
                VisualScale = spawn.VisualScale,
                RingRadius = spawn.RingRadius,
                RingTubeRadius = spawn.RingTubeRadius
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

                hazard.Z += step;
                if (hazard.Z > _config.DespawnZ)
                {
                    hazard.Active = false;
                    _hazards[i] = hazard;
                    continue;
                }

                float dx = Math.Abs(hazard.X - _shipX);
                float dz = Math.Abs(hazard.Z - _config.ShipZ);
                float collisionX = shipHalfWidth + hazard.HalfWidth;

                bool hit = hazard.Kind == HazardKind.Ring
                    ? dz < hazard.HalfDepth && RingHit(hazard)
                    : dx < collisionX && dz < hazard.HalfDepth;
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
                    hazard.X,
                    hazard.Y,
                    hazard.Z,
                    hazard.HalfWidth,
                    hazard.VisualScale));
            }
            Snapshot.HazardCount = count;
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

        static void ValidateHazard(HazardSpawn spawn)
        {
            if (float.IsNaN(spawn.X) || float.IsNaN(spawn.Y) || float.IsNaN(spawn.Z))
                throw new ArgumentOutOfRangeException(nameof(spawn));
            if (spawn.CollisionHalfDepth <= 0f) throw new ArgumentOutOfRangeException(nameof(spawn.CollisionHalfDepth));
            if (spawn.VisualScale <= 0f) throw new ArgumentOutOfRangeException(nameof(spawn.VisualScale));
            if (spawn.Kind == HazardKind.Ring && (spawn.RingRadius <= 0f || spawn.RingTubeRadius <= 0f))
                throw new ArgumentOutOfRangeException(nameof(spawn.RingRadius));
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
