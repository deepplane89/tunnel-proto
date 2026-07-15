using System;

namespace JetHorizon.Simulation
{
    public enum CoreGamePhase
    {
        Title,
        Playing,
        Paused,
        Dead,
        Extracted
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
        public bool SpawningSuppressed;
        public bool ShipMovementSuppressed;
        public bool CorridorCollisionActive;
        public float CorridorLeftBoundary;
        public float CorridorRightBoundary;

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
            SpawningSuppressed = false;
            ShipMovementSuppressed = false;
            CorridorCollisionActive = false;
            CorridorLeftBoundary = 0f;
            CorridorRightBoundary = 0f;
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
        PickupCollected,
        CargoCollected,
        RunExtracted,
        PowerupCollected,
        PowerupActivated,
        PowerupExpired,
        ShieldHit,
        ShieldBroken,
        HullDamaged,
        LaserFired,
        HazardDestroyed,
        PrismaticBoundaryHit,
        LightningGateStarted,
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
        Lightning,
        Corridor
    }

    public enum HazardStyle
    {
        StandardCone,
        FatCone,
        LethalRing,
        AngledWall,
        StructuredWall,
        Lightning,
        CorridorCone,
        L4CorridorCone,
        L5CorridorCone
    }

    /// <summary>Engine-neutral hazard creation request. Visual identity is carried separately by the presenter.</summary>
    public struct HazardSpawn
    {
        public HazardKind Kind;
        public HazardStyle Style;
        public int VisualVariant;
        public float X;
        public float Y;
        public float Z;
        public float CollisionHalfWidth;
        public float CollisionHalfHeight;
        public float CollisionHalfDepth;
        public float VisualScale;
        public float VisualScaleY;
        public float VisualScaleZ;
        public float RotationXRadians;
        public float RotationYRadians;
        public float RotationZRadians;
        public float RingRadius;
        public float RingTubeRadius;
        public bool NearMissEnabled;
        public float CollisionDelaySeconds;
        public float LifetimeSeconds;

        public static HazardSpawn Cone(
            float x,
            float z,
            float visualScale = 1f,
            float collisionHalfWidth = 0.9f,
            HazardStyle style = HazardStyle.StandardCone,
            int visualVariant = 0)
        {
            return new HazardSpawn
            {
                Kind = HazardKind.Cone,
                Style = style,
                VisualVariant = visualVariant,
                X = x,
                Z = z,
                CollisionHalfWidth = collisionHalfWidth,
                CollisionHalfHeight = 5.25f,
                CollisionHalfDepth = 1.5f,
                VisualScale = visualScale,
                VisualScaleY = 1f,
                VisualScaleZ = visualScale,
                NearMissEnabled = true
            };
        }

        public static HazardSpawn Ring(float x, float y, float z, float radius, float tubeRadius)
        {
            return new HazardSpawn
            {
                Kind = HazardKind.Ring,
                Style = HazardStyle.LethalRing,
                X = x,
                Y = y,
                Z = z,
                CollisionHalfHeight = radius + tubeRadius,
                CollisionHalfDepth = tubeRadius + 1f,
                VisualScale = 1f,
                VisualScaleY = 1f,
                VisualScaleZ = 1f,
                RingRadius = radius,
                RingTubeRadius = tubeRadius,
                NearMissEnabled = false
            };
        }

        public static HazardSpawn Wall(
            float x,
            float y,
            float z,
            float width,
            float height,
            float depth,
            float rotationXRadians,
            float rotationYRadians,
            float rotationZRadians = 0f,
            HazardStyle style = HazardStyle.AngledWall,
            int visualVariant = 0)
        {
            return new HazardSpawn
            {
                Kind = HazardKind.Wall,
                Style = style,
                VisualVariant = visualVariant,
                X = x,
                Y = y,
                Z = z,
                CollisionHalfWidth = width * 0.5f,
                CollisionHalfHeight = height * 0.5f,
                CollisionHalfDepth = depth * 0.5f,
                VisualScale = width,
                VisualScaleY = height,
                VisualScaleZ = depth,
                RotationXRadians = rotationXRadians,
                RotationYRadians = rotationYRadians,
                RotationZRadians = rotationZRadians,
                NearMissEnabled = false
            };
        }

        public static HazardSpawn Lightning(
            float x,
            float z,
            float warningSeconds = 0.3f,
            float lifetimeSeconds = 4.8f,
            float collisionHalfWidth = 0.25f,
            float collisionHalfDepth = 4f)
        {
            return new HazardSpawn
            {
                Kind = HazardKind.Lightning,
                Style = HazardStyle.Lightning,
                X = x,
                Z = z,
                CollisionHalfWidth = collisionHalfWidth,
                CollisionHalfHeight = 30f,
                CollisionHalfDepth = collisionHalfDepth,
                VisualScale = 1f,
                VisualScaleY = 1f,
                VisualScaleZ = 1f,
                NearMissEnabled = false,
                CollisionDelaySeconds = warningSeconds,
                LifetimeSeconds = lifetimeSeconds
            };
        }
    }

    public struct HazardSnapshot
    {
        public int Id { get; }
        public HazardKind Kind { get; }
        public HazardStyle Style { get; }
        public int VisualVariant { get; }
        public float X { get; }
        public float Y { get; }
        public float Z { get; }
        public float HalfWidth { get; }
        public float VisualScale { get; }
        public float VisualScaleY { get; }
        public float VisualScaleZ { get; }
        public float RotationXRadians { get; }
        public float RotationYRadians { get; }
        public float RotationZRadians { get; }
        public float AgeSeconds { get; }
        public bool CollisionActive { get; }

        internal HazardSnapshot(
            int id,
            HazardKind kind,
            HazardStyle style,
            int visualVariant,
            float x,
            float y,
            float z,
            float halfWidth,
            float visualScale,
            float visualScaleY,
            float visualScaleZ,
            float rotationXRadians,
            float rotationYRadians,
            float rotationZRadians,
            float ageSeconds,
            bool collisionActive)
        {
            Id = id;
            Kind = kind;
            Style = style;
            VisualVariant = visualVariant;
            X = x;
            Y = y;
            Z = z;
            HalfWidth = halfWidth;
            VisualScale = visualScale;
            VisualScaleY = visualScaleY;
            VisualScaleZ = visualScaleZ;
            RotationXRadians = rotationXRadians;
            RotationYRadians = rotationYRadians;
            RotationZRadians = rotationZRadians;
            AgeSeconds = ageSeconds;
            CollisionActive = collisionActive;
        }
    }

    public enum PickupKind
    {
        Coin,
        Powerup,
        Cargo
    }

    /// <summary>Portable gameplay identity for the four production power-ups.</summary>
    public enum PowerupType
    {
        None = 0,
        Shield = 1,
        Laser = 2,
        Overdrive = 3,
        Magnet = 4
    }

    public struct PickupSpawn
    {
        public PickupKind Kind;
        public PowerupType Powerup;
        public RunCargoKind CargoKind;
        public int CargoUnits;
        public float X;
        public float Y;
        public float Z;
        public float ScoreValue;
        public float CollectHalfWidth;
        public float CollectHalfDepth;

        public static PickupSpawn Coin(float x, float y, float z, float scoreValue = 75f)
        {
            return new PickupSpawn
            {
                Kind = PickupKind.Coin,
                X = x,
                Y = y,
                Z = z,
                ScoreValue = scoreValue,
                CollectHalfWidth = 1.6f,
                CollectHalfDepth = 1.6f
            };
        }

        public static PickupSpawn PowerupPickup(PowerupType type, float x, float y, float z)
        {
            if (type == PowerupType.None) throw new ArgumentOutOfRangeException(nameof(type));
            return new PickupSpawn
            {
                Kind = PickupKind.Powerup,
                Powerup = type,
                X = x,
                Y = y,
                Z = z,
                ScoreValue = 0f,
                CollectHalfWidth = 2.5f,
                CollectHalfDepth = 2.5f
            };
        }

        public static PickupSpawn Cargo(RunCargoKind kind, int units, float x, float y, float z)
        {
            if (units <= 0) throw new ArgumentOutOfRangeException(nameof(units));
            return new PickupSpawn
            {
                Kind = PickupKind.Cargo,
                CargoKind = kind,
                CargoUnits = units,
                X = x,
                Y = y,
                Z = z,
                CollectHalfWidth = 2.1f,
                CollectHalfDepth = 2.1f
            };
        }
    }

    public struct PickupSnapshot
    {
        public int Id { get; }
        public PickupKind Kind { get; }
        public PowerupType Powerup { get; }
        public RunCargoKind CargoKind { get; }
        public int CargoUnits { get; }
        public float X { get; }
        public float Y { get; }
        public float Z { get; }

        internal PickupSnapshot(int id, PickupKind kind, PowerupType powerup, RunCargoKind cargoKind, int cargoUnits, float x, float y, float z)
        {
            Id = id;
            Kind = kind;
            Powerup = powerup;
            CargoKind = cargoKind;
            CargoUnits = cargoUnits;
            X = x;
            Y = y;
            Z = z;
        }
    }

    /// <summary>
    /// A moving cross-section of an active sine corridor. Unity connects these
    /// authoritative samples into a continuous force-field mesh; gameplay uses the
    /// same samples for boundary collision.
    /// </summary>
    public readonly struct CorridorSliceSnapshot
    {
        public int Id { get; }
        public CorridorFamily Family { get; }
        public int RowIndex { get; }
        public float CenterX { get; }
        public float HalfWidth { get; }
        public float Z { get; }

        internal CorridorSliceSnapshot(
            int id,
            CorridorFamily family,
            int rowIndex,
            float centerX,
            float halfWidth,
            float z)
        {
            Id = id;
            Family = family;
            RowIndex = rowIndex;
            CenterX = centerX;
            HalfWidth = halfWidth;
            Z = z;
        }
    }

    /// <summary>
    /// Reused read-only view of simulation state. Presenters read this; they never mutate gameplay state.
    /// </summary>
    public sealed class SimulationSnapshot
    {
        readonly HazardSnapshot[] _hazards;
        readonly PickupSnapshot[] _pickups;
        readonly CorridorSliceSnapshot[] _corridorSlices;

        public CoreGamePhase Phase { get; internal set; }
        public long Tick { get; internal set; }
        public long EligibleRunTick { get; internal set; }
        public float Elapsed { get; internal set; }
        public float EligibleRunElapsed { get; internal set; }
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
        public bool SineCorridorActive { get; internal set; }
        public bool ZipperActive { get; internal set; }
        public bool SlalomActive { get; internal set; }
        public bool AngledWallsActive { get; internal set; }
        public float CorridorGapCenter { get; internal set; }
        public CorridorFamily ActiveCorridorFamily { get; internal set; }
        public int CorridorSliceCount { get; internal set; }
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
        public int PickupCount { get; internal set; }
        public float ShieldSeconds { get; internal set; }
        public int ShieldHits { get; internal set; }
        public float LaserSeconds { get; internal set; }
        public float OverdriveSeconds { get; internal set; }
        public float OverdriveSpeedSeconds { get; internal set; }
        public float MagnetSeconds { get; internal set; }
        public int CargoSalvage { get; internal set; }
        public int CargoAlloy { get; internal set; }
        public int CargoPrism { get; internal set; }
        public int CargoUnits { get; internal set; }
        public int CargoCapacity { get; internal set; }
        public bool ExtractionAvailable { get; internal set; }
        public int HullHitsRemaining { get; internal set; }
        public int HullHitCapacity { get; internal set; }

        internal SimulationSnapshot(int maxHazards, int maxPickups, int maxCorridorSlices)
        {
            _hazards = new HazardSnapshot[maxHazards];
            _pickups = new PickupSnapshot[maxPickups];
            _corridorSlices = new CorridorSliceSnapshot[maxCorridorSlices];
        }

        public HazardSnapshot GetHazard(int index)
        {
            if (index < 0 || index >= HazardCount) throw new ArgumentOutOfRangeException(nameof(index));
            return _hazards[index];
        }

        internal void SetHazard(int index, HazardSnapshot hazard) => _hazards[index] = hazard;

        public PickupSnapshot GetPickup(int index)
        {
            if (index < 0 || index >= PickupCount) throw new ArgumentOutOfRangeException(nameof(index));
            return _pickups[index];
        }

        internal void SetPickup(int index, PickupSnapshot pickup) => _pickups[index] = pickup;

        public CorridorSliceSnapshot GetCorridorSlice(int index)
        {
            if (index < 0 || index >= CorridorSliceCount) throw new ArgumentOutOfRangeException(nameof(index));
            return _corridorSlices[index];
        }

        internal void SetCorridorSlice(int index, CorridorSliceSnapshot slice) => _corridorSlices[index] = slice;
    }
}
