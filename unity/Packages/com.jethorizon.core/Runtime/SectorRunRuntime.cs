using System;

namespace JetHorizon.Simulation
{
    public enum RunParcelCommandType
    {
        CargoTrail,
        Powerup,
        LightningPattern,
        AsteroidPattern,
        FatCone,
        LaserFormation
    }

    public readonly struct RunParcelCommand
    {
        public RunParcelCommandType Type { get; }
        public float X { get; }
        public float Z { get; }
        public float ReturnX { get; }
        public int Count { get; }
        public float Spacing { get; }
        public RunCargoKind CargoKind { get; }
        public PowerupType Powerup { get; }
        public LightningSequenceKind LightningSequence { get; }
        public AsteroidSequenceKind AsteroidSequence { get; }
        public float SafeCenterX { get; }
        public float SafeHalfWidth { get; }

        public RunParcelCommand(
            RunParcelCommandType type,
            float x,
            float z,
            float returnX = 0f,
            int count = 0,
            float spacing = 7f,
            RunCargoKind cargoKind = RunCargoKind.Salvage,
            PowerupType powerup = PowerupType.None,
            LightningSequenceKind lightningSequence = LightningSequenceKind.Random,
            AsteroidSequenceKind asteroidSequence = AsteroidSequenceKind.Random,
            float safeCenterX = 0f,
            float safeHalfWidth = 0f)
        {
            Type = type;
            X = x;
            Z = z;
            ReturnX = returnX;
            Count = count;
            Spacing = spacing > 0f ? spacing : 7f;
            CargoKind = cargoKind;
            Powerup = powerup;
            LightningSequence = lightningSequence;
            AsteroidSequence = asteroidSequence;
            SafeCenterX = safeCenterX;
            SafeHalfWidth = safeHalfWidth;
        }
    }

    public sealed class RunParcelCommandBuffer
    {
        readonly RunParcelCommand[] _items;
        public int Count { get; private set; }
        public RunParcelCommand this[int index] => index >= 0 && index < Count
            ? _items[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public RunParcelCommandBuffer(int capacity)
        {
            if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
            _items = new RunParcelCommand[capacity];
        }

        public void Clear() => Count = 0;
        internal void Add(RunParcelCommand command)
        {
            if (Count >= _items.Length) throw new InvalidOperationException("Run parcel command capacity exceeded.");
            _items[Count++] = command;
        }
    }

    public readonly struct SectorState
    {
        public int Index { get; }
        public int Heat { get; }
        public float StartDistance { get; }

        public SectorState(int index, int heat, float startDistance)
        {
            Index = index;
            Heat = heat;
            StartDistance = startDistance;
        }
    }

    /// <summary>Owns sector/Heat advancement only. It does not generate routes or hazards.</summary>
    public sealed class SectorDirector
    {
        public SectorState Current { get; private set; }

        public void Reset() => Current = new SectorState(0, 0, 0f);

        public void ContinueDeeper(float nextStartDistance)
        {
            int next = Current.Index + 1;
            Current = new SectorState(next, Math.Min(5, next), Math.Max(0f, nextStartDistance));
        }
    }

    public readonly struct GateRunTickResult
    {
        public bool ExtractionDecisionOpened { get; }
        public bool EnvironmentActivated { get; }
        public RunEnvironmentKind ActivatedEnvironment { get; }
        public float ScoreAward { get; }

        internal GateRunTickResult(
            bool extractionDecisionOpened,
            bool environmentActivated,
            RunEnvironmentKind activatedEnvironment,
            float scoreAward)
        {
            ExtractionDecisionOpened = extractionDecisionOpened;
            EnvironmentActivated = environmentActivated;
            ActivatedEnvironment = activatedEnvironment;
            ScoreAward = scoreAward;
        }
    }

    public readonly struct GateRunSnapshot
    {
        public int Sector { get; }
        public int Heat { get; }
        public int GateStreak { get; }
        public int HighestGateStreak { get; }
        public int GatesCrossed { get; }
        public int GatesMissed { get; }
        public float EarnedSpeedBonus { get; }
        public float SoftSpeedCap { get; }
        public float NextGateDistance { get; }
        public RunEnvironmentKind Environment { get; }
        public EnvironmentLifecycle EnvironmentLifecycle { get; }
        public bool ExtractionDecisionOpen { get; }

        internal GateRunSnapshot(
            int sector,
            int heat,
            GateProgressionState progression,
            float nextGateDistance,
            RunEnvironmentKind environment,
            EnvironmentLifecycle environmentLifecycle,
            bool extractionDecisionOpen)
        {
            Sector = sector;
            Heat = heat;
            GateStreak = progression.Streak;
            HighestGateStreak = progression.HighestStreak;
            GatesCrossed = progression.GatesCrossed;
            GatesMissed = progression.GatesMissed;
            EarnedSpeedBonus = progression.EarnedSpeedBonus;
            SoftSpeedCap = progression.SoftCap;
            NextGateDistance = nextGateDistance;
            Environment = environment;
            EnvironmentLifecycle = environmentLifecycle;
            ExtractionDecisionOpen = extractionDecisionOpen;
        }
    }

    /// <summary>
    /// Production run coordinator. It delegates speed, sectors, route creation and
    /// content scheduling to focused collaborators and exposes immutable facts.
    /// </summary>
    public sealed class SectorRunRuntime
    {
        const float ContentLeadDistance = 300f;

        readonly ShipCapabilityProfile _capability;
        readonly DeterministicRandom _random;
        readonly GateProgressionModel _progression = new GateProgressionModel();
        readonly SectorDirector _sectors = new SectorDirector();
        readonly GateRoutePlanner _routePlanner = new GateRoutePlanner();
        readonly GateRouteValidator _routeValidator = new GateRouteValidator();
        readonly RunParcelPlanner _parcelPlanner = new RunParcelPlanner();
        readonly bool[] _contentPublished = new bool[64];
        readonly bool _checkpointCanyonSequenceEnabled;

        GateRoutePlan _route;
        int _nextGateIndex;
        RunEnvironmentKind _environment;
        EnvironmentLifecycle _environmentLifecycle;
        bool _extractionDecisionOpen;

        public GateRunSnapshot Snapshot { get; private set; }
        public float EarnedSpeedBonus => _progression.EarnedSpeedBonus;
        public float SoftSpeedCap => GateProgressionModel.SoftCapForHeat(_sectors.Current.Heat);
        public int Heat => _sectors.Current.Heat;
        public GateRoutePlan Route => _route;
        public bool ExtractionDecisionOpen => _extractionDecisionOpen;

        public void RetireEnvironment()
        {
            _environment = RunEnvironmentKind.OpenWater;
            _environmentLifecycle = EnvironmentLifecycle.Retired;
        }

        public bool TryGetUpcomingEnvironment(out RunEnvironmentKind environment, out float startDistance)
        {
            for (int i = _nextGateIndex; i < _route.Count; i++)
            {
                GateRouteNode gate = _route.Get(i);
                if (gate.Kind == SpeedGateKind.CanyonTransition)
                {
                    environment = RunEnvironmentKind.CrystallineCanyon;
                    startDistance = gate.Distance + 24f;
                    return true;
                }
                if (gate.Kind == SpeedGateKind.PrismaticTransition)
                {
                    environment = RunEnvironmentKind.PrismaticCorridor;
                    startDistance = gate.Distance + 24f;
                    return true;
                }
            }
            environment = RunEnvironmentKind.OpenWater;
            startDistance = 0f;
            return false;
        }

        public SectorRunRuntime(
            ShipCapabilityProfile capability,
            DeterministicRandom random,
            bool checkpointCanyonSequenceEnabled = false)
        {
            _capability = capability;
            _random = random ?? throw new ArgumentNullException(nameof(random));
            _checkpointCanyonSequenceEnabled = checkpointCanyonSequenceEnabled;
            Reset(capability.CruiseSpeed);
        }

        public void Reset(float baseCruiseSpeed)
        {
            _progression.Reset();
            _sectors.Reset();
            _nextGateIndex = 0;
            _environment = RunEnvironmentKind.OpenWater;
            _environmentLifecycle = EnvironmentLifecycle.Dormant;
            _extractionDecisionOpen = false;
            Array.Clear(_contentPublished, 0, _contentPublished.Length);
            BuildRoute(0f, baseCruiseSpeed);
            RefreshSnapshot(baseCruiseSpeed);
        }

        public bool TryAcceptExtraction(SimulationEventBuffer events)
        {
            if (!_extractionDecisionOpen || events == null) return false;
            _extractionDecisionOpen = false;
            events.Add(new SimulationEvent(
                SimulationEventType.ExtractionDecisionResolved,
                _sectors.Current.Index,
                1f,
                _sectors.Current.Heat));
            return true;
        }

        public bool TryContinueDeeper(
            float runDistance,
            float baseCruiseSpeed,
            SimulationEventBuffer events)
        {
            if (!_extractionDecisionOpen || events == null) return false;
            _extractionDecisionOpen = false;
            _sectors.ContinueDeeper(runDistance + Math.Max(24f, baseCruiseSpeed * 1.35f));
            Array.Clear(_contentPublished, 0, _contentPublished.Length);
            _nextGateIndex = 0;
            _environment = RunEnvironmentKind.OpenWater;
            _environmentLifecycle = EnvironmentLifecycle.Dormant;
            BuildRoute(_sectors.Current.StartDistance, baseCruiseSpeed + _progression.EarnedSpeedBonus);
            events.Add(new SimulationEvent(
                SimulationEventType.ExtractionDecisionResolved,
                _sectors.Current.Index,
                0f,
                _sectors.Current.Heat));
            events.Add(new SimulationEvent(
                SimulationEventType.SectorChanged,
                _sectors.Current.Index,
                _sectors.Current.Heat,
                _route.EndDistance));
            RefreshSnapshot(baseCruiseSpeed);
            return true;
        }

        public GateRunTickResult Tick(
            float runDistance,
            float shipX,
            float shipZ,
            float baseCruiseSpeed,
            RunParcelCommandBuffer commands,
            SimulationEventBuffer events)
        {
            if (commands == null) throw new ArgumentNullException(nameof(commands));
            if (events == null) throw new ArgumentNullException(nameof(events));
            commands.Clear();
            if (_extractionDecisionOpen)
            {
                RefreshSnapshot(baseCruiseSpeed);
                return new GateRunTickResult(false, false, RunEnvironmentKind.OpenWater, 0f);
            }
            PublishContent(runDistance, shipZ, baseCruiseSpeed, commands);

            bool decisionOpened = false;
            bool environmentActivated = false;
            RunEnvironmentKind activated = RunEnvironmentKind.OpenWater;
            float scoreAward = 0f;
            while (_nextGateIndex < _route.Count
                && runDistance >= _route.Get(_nextGateIndex).Distance)
            {
                GateRouteNode gate = _route.Get(_nextGateIndex++);
                if (gate.Kind == SpeedGateKind.Extraction)
                {
                    _extractionDecisionOpen = true;
                    _environment = RunEnvironmentKind.OpenWater;
                    _environmentLifecycle = EnvironmentLifecycle.Retired;
                    decisionOpened = true;
                    events.Add(new SimulationEvent(
                        SimulationEventType.ExtractionDecisionOpened,
                        _sectors.Current.Index,
                        _sectors.Current.Heat,
                        gate.Distance));
                    break;
                }

                float allowed = Math.Max(0f, gate.HalfWidth - _capability.CollisionHalfWidth);
                bool crossed = Math.Abs(shipX - gate.CenterX) <= allowed;
                if (crossed)
                {
                    float gain = _progression.Cross(gate.Kind, baseCruiseSpeed, Heat);
                    events.Add(new SimulationEvent(
                        SimulationEventType.SpeedGateCrossed,
                        gate.Id,
                        (float)gate.Kind,
                        gain));
                    events.Add(new SimulationEvent(
                        SimulationEventType.GateStreakChanged,
                        gate.Id,
                        _progression.Streak,
                        _progression.GatesCrossed));
                    scoreAward += RunScoreModel.GateScore(gate.Kind, _progression.Streak);

                    if (gate.Kind == SpeedGateKind.CanyonTransition
                        || gate.Kind == SpeedGateKind.PrismaticTransition)
                    {
                        activated = gate.Kind == SpeedGateKind.CanyonTransition
                            ? RunEnvironmentKind.CrystallineCanyon
                            : RunEnvironmentKind.PrismaticCorridor;
                        _environment = activated;
                        _environmentLifecycle = EnvironmentLifecycle.GateCrossedReveal;
                        environmentActivated = true;
                        events.Add(new SimulationEvent(
                            SimulationEventType.EnvironmentTransitionTriggered,
                            gate.Id,
                            (float)activated,
                            gate.Distance));
                    }
                }
                else
                {
                    _progression.Miss();
                    events.Add(new SimulationEvent(
                        SimulationEventType.SpeedGateMissed,
                        gate.Id,
                        (float)gate.Kind,
                        gate.CenterX));
                    events.Add(new SimulationEvent(
                        SimulationEventType.GateStreakChanged,
                        gate.Id,
                        0f,
                        _progression.GatesCrossed));
                    if (gate.Kind == SpeedGateKind.CanyonTransition
                        || gate.Kind == SpeedGateKind.PrismaticTransition)
                    {
                        if (_checkpointCanyonSequenceEnabled
                            && gate.Kind == SpeedGateKind.CanyonTransition)
                        {
                            activated = RunEnvironmentKind.CrystallineCanyon;
                            _environment = activated;
                            _environmentLifecycle = EnvironmentLifecycle.GateCrossedReveal;
                            environmentActivated = true;
                            events.Add(new SimulationEvent(
                                SimulationEventType.EnvironmentTransitionTriggered,
                                gate.Id,
                                (float)activated,
                                gate.Distance));
                        }
                        else
                        {
                            _environment = RunEnvironmentKind.OpenWater;
                            _environmentLifecycle = EnvironmentLifecycle.Retired;
                        }
                    }
                }
            }

            if (_environmentLifecycle == EnvironmentLifecycle.GateCrossedReveal)
                _environmentLifecycle = EnvironmentLifecycle.Active;
            RefreshSnapshot(baseCruiseSpeed);
            return new GateRunTickResult(decisionOpened, environmentActivated, activated, scoreAward);
        }

        public int WriteVisibleGates(
            float runDistance,
            float shipZ,
            GateSnapshot[] destination,
            int maximum)
        {
            if (destination == null) throw new ArgumentNullException(nameof(destination));
            int count = 0;
            int start = Math.Max(0, _nextGateIndex - 1);
            for (int i = start; i < _route.Count && count < maximum && count < destination.Length; i++)
            {
                GateRouteNode node = _route.Get(i);
                if (node.Kind == SpeedGateKind.Extraction) continue;
                float z = shipZ - (node.Distance - runDistance);
                if (z < -900f || z > 60f) continue;
                destination[count++] = new GateSnapshot(
                    node.Id,
                    node.Kind,
                    node.CenterX,
                    z,
                    node.HalfWidth,
                    i >= _nextGateIndex);
            }
            return count;
        }

        void BuildRoute(float startDistance, float projectedSpeed)
        {
            _route = _routePlanner.Build(
                _sectors.Current.Index,
                startDistance,
                projectedSpeed,
                _capability.AtCruiseSpeed(Math.Max(24f, projectedSpeed)),
                _random,
                _checkpointCanyonSequenceEnabled);
            GateRouteValidation validation = _routeValidator.Validate(
                _route,
                _capability.AtCruiseSpeed(Math.Max(24f, projectedSpeed)),
                projectedSpeed);
            if (!validation.IsValid)
                throw new InvalidOperationException("Generated gate route failed capability validation.");
        }

        void PublishContent(
            float runDistance,
            float shipZ,
            float baseCruiseSpeed,
            RunParcelCommandBuffer commands)
        {
            for (int i = _nextGateIndex; i < _route.Count - 1 && i < _contentPublished.Length; i++)
            {
                GateRouteNode gate = _route.Get(i);
                if (gate.Distance - runDistance > ContentLeadDistance) break;
                if (_contentPublished[i]) continue;
                _contentPublished[i] = true;
                float z = shipZ - (gate.Distance - runDistance);
                GateRouteNode previous = i > 0
                    ? _route.Get(i - 1)
                    : new GateRouteNode(
                        gate.Id + 1000000,
                        SpeedGateKind.Common,
                        _route.StartDistance,
                        0f,
                        gate.HalfWidth);
                float projectedSpeed = Math.Min(
                    SoftSpeedCap,
                    baseCruiseSpeed + _progression.EarnedSpeedBonus);
                _parcelPlanner.Publish(
                    i,
                    Heat,
                    previous,
                    gate,
                    z,
                    _capability,
                    projectedSpeed,
                    commands);
            }
        }

        void RefreshSnapshot(float baseCruiseSpeed)
        {
            GateProgressionState progression = _progression.Snapshot(baseCruiseSpeed, Heat);
            float next = _nextGateIndex < _route.Count
                ? _route.Get(_nextGateIndex).Distance
                : _route.EndDistance;
            Snapshot = new GateRunSnapshot(
                _sectors.Current.Index,
                Heat,
                progression,
                next,
                _environment,
                _environmentLifecycle,
                _extractionDecisionOpen);
        }
    }
}
