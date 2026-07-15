using System;

namespace JetHorizon.Simulation
{
    public enum RunCargoKind { Salvage, Alloy, Prism }

    public readonly struct CargoDefinition
    {
        public RunCargoKind Kind { get; }
        public string Id { get; }
        public string DisplayName { get; }
        public int Weight { get; }
        public int CreditValue { get; }
        public int SalvageYield { get; }
        public int AlloyYield { get; }
        public int PrismYield { get; }
        public int MinimumHeat { get; }
        public int PresentationVariant { get; }

        public CargoDefinition(
            RunCargoKind kind,
            string id,
            string displayName,
            int weight,
            int creditValue,
            int salvageYield,
            int alloyYield,
            int prismYield,
            int minimumHeat,
            int presentationVariant)
        {
            if (weight <= 0 || creditValue < 0) throw new ArgumentOutOfRangeException(nameof(weight));
            Kind = kind;
            Id = id;
            DisplayName = displayName;
            Weight = weight;
            CreditValue = creditValue;
            SalvageYield = Math.Max(0, salvageYield);
            AlloyYield = Math.Max(0, alloyYield);
            PrismYield = Math.Max(0, prismYield);
            MinimumHeat = Math.Max(0, minimumHeat);
            PresentationVariant = presentationVariant;
        }
    }

    /// <summary>Portable cargo values. Unity only maps PresentationVariant to replaceable art.</summary>
    public static class CargoCatalog
    {
        public static readonly CargoDefinition Salvage = new CargoDefinition(
            RunCargoKind.Salvage, "salvage-crate", "SALVAGE", 1, 35, 1, 0, 0, 0, 0);
        public static readonly CargoDefinition Alloy = new CargoDefinition(
            RunCargoKind.Alloy, "alloy-container", "ALLOY", 3, 125, 0, 1, 0, 1, 1);
        public static readonly CargoDefinition Prism = new CargoDefinition(
            RunCargoKind.Prism, "prism-battery", "PRISM", 6, 360, 0, 0, 1, 2, 2);

        public static CargoDefinition Get(RunCargoKind kind)
        {
            switch (kind)
            {
                case RunCargoKind.Salvage: return Salvage;
                case RunCargoKind.Alloy: return Alloy;
                case RunCargoKind.Prism: return Prism;
                default: throw new ArgumentOutOfRangeException(nameof(kind));
            }
        }

        public static RunCargoKind Select(float roll01, int heat)
        {
            roll01 = Math.Max(0f, Math.Min(.999999f, roll01));
            if (heat <= 0) return roll01 < .90f ? RunCargoKind.Salvage : RunCargoKind.Alloy;
            if (heat == 1) return roll01 < .62f ? RunCargoKind.Salvage : roll01 < .94f ? RunCargoKind.Alloy : RunCargoKind.Prism;
            if (heat == 2) return roll01 < .42f ? RunCargoKind.Salvage : roll01 < .82f ? RunCargoKind.Alloy : RunCargoKind.Prism;
            return roll01 < .24f ? RunCargoKind.Salvage : roll01 < .62f ? RunCargoKind.Alloy : RunCargoKind.Prism;
        }
    }

    public readonly struct RunCargoManifest
    {
        public int Salvage { get; }
        public int Alloy { get; }
        public int Prism { get; }
        public int TotalUnits => Salvage + Alloy + Prism;
        public int TotalWeight { get; }
        public int BaseCreditValue { get; }
        public int CreditValue { get; }
        public int HeatLevel { get; }
        public float RewardMultiplier { get; }

        public RunCargoManifest(int salvage, int alloy, int prism, int heatLevel = 0, float rewardMultiplier = 1f)
        {
            if (salvage < 0 || alloy < 0 || prism < 0) throw new ArgumentOutOfRangeException(nameof(salvage));
            if (rewardMultiplier < 1f) throw new ArgumentOutOfRangeException(nameof(rewardMultiplier));
            Salvage = salvage;
            Alloy = alloy;
            Prism = prism;
            HeatLevel = Math.Max(0, heatLevel);
            RewardMultiplier = rewardMultiplier;
            TotalWeight = salvage * CargoCatalog.Salvage.Weight
                + alloy * CargoCatalog.Alloy.Weight
                + prism * CargoCatalog.Prism.Weight;
            BaseCreditValue = salvage * CargoCatalog.Salvage.CreditValue
                + alloy * CargoCatalog.Alloy.CreditValue
                + prism * CargoCatalog.Prism.CreditValue;
            CreditValue = (int)Math.Round(BaseCreditValue * rewardMultiplier, MidpointRounding.AwayFromZero);
        }
    }

    /// <summary>Run-local weighted risk ledger. It never persists itself and is lost on destruction.</summary>
    internal sealed class RunCargoLedger
    {
        readonly int _capacityWeight;
        int _salvage;
        int _alloy;
        int _prism;

        public int CapacityWeight => _capacityWeight;
        public int Salvage => _salvage;
        public int Alloy => _alloy;
        public int Prism => _prism;
        public int TotalUnits => _salvage + _alloy + _prism;
        public int UsedWeight => _salvage * CargoCatalog.Salvage.Weight
            + _alloy * CargoCatalog.Alloy.Weight
            + _prism * CargoCatalog.Prism.Weight;
        public int BaseCreditValue => _salvage * CargoCatalog.Salvage.CreditValue
            + _alloy * CargoCatalog.Alloy.CreditValue
            + _prism * CargoCatalog.Prism.CreditValue;

        public RunCargoLedger(int capacityWeight)
        {
            if (capacityWeight <= 0) throw new ArgumentOutOfRangeException(nameof(capacityWeight));
            _capacityWeight = capacityWeight;
        }

        public bool TryCollect(RunCargoKind kind, int units)
        {
            if (units <= 0) return false;
            CargoDefinition cargo = CargoCatalog.Get(kind);
            if (UsedWeight + cargo.Weight * units > _capacityWeight) return false;
            if (kind == RunCargoKind.Salvage) _salvage += units;
            else if (kind == RunCargoKind.Alloy) _alloy += units;
            else _prism += units;
            return true;
        }

        public RunCargoManifest Snapshot(int heatLevel = 0, float rewardMultiplier = 1f) =>
            new RunCargoManifest(_salvage, _alloy, _prism, heatLevel, rewardMultiplier);

        public void Reset() { _salvage = 0; _alloy = 0; _prism = 0; }
    }
}
