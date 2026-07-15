using System;

namespace JetHorizon.Simulation
{
    public enum RunCargoKind { Salvage, Alloy, Prism }

    public readonly struct RunCargoManifest
    {
        public int Salvage { get; }
        public int Alloy { get; }
        public int Prism { get; }
        public int TotalUnits => Salvage + Alloy + Prism;

        public RunCargoManifest(int salvage, int alloy, int prism)
        {
            if (salvage < 0 || alloy < 0 || prism < 0) throw new ArgumentOutOfRangeException(nameof(salvage));
            Salvage = salvage;
            Alloy = alloy;
            Prism = prism;
        }
    }

    /// <summary>Run-local risk ledger. It never persists itself and is lost when the ship is destroyed.</summary>
    internal sealed class RunCargoLedger
    {
        readonly int _capacity;
        int _salvage;
        int _alloy;
        int _prism;

        public int Capacity => _capacity;
        public int Salvage => _salvage;
        public int Alloy => _alloy;
        public int Prism => _prism;
        public int TotalUnits => _salvage + _alloy + _prism;

        public RunCargoLedger(int capacity)
        {
            if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
            _capacity = capacity;
        }

        public bool TryCollect(RunCargoKind kind, int units)
        {
            if (units <= 0 || TotalUnits + units > _capacity) return false;
            if (kind == RunCargoKind.Salvage) _salvage += units;
            else if (kind == RunCargoKind.Alloy) _alloy += units;
            else _prism += units;
            return true;
        }

        public RunCargoManifest Snapshot() => new RunCargoManifest(_salvage, _alloy, _prism);
        public void Reset() { _salvage = 0; _alloy = 0; _prism = 0; }
    }
}
