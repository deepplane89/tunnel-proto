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
        public bool HazardsClear;
        public bool CanyonActive;
        public bool CanyonExiting;
        public bool SineCorridorActive;
        public bool ZipperActive;
        public bool SlalomActive;
        public bool AngledWallsActive;
        public bool CollisionSuppressed;

        public bool AnyCorridorActive => CanyonActive || SineCorridorActive;
        public bool AnyStructuredMechanicActive => AnyCorridorActive || ZipperActive || SlalomActive || AngledWallsActive;

        public WorldFrame(bool progressionSuspended, bool overdriveActive)
        {
            ProgressionSuspended = progressionSuspended;
            OverdriveActive = overdriveActive;
            HazardsClear = false;
            CanyonActive = false;
            CanyonExiting = false;
            SineCorridorActive = false;
            ZipperActive = false;
            SlalomActive = false;
            AngledWallsActive = false;
            CollisionSuppressed = false;
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
        StageChanged,
        SpeedChanged,
        VibeChanged,
        KlaxonCountdown,
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

    public enum HazardKind
    {
        Cone,
        Ring,
        Wall,
        Corridor
    }

    /// <summary>Engine-neutral hazard creation request. Visual identity is carried separately by the presenter.</summary>
    public struct HazardSpawn
    {
        public HazardKind Kind;
        public float X;
        public float Y;
        public float Z;
        public float CollisionHalfWidth;
        public float CollisionHalfDepth;
        public float VisualScale;
        public float RingRadius;
        public float RingTubeRadius;
        public bool NearMissEnabled;

        public static HazardSpawn Cone(float x, float z, float visualScale = 1f, float collisionHalfWidth = 0.9f)
        {
            return new HazardSpawn
            {
                Kind = HazardKind.Cone,
                X = x,
                Z = z,
                CollisionHalfWidth = collisionHalfWidth,
                CollisionHalfDepth = 1.5f,
                VisualScale = visualScale,
                NearMissEnabled = true
            };
        }

        public static HazardSpawn Ring(float x, float y, float z, float radius, float tubeRadius)
        {
            return new HazardSpawn
            {
                Kind = HazardKind.Ring,
                X = x,
                Y = y,
                Z = z,
                CollisionHalfDepth = tubeRadius + 1f,
                VisualScale = 1f,
                RingRadius = radius,
                RingTubeRadius = tubeRadius,
                NearMissEnabled = false
            };
        }
    }

    public struct HazardSnapshot
    {
        public int Id { get; }
        public HazardKind Kind { get; }
        public float X { get; }
        public float Y { get; }
        public float Z { get; }
        public float HalfWidth { get; }
        public float VisualScale { get; }

        internal HazardSnapshot(int id, HazardKind kind, float x, float y, float z, float halfWidth, float visualScale)
        {
            Id = id;
            Kind = kind;
            X = x;
            Y = y;
            Z = z;
            HalfWidth = halfWidth;
            VisualScale = visualScale;
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
        public bool StageDirectorEnabled { get; internal set; }
        public int StageIndex { get; internal set; }
        public string StageName { get; internal set; }
        public float StageElapsed { get; internal set; }
        public float SpeedFloor { get; internal set; }
        public float RestBeat { get; internal set; }
        public int PhysicsTier { get; internal set; }
        public int VibeIndex { get; internal set; }
        public SpawnPattern SpawnPattern { get; internal set; }
        public DensityCurve Density { get; internal set; }
        public float StageRamp01 { get; internal set; }
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
