using System;

namespace JetHorizon.Simulation
{
    /// <summary>
    /// Pure campaign sequencer. It decides stage timing, speed, spawn policy and mechanic
    /// commands; an engine adapter realizes those commands as pooled visuals and effects.
    /// </summary>
    public sealed class StageDirector
    {
        const float PreCorridorQuietSeconds = 4f;
        const float SpeedDeferDeadlineSeconds = 8f;
        const float EndlessBlockSeconds = 15f;
        const float EndlessRestSeconds = 4f;

        enum EndlessKind
        {
            RandomCones,
            AngledRandom,
            Lethal,
            FatCones,
            AngledStructured,
            Zipper,
            Slalom,
            L3Corridor,
            L4Corridor
        }

        static readonly EndlessKind[] EndlessRotation =
        {
            EndlessKind.RandomCones,
            EndlessKind.AngledRandom,
            EndlessKind.Lethal,
            EndlessKind.FatCones,
            EndlessKind.AngledStructured,
            EndlessKind.Zipper,
            EndlessKind.Slalom,
            EndlessKind.L3Corridor,
            EndlessKind.L4Corridor
        };

        readonly RunDefinition _run;

        float _stageElapsed;
        bool _corridorLaunched;
        bool _klaxonFired;
        float _structuredWallTimer;
        bool _speedPending;
        float _pendingSpeed;
        float _pendingSince;
        int _endlessIndex;
        float _endlessElapsed;
        bool _endlessResting;
        int _waveCount;
        int _wavesSinceCorridor;

        public int StageIndex { get; private set; }
        public float StageElapsed => _stageElapsed;
        public float Speed { get; private set; }
        public float SpeedFloor { get; private set; }
        public float RestBeat { get; private set; }
        public int PhysicsTier { get; private set; }
        public int VibeIndex { get; private set; }
        public SpawnPattern SpawnPattern { get; private set; }
        public DensityCurve Density { get; private set; }
        public float StageRamp01 { get; private set; }
        public StageDefinition CurrentStage => _run.GetStage(StageIndex);

        public StageDirector(RunDefinition run)
        {
            _run = run ?? throw new ArgumentNullException(nameof(run));
            Reset(null);
        }

        public void Reset(SimulationEventBuffer events)
        {
            StageIndex = 0;
            _stageElapsed = 0f;
            _corridorLaunched = false;
            _klaxonFired = false;
            _structuredWallTimer = 0f;
            _speedPending = false;
            _pendingSpeed = 0f;
            _pendingSince = 0f;
            _endlessIndex = 0;
            _endlessElapsed = 0f;
            _endlessResting = true;
            _waveCount = 0;
            _wavesSinceCorridor = 99;
            SpeedFloor = 1f;
            RestBeat = 0f;

            StageDefinition stage = CurrentStage;
            Speed = _run.BaseSpeed * Math.Max(stage.SpeedMultiplier, SpeedFloor);
            PhysicsTier = stage.PhysicsTier;
            VibeIndex = stage.VibeIndex;
            SpawnPattern = PatternFor(stage.Kind);
            Density = stage.Density;
            StageRamp01 = 0f;
            Emit(events, SimulationEventType.VibeChanged, VibeIndex);
        }

        public void SetExternalSpeed(float speed)
        {
            if (float.IsNaN(speed) || float.IsInfinity(speed) || speed < 0f)
                throw new ArgumentOutOfRangeException(nameof(speed));
            Speed = speed;
        }

        public void Tick(
            float dt,
            WorldFrame world,
            DeterministicRandom random,
            SimulationEventBuffer events,
            StageCommandBuffer commands)
        {
            if (dt <= 0f) throw new ArgumentOutOfRangeException(nameof(dt));
            if (random == null) throw new ArgumentNullException(nameof(random));
            if (events == null) throw new ArgumentNullException(nameof(events));
            if (commands == null) throw new ArgumentNullException(nameof(commands));

            RestBeat = Math.Max(0f, RestBeat - dt);
            StageDefinition stage = CurrentStage;
            _stageElapsed += world.OverdriveActive ? dt * 1.8f : dt;

            TickSpeed(world, stage, dt, events);

            switch (stage.Kind)
            {
                case StageKind.Rest:
                    RestBeat = Math.Max(RestBeat, 0.5f);
                    SpawnPattern = SpawnPattern.None;
                    if (_stageElapsed >= stage.DurationSeconds) Advance(events, commands);
                    break;

                case StageKind.Corridor:
                    TickCorridor(stage, world, events, commands);
                    break;

                case StageKind.EndlessMix:
                    TickEndless(dt, world, random, events, commands);
                    break;

                default:
                    TickTimedStage(stage, dt, world, random, commands);
                    if (_stageElapsed >= stage.DurationSeconds) Advance(events, commands);
                    break;
            }

            TickKlaxon(stage, world, events);
        }

        void TickSpeed(WorldFrame world, StageDefinition stage, float dt, SimulationEventBuffer events)
        {
            if (_speedPending)
            {
                _pendingSince += dt;
                if (world.HazardsClear || _pendingSince > SpeedDeferDeadlineSeconds)
                {
                    float from = Speed;
                    Speed = _pendingSpeed;
                    _speedPending = false;
                    Emit(events, SimulationEventType.SpeedChanged, 0, from, Speed);
                }
            }
            else if (!world.AnyCorridorActive && !world.OverdriveActive)
            {
                float target = _run.BaseSpeed * Math.Max(stage.SpeedMultiplier, SpeedFloor);
                if (Math.Abs(Speed - target) > 0.5f && target < Speed)
                {
                    float from = Speed;
                    Speed = target;
                    Emit(events, SimulationEventType.SpeedChanged, 0, from, Speed);
                }
            }
        }

        void TickCorridor(
            StageDefinition stage,
            WorldFrame world,
            SimulationEventBuffer events,
            StageCommandBuffer commands)
        {
            SpawnPattern = SpawnPattern.None;
            if (!_corridorLaunched)
            {
                _corridorLaunched = true;
                RestBeat = Math.Max(RestBeat, 1.5f);
                commands.Add(new StageCommand(StageCommandType.WipeHazards));
                if (stage.Family == CorridorFamily.L5Sine) SpeedFloor = Math.Max(SpeedFloor, 2.5f);
                commands.Add(new StageCommand(
                    StageCommandType.LaunchCorridor,
                    stage.Family,
                    stage.SpeedMultiplier,
                    0f,
                    stage.DarkSlabs));
                return;
            }

            bool familyDone = !IsFamilyActive(stage.Family, world);
            bool timedOut = stage.DurationSeconds > 0f && _stageElapsed >= stage.DurationSeconds;
            if (familyDone || timedOut) Advance(events, commands);
        }

        void TickTimedStage(
            StageDefinition stage,
            float dt,
            WorldFrame world,
            DeterministicRandom random,
            StageCommandBuffer commands)
        {
            bool quiet = false;
            if (StageIndex + 1 < _run.StageCount)
            {
                StageDefinition next = _run.GetStage(StageIndex + 1);
                quiet = next.Kind == StageKind.Corridor
                    && stage.DurationSeconds - _stageElapsed <= PreCorridorQuietSeconds;
            }

            Density = stage.Density;
            StageRamp01 = Density == DensityCurve.Ramp && stage.DurationSeconds > 0f
                ? Clamp01(_stageElapsed / stage.DurationSeconds)
                : 0f;

            switch (stage.Kind)
            {
                case StageKind.RandomCones:
                    SpawnPattern = quiet ? SpawnPattern.None : SpawnPattern.Cones;
                    break;
                case StageKind.FatCones:
                    SpawnPattern = quiet ? SpawnPattern.None : SpawnPattern.FatCones;
                    break;
                case StageKind.LethalRings:
                    SpawnPattern = quiet ? SpawnPattern.None : SpawnPattern.Lethal;
                    break;
                case StageKind.AngledWalls:
                    bool inBreak = _stageElapsed >= 15f && _stageElapsed < 17f;
                    SpawnPattern = quiet || inBreak ? SpawnPattern.None : SpawnPattern.Angled;
                    break;
                case StageKind.StructuredWalls:
                    SpawnPattern = SpawnPattern.None;
                    _structuredWallTimer += dt;
                    if (!quiet && _structuredWallTimer >= 3f && !world.AngledWallsActive)
                    {
                        _structuredWallTimer = 0f;
                        commands.Add(new StageCommand(StageCommandType.StartStructuredWalls));
                    }
                    break;
                case StageKind.SlalomOnly:
                    SpawnPattern = SpawnPattern.None;
                    if (!quiet && !world.SlalomActive)
                        commands.Add(new StageCommand(StageCommandType.StartSlalom, valueA: 7.6f, valueB: 16 + random.NextInt(0, 3)));
                    break;
                case StageKind.ZipperOnly:
                    SpawnPattern = SpawnPattern.None;
                    if (!quiet && !world.ZipperActive)
                        commands.Add(new StageCommand(StageCommandType.StartZipper, valueA: 18f));
                    else if (quiet && world.ZipperActive)
                        commands.Add(new StageCommand(StageCommandType.AbortZipper));
                    break;
            }
        }

        void Advance(SimulationEventBuffer events, StageCommandBuffer commands)
        {
            if (StageIndex + 1 >= _run.StageCount) return;

            StageDefinition previous = CurrentStage;
            StageIndex++;
            StageDefinition stage = CurrentStage;
            _stageElapsed = 0f;
            _corridorLaunched = false;
            _klaxonFired = false;
            _structuredWallTimer = 0f;

            commands.Add(new StageCommand(StageCommandType.AbortTransientMechanics));
            SpawnPattern = PatternFor(stage.Kind);
            Density = stage.Density;
            StageRamp01 = 0f;
            if (previous.Kind == StageKind.Rest) RestBeat = Math.Max(RestBeat, 0.4f);
            if (stage.Kind == StageKind.Rest) commands.Add(new StageCommand(StageCommandType.WipeHazards));

            PhysicsTier = stage.PhysicsTier;
            VibeIndex = stage.VibeIndex;
            Emit(events, SimulationEventType.StageChanged, StageIndex);
            Emit(events, SimulationEventType.VibeChanged, VibeIndex);

            float target = _run.BaseSpeed * Math.Max(stage.SpeedMultiplier, SpeedFloor);
            if (target > Speed + 0.01f)
            {
                _speedPending = true;
                _pendingSpeed = target;
                _pendingSince = 0f;
            }
            else if (target < Speed - 0.01f)
            {
                float from = Speed;
                Speed = target;
                Emit(events, SimulationEventType.SpeedChanged, 0, from, Speed);
            }
        }

        void TickKlaxon(StageDefinition stage, WorldFrame world, SimulationEventBuffer events)
        {
            if (_klaxonFired || StageIndex + 1 >= _run.StageCount) return;
            StageDefinition next = _run.GetStage(StageIndex + 1);
            bool nearEnd = stage.DurationSeconds > 0f && stage.DurationSeconds - _stageElapsed <= 1.5f;
            if (stage.Kind == StageKind.Corridor && world.CanyonExiting) nearEnd = true;
            if (next.SpeedMultiplier > stage.SpeedMultiplier && nearEnd)
            {
                _klaxonFired = true;
                Emit(events, SimulationEventType.KlaxonCountdown);
            }
        }

        void TickEndless(
            float dt,
            WorldFrame world,
            DeterministicRandom random,
            SimulationEventBuffer events,
            StageCommandBuffer commands)
        {
            _endlessElapsed += world.OverdriveActive ? dt * 1.8f : dt;
            if (_endlessResting)
            {
                SpawnPattern = SpawnPattern.None;
                RestBeat = Math.Max(RestBeat, 0.5f);
                if (_endlessElapsed >= EndlessRestSeconds)
                {
                    _endlessResting = false;
                    _endlessElapsed = 0f;
                    ActivateEndlessBlock(random, commands);
                }
                return;
            }

            if (_endlessElapsed >= EndlessBlockSeconds && !world.AnyStructuredMechanicActive)
            {
                _endlessResting = true;
                _endlessElapsed = 0f;
                SpawnPattern = SpawnPattern.None;
                commands.Add(new StageCommand(StageCommandType.AbortTransientMechanics));
                commands.Add(new StageCommand(StageCommandType.WipeHazards));
                RestBeat = EndlessRestSeconds;
                _waveCount++;
                _wavesSinceCorridor++;
                VibeIndex = (_waveCount + 4) % 5;
                Emit(events, SimulationEventType.VibeChanged, VibeIndex);
            }
        }

        void ActivateEndlessBlock(DeterministicRandom random, StageCommandBuffer commands)
        {
            EndlessKind kind = EndlessRotation[_endlessIndex % EndlessRotation.Length];
            _endlessIndex++;
            bool corridorAllowed = _waveCount >= 3 && _wavesSinceCorridor >= 5;
            if ((kind == EndlessKind.L3Corridor || kind == EndlessKind.L4Corridor) && !corridorAllowed)
                kind = EndlessKind.RandomCones;

            RestBeat = Math.Max(RestBeat, 1f);
            switch (kind)
            {
                case EndlessKind.RandomCones:
                    SpawnPattern = SpawnPattern.Cones;
                    Density = DensityCurve.Ramp;
                    StageRamp01 = 1f;
                    break;
                case EndlessKind.AngledRandom:
                    SpawnPattern = SpawnPattern.Angled;
                    break;
                case EndlessKind.Lethal:
                    SpawnPattern = SpawnPattern.Lethal;
                    break;
                case EndlessKind.FatCones:
                    SpawnPattern = SpawnPattern.FatCones;
                    break;
                case EndlessKind.AngledStructured:
                    SpawnPattern = SpawnPattern.None;
                    commands.Add(new StageCommand(StageCommandType.StartStructuredWalls));
                    break;
                case EndlessKind.Zipper:
                    SpawnPattern = SpawnPattern.None;
                    commands.Add(new StageCommand(StageCommandType.StartZipper, valueA: 18 + random.NextInt(0, 6)));
                    break;
                case EndlessKind.Slalom:
                    SpawnPattern = SpawnPattern.None;
                    commands.Add(new StageCommand(StageCommandType.StartSlalom, valueA: 9f, valueB: 16 + random.NextInt(0, 4)));
                    break;
                case EndlessKind.L3Corridor:
                    SpawnPattern = SpawnPattern.None;
                    _wavesSinceCorridor = 0;
                    commands.Add(new StageCommand(StageCommandType.LaunchCorridor, CorridorFamily.L3Knife, 2.5f));
                    break;
                case EndlessKind.L4Corridor:
                    SpawnPattern = SpawnPattern.None;
                    _wavesSinceCorridor = 0;
                    commands.Add(new StageCommand(StageCommandType.LaunchCorridor, CorridorFamily.L4Sine, 2.5f));
                    break;
            }
        }

        static bool IsFamilyActive(CorridorFamily family, WorldFrame world)
        {
            switch (family)
            {
                case CorridorFamily.PreT4A:
                case CorridorFamily.PreT4B:
                case CorridorFamily.L3Knife:
                    return world.CanyonActive || world.CanyonExiting;
                case CorridorFamily.L4Sine:
                case CorridorFamily.L5Sine:
                    return world.SineCorridorActive;
                default:
                    return false;
            }
        }

        static SpawnPattern PatternFor(StageKind kind)
        {
            switch (kind)
            {
                case StageKind.RandomCones: return SpawnPattern.Cones;
                case StageKind.FatCones: return SpawnPattern.FatCones;
                case StageKind.AngledWalls: return SpawnPattern.Angled;
                case StageKind.LethalRings: return SpawnPattern.Lethal;
                case StageKind.EndlessMix: return SpawnPattern.EndlessMix;
                default: return SpawnPattern.None;
            }
        }

        static float Clamp01(float value) => value < 0f ? 0f : value > 1f ? 1f : value;

        static void Emit(
            SimulationEventBuffer events,
            SimulationEventType type,
            int entityId = 0,
            float valueA = 0f,
            float valueB = 0f)
        {
            events?.Add(new SimulationEvent(type, entityId, valueA, valueB));
        }
    }
}
