using System;

namespace JetHorizon.Meta
{
    public enum GarageUpgradeId
    {
        Engine,
        Stabilizers,
        CargoBay,
        Hull,
        Shield,
        Laser,
        Magnet,
        Overdrive
    }

    public sealed class GarageUpgradeDefinition
    {
        readonly int[] _nextLevelCreditCosts;

        public GarageUpgradeId Id { get; }
        public string DisplayName { get; }
        public int UnlockExtractions { get; }
        public int MaximumLevel => _nextLevelCreditCosts.Length + 1;

        public GarageUpgradeDefinition(
            GarageUpgradeId id,
            string displayName,
            int unlockExtractions,
            params int[] nextLevelCreditCosts)
        {
            if (nextLevelCreditCosts == null || nextLevelCreditCosts.Length == 0)
                throw new ArgumentException("An upgrade needs at least one cost.", nameof(nextLevelCreditCosts));
            for (int i = 0; i < nextLevelCreditCosts.Length; i++)
            {
                if (nextLevelCreditCosts[i] <= 0)
                    throw new ArgumentOutOfRangeException(nameof(nextLevelCreditCosts));
                if (i > 0 && nextLevelCreditCosts[i] <= nextLevelCreditCosts[i - 1])
                    throw new ArgumentException("Upgrade costs must strictly increase.", nameof(nextLevelCreditCosts));
            }
            Id = id;
            DisplayName = displayName;
            UnlockExtractions = unlockExtractions;
            _nextLevelCreditCosts = (int[])nextLevelCreditCosts.Clone();
        }

        public int NextCreditCost(int currentLevel)
        {
            if (currentLevel < 1 || currentLevel >= MaximumLevel) return 0;
            return _nextLevelCreditCosts[currentLevel - 1];
        }
    }

    /// <summary>
    /// Versioned, engine-neutral progression data. UI may display these resolved values,
    /// but only the domain may apply them.
    /// </summary>
    public static class GarageProgressionCatalog
    {
        public static readonly GarageUpgradeDefinition Engine = new GarageUpgradeDefinition(
            GarageUpgradeId.Engine, "ENGINE", 1, 300, 700, 1500, 3000, 5600, 9800);
        public static readonly GarageUpgradeDefinition Stabilizers = new GarageUpgradeDefinition(
            GarageUpgradeId.Stabilizers, "STABILIZERS", 2, 280, 650, 1350, 2700, 5100, 9000);
        public static readonly GarageUpgradeDefinition CargoBay = new GarageUpgradeDefinition(
            GarageUpgradeId.CargoBay, "CARGO BAY", 4, 250, 600, 1300, 2800, 5800, 11000);
        public static readonly GarageUpgradeDefinition Hull = new GarageUpgradeDefinition(
            GarageUpgradeId.Hull, "HULL", 3, 400, 900, 1900, 3800, 7200, 12500);
        public static readonly GarageUpgradeDefinition Shield = new GarageUpgradeDefinition(
            GarageUpgradeId.Shield, "SHIELD", 4, 450, 1000, 2100, 4200);
        public static readonly GarageUpgradeDefinition Laser = new GarageUpgradeDefinition(
            GarageUpgradeId.Laser, "LASER", 4, 500, 1100, 2400, 5000);
        public static readonly GarageUpgradeDefinition Magnet = new GarageUpgradeDefinition(
            GarageUpgradeId.Magnet, "MAGNET", 5, 450, 1000, 2200, 4600);
        public static readonly GarageUpgradeDefinition Overdrive = new GarageUpgradeDefinition(
            GarageUpgradeId.Overdrive, "OVERDRIVE", 6, 600, 1400, 3000, 6200);

        static readonly GarageUpgradeDefinition[] AllDefinitions =
        {
            Engine, Stabilizers, CargoBay, Hull, Shield, Laser, Magnet, Overdrive
        };

        static readonly float[] EngineSpeedCurve = { 1f, 1.08f, 1.17f, 1.27f, 1.38f, 1.50f, 1.62f };
        static readonly float[] EngineAccelerationCurve = { 1f, 1.07f, 1.15f, 1.24f, 1.34f, 1.45f, 1.57f };
        static readonly float[] StabilizerLateralCurve = { 1f, 1.03f, 1.06f, 1.09f, 1.12f, 1.15f, 1.18f };
        static readonly float[] StabilizerSettleCurve = { 1f, 1.08f, 1.17f, 1.27f, 1.38f, 1.50f, 1.63f };
        static readonly float[] StabilizerCounterCurve = { 1f, 1.10f, 1.21f, 1.33f, 1.46f, 1.60f, 1.75f };
        static readonly int[] CargoWeightCurve = { 10, 14, 19, 25, 32, 40, 50 };
        static readonly float[] PowerCurve = { 1f, 1.15f, 1.32f, 1.52f, 1.75f };

        public static GarageUpgradeDefinition Get(GarageUpgradeId id)
        {
            for (int i = 0; i < AllDefinitions.Length; i++)
                if (AllDefinitions[i].Id == id) return AllDefinitions[i];
            throw new ArgumentOutOfRangeException(nameof(id), id, "Unknown garage upgrade.");
        }

        public static int GetCurrentLevel(GarageState state, GarageUpgradeId id)
        {
            if (state == null) throw new ArgumentNullException(nameof(state));
            switch (id)
            {
                case GarageUpgradeId.Engine: return state.GetSubsystem(ShipSubsystem.PrimaryThruster).Tier;
                case GarageUpgradeId.Stabilizers: return state.GetSubsystem(ShipSubsystem.Stabilizers).Tier;
                case GarageUpgradeId.CargoBay: return state.GetSubsystem(ShipSubsystem.CargoBay).Tier;
                case GarageUpgradeId.Hull: return state.GetSubsystem(ShipSubsystem.Hull).Tier;
                case GarageUpgradeId.Shield: return Math.Max(1, state.GetSubsystem(ShipSubsystem.ShieldGenerator).Tier);
                case GarageUpgradeId.Laser: return PowerLevel(state, "laser");
                case GarageUpgradeId.Magnet: return PowerLevel(state, "magnet");
                case GarageUpgradeId.Overdrive: return PowerLevel(state, "overdrive");
                default: throw new ArgumentOutOfRangeException(nameof(id));
            }
        }

        public static int CargoCapacityForLevel(int level) => IntCurve(CargoWeightCurve, level);
        public static float EngineSpeedForLevel(int level) => FloatCurve(EngineSpeedCurve, level);
        public static float EngineAccelerationForLevel(int level) => FloatCurve(EngineAccelerationCurve, level);
        public static float StabilizerLateralForLevel(int level) => FloatCurve(StabilizerLateralCurve, level);
        public static float StabilizerSettleForLevel(int level) => FloatCurve(StabilizerSettleCurve, level);
        public static float StabilizerCounterForLevel(int level) => FloatCurve(StabilizerCounterCurve, level);
        public static float PowerForLevel(int level) => FloatCurve(PowerCurve, level);

        static int PowerLevel(GarageState state, string id)
        {
            int index = GarageCatalog.PowerupIndex(id);
            return index < state.PowerupTiers.Count ? Math.Max(1, state.PowerupTiers[index]) : 1;
        }

        static float FloatCurve(float[] curve, int level) => curve[Math.Max(0, Math.Min(curve.Length - 1, level - 1))];
        static int IntCurve(int[] curve, int level) => curve[Math.Max(0, Math.Min(curve.Length - 1, level - 1))];
    }
}
