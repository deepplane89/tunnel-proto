using System;

namespace JetHorizon.Simulation
{
    /// <summary>
    /// Engine-neutral gameplay constants for the first vertical slice.
    /// Values are copied from the documented Three.js production rules.
    /// </summary>
    public sealed class SimulationConfig
    {
        public float FixedDeltaSeconds = 1f / 60f;

        public float BaseSpeed = 36f;
        public float StartSpeedMultiplier = 1.5f;
        public float PersistentCruiseSpeedMultiplier = 1f;
        public float MinimumOperationalSpeed;
        public float ShipZ = 3.9f;
        public float ShipHoverY = 1.21f;
        public float ShipPreLaunchY = 0.38f;

        public float Snap = 0.5625f;
        public float AccelBase = 22f;
        public float AccelSnap = 52f;
        public float HandlingDrift = 1f;
        public float MaxVelBase = 9f;
        public float MaxVelSnap = 13f;
        public float DecelBasePercent = 0.02f;
        public float DecelFullPercent = 0.05f;
        public float CounterSteerBoost = 3f;

        public float TiltGraceSeconds = 2f;
        public float RollMaxRadians = (float)(Math.PI * 0.5);
        public float RollReturnMultiplier = 1.5f;
        public float BankMaxRadians = 0.52f;
        public float BankSmoothing = 8f;
        public float BankReturnRate = 12f;
        public float BankZeroCrossMultiplier = 3f;
        public float WingCollisionHalfWidth = 1.5f;
        public float BodyCollisionHalfWidth = 0.8f;
        public float CorridorShipHalfWidth = 1.2f;
        public float CorridorCollisionGrace = 0.3f;

        public float HoverAmplitude = 0.03f;
        public float HoverFrequency = 0.60f;
        public float ScoreRatePerSecond = 8f;

        public int LaneCount = 21;
        public float LaneWidth = 3.2f;
        public float SpawnZ = -160f;
        public float DespawnZ = 6f;
        public float InitialSpawnDistance = 45f;
        public float SpawnIntervalDistance = 32f;
        public float HazardHalfWidth = 0.9f;
        public float CollisionHalfDepth = 1.5f;
        public float NearMissBand = 0.6f;
        public float NearMissDepth = 2f;
        public float NearMissScore = 25f;
        public int ZipperReferenceRows = 13;
        public float ZipperGapHalfWidth = 7.5f;
        public float ZipperLateralOffset = 11f;
        public float ZipperSpanPerLane = 8f;
        public float SlalomRowSpacing = 60f;
        public float SlalomConeStep = 14f;
        public float SlalomMinimumGapFromShip = 14f;
        public float SlalomMaximumWander = 26f;
        public float DistanceBonusStep = 5000f;
        public float DistanceBonusPerStep = 0.1f;
        public int MaxHazards = 64;
        public int MaxPickups = 128;
        public int MaxCorridorSlices = 96;
        public int MaxGates = 16;
        public int MaxTerrainFormations = 24;
        public int MaxTerrainTraversalSamples = 64;
        public int CargoCapacity = 18;
        public int HullHitCapacity = 1;
        public float FirstExtractionDistance = 650f;
        public float ExtractionWindowLengthDistance = 220f;
        public float ExtractionIntervalDistance = 520f;
        public int MaximumHeat = 5;
        public float HeatSpeedPerLevel = 0.06f;
        public float HeatRewardPerLevel = 0.30f;
        public float HeatEncounterIntensityPerLevel = 0.18f;
        public int CargoWaveInterval = 3;
        public float ShieldPowerMultiplier = 1f;
        public float LaserPowerMultiplier = 1f;
        public float MagnetPowerMultiplier = 1f;
        public float OverdrivePowerMultiplier = 1f;
        public bool PrismaticSineTunnelEnabled;
        public bool ProofEncounterMode;
        public bool GateRunMode;
        public bool TerrainRunMode;
        public CanyonPathDefinition CanyonPathOverride;
        public float PrismaticTunnelSpawnZ = -260f;
        public float PrismaticTunnelRowSpacing = 7f;
        public float PrismaticTunnelCollisionDepth = 5f;
        public float LightningCollisionHalfWidth = 1.25f;
        public float LightningWarningSeconds = 0.3f;
        public bool CollisionEnabled = true;
        public bool ProgressionEnabled = true;
        public bool HazardSpawningEnabled = true;
        public bool HazardSimulationEnabled = true;
        public bool PickupSimulationEnabled = true;

        public float Acceleration => (AccelBase + Snap * AccelSnap) * (0.75f + (1f - HandlingDrift) * 0.25f);
        public float Deceleration => (10f + Snap * 26f)
            * (DecelBasePercent + (1f - HandlingDrift) * (DecelFullPercent - DecelBasePercent));
        public float MaxLateralVelocity => MaxVelBase + Snap * MaxVelSnap;
        public float RollSpeed => (float)((1.2f + Snap * 2.3f) * Math.PI);

        public SimulationConfig Clone()
        {
            return (SimulationConfig)MemberwiseClone();
        }

        public void Validate()
        {
            if (FixedDeltaSeconds <= 0f) throw new InvalidOperationException("FixedDeltaSeconds must be positive.");
            if (BaseSpeed <= 0f || StartSpeedMultiplier <= 0f || PersistentCruiseSpeedMultiplier <= 0f)
                throw new InvalidOperationException("Run pace inputs must be positive.");
            if (MinimumOperationalSpeed < 0f || float.IsNaN(MinimumOperationalSpeed) || float.IsInfinity(MinimumOperationalSpeed))
                throw new InvalidOperationException("MinimumOperationalSpeed cannot be negative or non-finite.");
            if (LaneCount <= 0) throw new InvalidOperationException("LaneCount must be positive.");
            if (MaxHazards <= 0) throw new InvalidOperationException("MaxHazards must be positive.");
            if (MaxPickups <= 0) throw new InvalidOperationException("MaxPickups must be positive.");
            if (MaxCorridorSlices <= 2) throw new InvalidOperationException("MaxCorridorSlices must be greater than two.");
            if (MaxGates < 8) throw new InvalidOperationException("MaxGates must be at least eight.");
            if (MaxTerrainFormations < 8) throw new InvalidOperationException("MaxTerrainFormations must be at least eight.");
            if (MaxTerrainTraversalSamples < 16) throw new InvalidOperationException("MaxTerrainTraversalSamples must be at least sixteen.");
            if (CargoCapacity <= 0) throw new InvalidOperationException("CargoCapacity must be positive.");
            if (HullHitCapacity <= 0) throw new InvalidOperationException("HullHitCapacity must be positive.");
            if (FirstExtractionDistance <= 0f) throw new InvalidOperationException("FirstExtractionDistance must be positive.");
            if (ExtractionWindowLengthDistance <= 0f) throw new InvalidOperationException("ExtractionWindowLengthDistance must be positive.");
            if (ExtractionIntervalDistance <= ExtractionWindowLengthDistance)
                throw new InvalidOperationException("ExtractionIntervalDistance must exceed the extraction window length.");
            if (MaximumHeat < 1) throw new InvalidOperationException("MaximumHeat must be positive.");
            if (HeatSpeedPerLevel < 0f || HeatRewardPerLevel < 0f || HeatEncounterIntensityPerLevel < 0f)
                throw new InvalidOperationException("Heat multipliers cannot be negative.");
            if (ShieldPowerMultiplier <= 0f || LaserPowerMultiplier <= 0f || MagnetPowerMultiplier <= 0f || OverdrivePowerMultiplier <= 0f)
                throw new InvalidOperationException("Power-up multipliers must be positive.");
            if (CargoWaveInterval <= 0) throw new InvalidOperationException("CargoWaveInterval must be positive.");
            if (SpawnIntervalDistance <= 0f) throw new InvalidOperationException("SpawnIntervalDistance must be positive.");
            if (PrismaticTunnelRowSpacing <= 0f) throw new InvalidOperationException("PrismaticTunnelRowSpacing must be positive.");
            if (LightningCollisionHalfWidth <= 0f) throw new InvalidOperationException("LightningCollisionHalfWidth must be positive.");
            if (LightningWarningSeconds <= 0f) throw new InvalidOperationException("LightningWarningSeconds must be positive.");
            if (RollMaxRadians <= 0f) throw new InvalidOperationException("RollMaxRadians must be positive.");
            if (DistanceBonusStep <= 0f) throw new InvalidOperationException("DistanceBonusStep must be positive.");
            if (HandlingDrift < 0f || HandlingDrift > 1f) throw new InvalidOperationException("HandlingDrift must be between zero and one.");
        }
    }
}
