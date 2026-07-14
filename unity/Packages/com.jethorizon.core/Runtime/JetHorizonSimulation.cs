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
            public float X;
            public float Z;
            public float HalfWidth;
        }

        readonly SimulationConfig _config;
        readonly uint _seed;
        readonly DeterministicRandom _random;
        readonly HazardState[] _hazards;

        long _tick;
        float _elapsed;
        float _distance;
        float _score;
        float _speed;
        float _shipX;
        float _shipY;
        float _shipVelocityX;
        float _rollRadians;
        float _tiltTimer;
        float _bankVelocityX;
        float _bankRadians;
        float _distanceUntilSpawn;
        int _nextEntityId;

        public CoreGamePhase Phase { get; private set; }
        public SimulationSnapshot Snapshot { get; }
        public SimulationEventBuffer Events { get; }
        public SimulationConfig Config => _config.Clone();
        public float FixedDeltaSeconds => _config.FixedDeltaSeconds;

        public JetHorizonSimulation(SimulationConfig config, uint seed)
        {
            if (config == null) throw new ArgumentNullException(nameof(config));
            config.Validate();
            _config = config.Clone();
            _seed = seed;
            _random = new DeterministicRandom(seed);
            _hazards = new HazardState[_config.MaxHazards];
            Snapshot = new SimulationSnapshot(_config.MaxHazards);
            Events = new SimulationEventBuffer(16);
            ResetToTitle();
        }

        public void ResetToTitle()
        {
            Phase = CoreGamePhase.Title;
            ResetRunState();
            _shipY = _config.ShipPreLaunchY;
            Events.Clear();
            RefreshSnapshot();
        }

        public void StartRun()
        {
            ResetRunState();
            Phase = CoreGamePhase.Playing;
            Events.Clear();
            Events.Add(new SimulationEvent(SimulationEventType.RunStarted));
            RefreshSnapshot();
        }

        public void SetPaused(bool paused)
        {
            if (paused && Phase == CoreGamePhase.Playing) Phase = CoreGamePhase.Paused;
            else if (!paused && Phase == CoreGamePhase.Paused) Phase = CoreGamePhase.Playing;
            RefreshSnapshot();
        }

        public void Step(InputFrame input)
        {
            Events.Clear();
            if (Phase != CoreGamePhase.Playing)
            {
                RefreshSnapshot();
                return;
            }

            float dt = _config.FixedDeltaSeconds;
            _tick++;
            _elapsed += dt;

            UpdateShip(input, dt);

            float step = _speed * dt;
            _distance += step;
            _score += _config.ScoreRatePerSecond * Math.Max(1f, _speed / _config.BaseSpeed) * dt;

            _distanceUntilSpawn -= step;
            while (_distanceUntilSpawn <= 0f)
            {
                SpawnStandardHazard();
                _distanceUntilSpawn += _config.SpawnIntervalDistance;
            }

            UpdateHazards(step);
            RefreshSnapshot();
        }

        void ResetRunState()
        {
            _random.Reset(_seed);
            Array.Clear(_hazards, 0, _hazards.Length);
            _tick = 0;
            _elapsed = 0f;
            _distance = 0f;
            _score = 0f;
            _speed = _config.BaseSpeed * _config.StartSpeedMultiplier;
            _shipX = 0f;
            _shipY = _config.ShipHoverY;
            _shipVelocityX = 0f;
            _rollRadians = 0f;
            _tiltTimer = 0f;
            _bankVelocityX = 0f;
            _bankRadians = 0f;
            _distanceUntilSpawn = _config.InitialSpawnDistance;
            _nextEntityId = 1;
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

            _shipY = _config.ShipHoverY
                + (float)Math.Sin(_elapsed * _config.HoverFrequency * Math.PI * 2.0) * _config.HoverAmplitude;
        }

        void SpawnStandardHazard()
        {
            int slot = -1;
            for (int i = 0; i < _hazards.Length; i++)
            {
                if (!_hazards[i].Active) { slot = i; break; }
            }
            if (slot < 0) return;

            int lane = _random.NextInt(0, _config.LaneCount);
            float centerLane = (_config.LaneCount - 1) * 0.5f;
            float x = _shipX + (lane - centerLane) * _config.LaneWidth;
            int id = _nextEntityId++;

            _hazards[slot] = new HazardState
            {
                Active = true,
                NearMissArmed = true,
                Id = id,
                X = x,
                Z = _config.SpawnZ,
                HalfWidth = _config.HazardHalfWidth
            };
            Events.Add(new SimulationEvent(SimulationEventType.HazardSpawned, id, x, _config.SpawnZ));
        }

        void UpdateHazards(float step)
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

                if (_config.CollisionEnabled && dx < collisionX && dz < _config.CollisionHalfDepth)
                {
                    hazard.Active = false;
                    _hazards[i] = hazard;
                    Phase = CoreGamePhase.Dead;
                    Events.Add(new SimulationEvent(SimulationEventType.PlayerDied, hazard.Id, _score, _distance));
                    return;
                }

                if (hazard.NearMissArmed
                    && dx >= collisionX
                    && dx < collisionX + _config.NearMissBand
                    && dz < _config.NearMissDepth)
                {
                    hazard.NearMissArmed = false;
                    _score += _config.NearMissScore;
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
            Snapshot.ShipX = _shipX;
            Snapshot.ShipY = _shipY;
            Snapshot.ShipZ = _config.ShipZ;
            Snapshot.ShipVelocityX = _shipVelocityX;
            Snapshot.ShipBankRadians = _bankRadians;
            Snapshot.ShipRollRadians = _rollRadians;

            int count = 0;
            for (int i = 0; i < _hazards.Length; i++)
            {
                HazardState hazard = _hazards[i];
                if (!hazard.Active) continue;
                Snapshot.SetHazard(count++, new HazardSnapshot(hazard.Id, hazard.X, hazard.Z, hazard.HalfWidth));
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
    }
}
