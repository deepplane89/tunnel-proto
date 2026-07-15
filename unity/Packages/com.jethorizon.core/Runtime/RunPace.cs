using System;

namespace JetHorizon.Simulation
{
    /// <summary>The immutable movement envelope used to admit or reject encounter plans.</summary>
    public readonly struct ShipCapabilityProfile
    {
        public float CruiseSpeed { get; }
        public float ForwardRecovery { get; }
        public float LateralAcceleration { get; }
        public float MaximumLateralVelocity { get; }
        public float CounterSteerMultiplier { get; }
        public float NeutralSettleRate { get; }
        public float CollisionHalfWidth { get; }

        public ShipCapabilityProfile(
            float cruiseSpeed,
            float forwardRecovery,
            float lateralAcceleration,
            float maximumLateralVelocity,
            float counterSteerMultiplier,
            float neutralSettleRate,
            float collisionHalfWidth)
        {
            if (cruiseSpeed <= 0f) throw new ArgumentOutOfRangeException(nameof(cruiseSpeed));
            if (forwardRecovery <= 0f) throw new ArgumentOutOfRangeException(nameof(forwardRecovery));
            if (lateralAcceleration <= 0f) throw new ArgumentOutOfRangeException(nameof(lateralAcceleration));
            if (maximumLateralVelocity <= 0f) throw new ArgumentOutOfRangeException(nameof(maximumLateralVelocity));
            if (counterSteerMultiplier <= 0f) throw new ArgumentOutOfRangeException(nameof(counterSteerMultiplier));
            if (neutralSettleRate < 0f) throw new ArgumentOutOfRangeException(nameof(neutralSettleRate));
            if (collisionHalfWidth <= 0f) throw new ArgumentOutOfRangeException(nameof(collisionHalfWidth));

            CruiseSpeed = cruiseSpeed;
            ForwardRecovery = forwardRecovery;
            LateralAcceleration = lateralAcceleration;
            MaximumLateralVelocity = maximumLateralVelocity;
            CounterSteerMultiplier = counterSteerMultiplier;
            NeutralSettleRate = neutralSettleRate;
            CollisionHalfWidth = collisionHalfWidth;
        }

        public static ShipCapabilityProfile FromConfig(SimulationConfig config)
        {
            if (config == null) throw new ArgumentNullException(nameof(config));
            return new ShipCapabilityProfile(
                config.BaseSpeed * config.StartSpeedMultiplier * config.PersistentCruiseSpeedMultiplier,
                config.BaseSpeed * config.PersistentCruiseSpeedMultiplier,
                config.Acceleration,
                config.MaxLateralVelocity,
                config.CounterSteerBoost,
                config.Deceleration,
                config.CorridorShipHalfWidth);
        }

        public ShipCapabilityProfile AtCruiseSpeed(float cruiseSpeed) => new ShipCapabilityProfile(
            cruiseSpeed,
            ForwardRecovery,
            LateralAcceleration,
            MaximumLateralVelocity,
            CounterSteerMultiplier,
            NeutralSettleRate,
            CollisionHalfWidth);
    }

    public readonly struct RunPaceInput
    {
        public float BaseCruiseSpeed { get; }
        public float PersistentCapabilityModifier { get; }
        public float DepthHeatModifier { get; }
        public float EncounterApproachModifier { get; }
        public float TemporaryPowerupModifier { get; }

        public RunPaceInput(
            float baseCruiseSpeed,
            float persistentCapabilityModifier,
            float depthHeatModifier,
            float encounterApproachModifier,
            float temporaryPowerupModifier)
        {
            BaseCruiseSpeed = Positive(baseCruiseSpeed, nameof(baseCruiseSpeed));
            PersistentCapabilityModifier = Positive(persistentCapabilityModifier, nameof(persistentCapabilityModifier));
            DepthHeatModifier = Positive(depthHeatModifier, nameof(depthHeatModifier));
            EncounterApproachModifier = Positive(encounterApproachModifier, nameof(encounterApproachModifier));
            TemporaryPowerupModifier = Positive(temporaryPowerupModifier, nameof(temporaryPowerupModifier));
        }

        static float Positive(float value, string name)
        {
            if (float.IsNaN(value) || float.IsInfinity(value) || value <= 0f)
                throw new ArgumentOutOfRangeException(name);
            return value;
        }
    }

    public readonly struct RunPaceState
    {
        public float PersistentCruiseSpeed { get; }
        public float DepthHeatModifier { get; }
        public float EncounterApproachModifier { get; }
        public float TemporaryPowerupModifier { get; }
        public float EffectiveSpeed { get; }

        internal RunPaceState(RunPaceInput input)
        {
            PersistentCruiseSpeed = input.BaseCruiseSpeed * input.PersistentCapabilityModifier;
            DepthHeatModifier = input.DepthHeatModifier;
            EncounterApproachModifier = input.EncounterApproachModifier;
            TemporaryPowerupModifier = input.TemporaryPowerupModifier;
            EffectiveSpeed = PersistentCruiseSpeed
                * DepthHeatModifier
                * EncounterApproachModifier
                * TemporaryPowerupModifier;
        }
    }

    /// <summary>The only formula allowed to turn permanent, depth, encounter and temporary pace into speed.</summary>
    public static class RunPaceModel
    {
        public static RunPaceState Resolve(RunPaceInput input) => new RunPaceState(input);
    }
}
