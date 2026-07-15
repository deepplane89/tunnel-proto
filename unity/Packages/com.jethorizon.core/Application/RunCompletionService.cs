using System;
using System.Collections.Generic;
using JetHorizon.Simulation;

namespace JetHorizon.Application
{
    public struct RunCompletionOutcome
    {
        public bool Applied { get; }
        public bool IsDuplicate { get; }
        public bool IsNewBest { get; }
        public long PreviousHighScore { get; }
        public long HighScore { get; }
        public long RunId { get; }

        public RunCompletionOutcome(
            bool applied,
            bool isDuplicate,
            bool isNewBest,
            long previousHighScore,
            long highScore,
            long runId)
        {
            Applied = applied;
            IsDuplicate = isDuplicate;
            IsNewBest = isNewBest;
            PreviousHighScore = previousHighScore;
            HighScore = highScore;
            RunId = runId;
        }
    }

    /// <summary>
    /// Idempotent application boundary for saves, records, leaderboard publication,
    /// and completion analytics. Gameplay supplies an already-finalized result.
    /// </summary>
    public sealed class RunCompletionService
    {
        readonly GameServices _services;
        readonly HashSet<long> _completedRunIds = new HashSet<long>();

        public RunCompletionService(GameServices services)
        {
            _services = services ?? throw new ArgumentNullException(nameof(services));
        }

        public RunCompletionOutcome Complete(RunResult result)
        {
            if (result == null) throw new ArgumentNullException(nameof(result));

            RunProgress progress = _services.Progress.TryLoad(out var loaded)
                ? loaded
                : RunProgress.Empty;
            progress.SchemaVersion = Math.Max(2, progress.SchemaVersion);

            long previousBest = Math.Max(0L, progress.HighScore);
            if (_completedRunIds.Contains(result.RunId) || progress.LastCompletedRunId == result.RunId)
            {
                return new RunCompletionOutcome(
                    applied: false,
                    isDuplicate: true,
                    isNewBest: false,
                    previousHighScore: previousBest,
                    highScore: previousBest,
                    runId: result.RunId);
            }

            bool isNewBest = result.FinalScore > previousBest;
            progress.HighScore = Math.Max(previousBest, result.FinalScore);
            progress.LongestDistance = Math.Max(progress.LongestDistance, result.Distance);
            progress.CompletedRuns++;
            progress.LastCompletedRunId = result.RunId;
            _services.Progress.Save(progress);
            _completedRunIds.Add(result.RunId);

            if (result.IsLeaderboardEligible)
                _services.Leaderboard.SubmitScore(new LeaderboardSubmission(result.RunId, result.FinalScore));

            _services.Analytics.Track(new AnalyticsEvent(
                "run_finished",
                result.FinalScore,
                result.Distance,
                _services.Clock.UtcUnixMilliseconds));

            return new RunCompletionOutcome(
                applied: true,
                isDuplicate: false,
                isNewBest: isNewBest,
                previousHighScore: previousBest,
                highScore: progress.HighScore,
                runId: result.RunId);
        }
    }
}
