using System;

namespace JetHorizon.Simulation
{
    /// <summary>
    /// Deterministic economy and combo rules for the authored laser payoff.
    /// Rendering, sound and camera response remain engine presentation concerns.
    /// </summary>
    public static class LaserRewardModel
    {
        public const int OverloadTargetCount = 10;
        public const int CargoMilestoneInterval = 3;
        public const float ChainWindowSeconds = .72f;
        public const int FinalCargoCount = 3;

        public static bool AwardsMilestoneCargo(int destroyedTotal)
            => destroyedTotal > 0 && destroyedTotal % CargoMilestoneInterval == 0;

        public static RunCargoKind MilestoneCargo(int destroyedTotal)
            => destroyedTotal > 0 && destroyedTotal % 6 == 0
                ? RunCargoKind.Alloy
                : RunCargoKind.Salvage;

        public static RunCargoKind FinalCargo(int index)
        {
            if (index < 0 || index >= FinalCargoCount)
                throw new ArgumentOutOfRangeException(nameof(index));
            return index == FinalCargoCount - 1
                ? RunCargoKind.Prism
                : RunCargoKind.Alloy;
        }
    }
}
