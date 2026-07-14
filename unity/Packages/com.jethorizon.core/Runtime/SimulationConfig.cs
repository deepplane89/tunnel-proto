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
        public float ShipZ = 3.9f;
        public float ShipHoverY = 1.21f;
        public float ShipPreLaunchY = 0.38f;

        public float Snap = 0.5625f;
        public float AccelBase = 22f;
        public float AccelSnap = 52f;
        public float AccelMultiplier = 0.75f;
        public float MaxVelBase = 9f;
        public float MaxVelSnap = 13f;
        public float DecelBasePercent = 0.02f;
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
        public float DistanceBonusStep = 5000f;
        public float DistanceBonusPerStep = 0.1f;
        public int MaxHazards = 64;
        public int MaxPickups = 128;
        public bool CollisionEnabled = true;
        public bool ProgressionEnabled = true;
        public bool HazardSpawningEnabled = true;
        public bool HazardSimulationEnabled = true;
        public bool PickupSimulationEnabled = true;

        public float Acceleration => (AccelBase + Snap * AccelSnap) * AccelMultiplier;
        public float Deceleration => (10f + Snap * 26f) * DecelBasePercent;
        public float MaxLateralVelocity => MaxVelBase + Snap * MaxVelSnap;
        public float RollSpeed => (float)((1.2f + Snap * 2.3f) * Math.PI);

        public SimulationConfig Clone()
        {
            return (SimulationConfig)MemberwiseClone();
        }

        public void Validate()
        {
            if (FixedDeltaSeconds <= 0f) throw new InvalidOperationException("FixedDeltaSeconds must be positive.");
            if (LaneCount <= 0) throw new InvalidOperationException("LaneCount must be positive.");
            if (MaxHazards <= 0) throw new InvalidOperationException("MaxHazards must be positive.");
            if (MaxPickups <= 0) throw new InvalidOperationException("MaxPickups must be positive.");
            if (SpawnIntervalDistance <= 0f) throw new InvalidOperationException("SpawnIntervalDistance must be positive.");
            if (RollMaxRadians <= 0f) throw new InvalidOperationException("RollMaxRadians must be positive.");
            if (DistanceBonusStep <= 0f) throw new InvalidOperationException("DistanceBonusStep must be positive.");
        }
    }
}
