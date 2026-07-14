using System;

namespace JetHorizon.Simulation
{
    public enum CoreGamePhase
    {
        Title,
        Playing,
        Paused,
        Dead
    }

    public struct InputFrame
    {
        public bool SteerLeft;
        public bool SteerRight;
        public int RollDirection;

        public InputFrame(bool steerLeft, bool steerRight, int rollDirection = 0)
        {
            SteerLeft = steerLeft;
            SteerRight = steerRight;
            RollDirection = rollDirection < 0 ? -1 : rollDirection > 0 ? 1 : 0;
        }
    }

    /// <summary>
    /// Engine-facing facts that affect a simulation tick but are still presented by the
    /// host during migration. These are values, not callbacks or engine objects.
    /// </summary>
    public struct WorldFrame
    {
        public bool ProgressionSuspended;
        public bool OverdriveActive;

        public WorldFrame(bool progressionSuspended, bool overdriveActive)
        {
            ProgressionSuspended = progressionSuspended;
            OverdriveActive = overdriveActive;
        }
    }

    public enum ScoreSource
    {
        Passive,
        NearMiss,
        Pickup,
        Bonus,
        FinalMultiplier
    }

    public enum SimulationEventType
    {
        RunStarted,
        HazardSpawned,
        NearMiss,
        ScoreChanged,
        PlayerDied
    }

    public struct SimulationEvent
    {
        public SimulationEventType Type { get; }
        public int EntityId { get; }
        public float ValueA { get; }
        public float ValueB { get; }

        public SimulationEvent(SimulationEventType type, int entityId = 0, float valueA = 0f, float valueB = 0f)
        {
            Type = type;
            EntityId = entityId;
            ValueA = valueA;
            ValueB = valueB;
        }
    }

    /// <summary>A fixed-capacity, allocation-free event buffer reused every simulation tick.</summary>
    public sealed class SimulationEventBuffer
    {
        readonly SimulationEvent[] _items;

        public int Count { get; private set; }
        public SimulationEvent this[int index] => index >= 0 && index < Count
            ? _items[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        internal SimulationEventBuffer(int capacity)
        {
            _items = new SimulationEvent[capacity];
        }

        internal void Clear() => Count = 0;

        internal void Add(SimulationEvent item)
        {
            if (Count >= _items.Length)
                throw new InvalidOperationException("Simulation event capacity exceeded.");
            _items[Count++] = item;
        }
    }

    public struct HazardSnapshot
    {
        public int Id { get; }
        public float X { get; }
        public float Z { get; }
        public float HalfWidth { get; }

        internal HazardSnapshot(int id, float x, float z, float halfWidth)
        {
            Id = id;
            X = x;
            Z = z;
            HalfWidth = halfWidth;
        }
    }

    /// <summary>
    /// Reused read-only view of simulation state. Presenters read this; they never mutate gameplay state.
    /// </summary>
    public sealed class SimulationSnapshot
    {
        readonly HazardSnapshot[] _hazards;

        public CoreGamePhase Phase { get; internal set; }
        public long Tick { get; internal set; }
        public float Elapsed { get; internal set; }
        public float Distance { get; internal set; }
        public float Score { get; internal set; }
        public float Speed { get; internal set; }
        public float EffectiveSpeed { get; internal set; }
        public float ShipX { get; internal set; }
        public float ShipY { get; internal set; }
        public float ShipZ { get; internal set; }
        public float ShipVelocityX { get; internal set; }
        public float ShipBankRadians { get; internal set; }
        public float ShipRollRadians { get; internal set; }
        public float ShipTiltTimer { get; internal set; }
        public int HazardCount { get; internal set; }

        internal SimulationSnapshot(int maxHazards)
        {
            _hazards = new HazardSnapshot[maxHazards];
        }

        public HazardSnapshot GetHazard(int index)
        {
            if (index < 0 || index >= HazardCount) throw new ArgumentOutOfRangeException(nameof(index));
            return _hazards[index];
        }

        internal void SetHazard(int index, HazardSnapshot hazard) => _hazards[index] = hazard;
    }
}
