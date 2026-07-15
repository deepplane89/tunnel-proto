using System;

namespace JetHorizon.Simulation
{
    [Flags]
    public enum LeaderboardIneligibility
    {
        None = 0,
        RepairUsed = 1 << 0,
        GodMode = 1 << 1,
        DebugStart = 1 << 2
    }

    /// <summary>
    /// Immutable terminal result produced exactly once by a run. Platform code may
    /// persist or publish it, but cannot recalculate gameplay score.
    /// </summary>
    public sealed class RunResult
    {
        public long RunId { get; }
        public long RawScore { get; }
        public long FinalScore { get; }
        public float Distance { get; }
        public float DistanceMultiplier { get; }
        public long SimulationTicks { get; }
        public long EligibleRunTicks { get; }
        public float FixedDeltaSeconds { get; }
        public int RepairCount { get; }
        public LeaderboardIneligibility Ineligibility { get; }

        public double SimulationSeconds => SimulationTicks * (double)FixedDeltaSeconds;
        public double EligibleRunSeconds => EligibleRunTicks * (double)FixedDeltaSeconds;
        public bool IsLeaderboardEligible => Ineligibility == LeaderboardIneligibility.None;

        public RunResult(
            long runId,
            long rawScore,
            long finalScore,
            float distance,
            float distanceMultiplier,
            long simulationTicks,
            long eligibleRunTicks,
            float fixedDeltaSeconds,
            int repairCount,
            LeaderboardIneligibility ineligibility)
        {
            if (runId <= 0) throw new ArgumentOutOfRangeException(nameof(runId));
            if (rawScore < 0) throw new ArgumentOutOfRangeException(nameof(rawScore));
            if (finalScore < 0) throw new ArgumentOutOfRangeException(nameof(finalScore));
            if (distance < 0f) throw new ArgumentOutOfRangeException(nameof(distance));
            if (distanceMultiplier < 1f) throw new ArgumentOutOfRangeException(nameof(distanceMultiplier));
            if (simulationTicks < 0) throw new ArgumentOutOfRangeException(nameof(simulationTicks));
            if (eligibleRunTicks < 0 || eligibleRunTicks > simulationTicks)
                throw new ArgumentOutOfRangeException(nameof(eligibleRunTicks));
            if (fixedDeltaSeconds <= 0f) throw new ArgumentOutOfRangeException(nameof(fixedDeltaSeconds));
            if (repairCount < 0) throw new ArgumentOutOfRangeException(nameof(repairCount));

            RunId = runId;
            RawScore = rawScore;
            FinalScore = finalScore;
            Distance = distance;
            DistanceMultiplier = distanceMultiplier;
            SimulationTicks = simulationTicks;
            EligibleRunTicks = eligibleRunTicks;
            FixedDeltaSeconds = fixedDeltaSeconds;
            RepairCount = repairCount;
            Ineligibility = ineligibility;
        }
    }
}
