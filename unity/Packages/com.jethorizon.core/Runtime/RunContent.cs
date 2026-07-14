using System;

namespace JetHorizon.Simulation
{
    public enum StageKind
    {
        RandomCones,
        FatCones,
        AngledWalls,
        StructuredWalls,
        LethalRings,
        SlalomOnly,
        ZipperOnly,
        Corridor,
        Rest,
        EndlessMix
    }

    public enum CorridorFamily
    {
        None,
        PreT4A,
        PreT4B,
        L3Knife,
        L4Sine,
        L5Sine
    }

    public enum SpawnPattern
    {
        None,
        Cones,
        FatCones,
        Angled,
        Lethal,
        EndlessMix
    }

    public enum DensityCurve
    {
        Normal,
        Ramp
    }

    public sealed class StageDefinition
    {
        public string Name { get; }
        public StageKind Kind { get; }
        public CorridorFamily Family { get; }
        public float DurationSeconds { get; }
        public float SpeedMultiplier { get; }
        public int PhysicsTier { get; }
        public int VibeIndex { get; }
        public DensityCurve Density { get; }
        public bool DarkSlabs { get; }

        public StageDefinition(
            string name,
            StageKind kind,
            float durationSeconds,
            float speedMultiplier,
            int physicsTier,
            int vibeIndex,
            CorridorFamily family = CorridorFamily.None,
            DensityCurve density = DensityCurve.Normal,
            bool darkSlabs = false)
        {
            Name = string.IsNullOrWhiteSpace(name) ? throw new ArgumentException("Stage name is required.", nameof(name)) : name;
            if (durationSeconds < 0f) throw new ArgumentOutOfRangeException(nameof(durationSeconds));
            if (speedMultiplier <= 0f) throw new ArgumentOutOfRangeException(nameof(speedMultiplier));
            if (physicsTier < 1) throw new ArgumentOutOfRangeException(nameof(physicsTier));
            if (vibeIndex < 0) throw new ArgumentOutOfRangeException(nameof(vibeIndex));
            if (kind == StageKind.Corridor && family == CorridorFamily.None)
                throw new ArgumentException("Corridor stages require a family.", nameof(family));

            Kind = kind;
            Family = family;
            DurationSeconds = durationSeconds;
            SpeedMultiplier = speedMultiplier;
            PhysicsTier = physicsTier;
            VibeIndex = vibeIndex;
            Density = density;
            DarkSlabs = darkSlabs;
        }
    }

    /// <summary>Validated, engine-neutral campaign content supplied by an engine adapter.</summary>
    public sealed class RunDefinition
    {
        readonly StageDefinition[] _stages;

        public float BaseSpeed { get; }
        public int StageCount => _stages.Length;

        public RunDefinition(float baseSpeed, StageDefinition[] stages)
        {
            if (baseSpeed <= 0f) throw new ArgumentOutOfRangeException(nameof(baseSpeed));
            if (stages == null) throw new ArgumentNullException(nameof(stages));
            if (stages.Length == 0) throw new ArgumentException("A run requires at least one stage.", nameof(stages));
            _stages = new StageDefinition[stages.Length];
            for (int i = 0; i < stages.Length; i++)
                _stages[i] = stages[i] ?? throw new ArgumentException($"Stage {i} is null.", nameof(stages));
            BaseSpeed = baseSpeed;
        }

        public StageDefinition GetStage(int index)
        {
            if (index < 0 || index >= _stages.Length) throw new ArgumentOutOfRangeException(nameof(index));
            return _stages[index];
        }
    }

    public enum StageCommandType
    {
        WipeHazards,
        AbortTransientMechanics,
        AbortZipper,
        LaunchCorridor,
        StartStructuredWalls,
        StartSlalom,
        StartZipper
    }

    public struct StageCommand
    {
        public StageCommandType Type { get; }
        public CorridorFamily Family { get; }
        public float ValueA { get; }
        public float ValueB { get; }
        public bool Flag { get; }

        public StageCommand(
            StageCommandType type,
            CorridorFamily family = CorridorFamily.None,
            float valueA = 0f,
            float valueB = 0f,
            bool flag = false)
        {
            Type = type;
            Family = family;
            ValueA = valueA;
            ValueB = valueB;
            Flag = flag;
        }
    }

    /// <summary>Allocation-free command stream consumed by the engine adapter once per tick.</summary>
    public sealed class StageCommandBuffer
    {
        readonly StageCommand[] _items;

        public int Count { get; private set; }
        public StageCommand this[int index] => index >= 0 && index < Count
            ? _items[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        internal StageCommandBuffer(int capacity)
        {
            _items = new StageCommand[capacity];
        }

        internal void Clear() => Count = 0;

        internal void Add(StageCommand command)
        {
            if (Count >= _items.Length) throw new InvalidOperationException("Stage command capacity exceeded.");
            _items[Count++] = command;
        }
    }
}
