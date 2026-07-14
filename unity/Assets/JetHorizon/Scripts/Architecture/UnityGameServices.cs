using System;
using JetHorizon.Application;
using UnityEngine;

namespace JetHorizon.Platform
{
    /// <summary>Unity-specific composition for application ports. Gameplay never calls these APIs directly.</summary>
    public static class UnityGameServicesFactory
    {
        public static GameServices CreateDefault()
        {
            return new GameServices(
                new PlayerPrefsRunProgressStore(),
                new SilentAudioOutput(),
                new SilentHapticsOutput(),
                new SilentAnalyticsSink(),
                new UnityClock(),
                new SilentLeaderboardService());
        }
    }

    sealed class PlayerPrefsRunProgressStore : IRunProgressStore
    {
        const string SchemaKey = "jh.progress.schema";
        const string HighScoreKey = "jh.progress.highScore";
        const string DistanceKey = "jh.progress.longestDistance";
        const string RunsKey = "jh.progress.completedRuns";
        const string ShipKey = "jh.progress.selectedShip";

        public bool TryLoad(out RunProgress progress)
        {
            if (!PlayerPrefs.HasKey(SchemaKey))
            {
                progress = RunProgress.Empty;
                return false;
            }

            progress = new RunProgress
            {
                SchemaVersion = PlayerPrefs.GetInt(SchemaKey, 1),
                HighScore = PlayerPrefs.GetFloat(HighScoreKey, 0f),
                LongestDistance = PlayerPrefs.GetFloat(DistanceKey, 0f),
                CompletedRuns = PlayerPrefs.GetInt(RunsKey, 0),
                SelectedShipId = PlayerPrefs.GetString(ShipKey, "default")
            };
            return true;
        }

        public void Save(RunProgress progress)
        {
            PlayerPrefs.SetInt(SchemaKey, progress.SchemaVersion);
            PlayerPrefs.SetFloat(HighScoreKey, progress.HighScore);
            PlayerPrefs.SetFloat(DistanceKey, progress.LongestDistance);
            PlayerPrefs.SetInt(RunsKey, progress.CompletedRuns);
            PlayerPrefs.SetString(ShipKey, string.IsNullOrWhiteSpace(progress.SelectedShipId) ? "default" : progress.SelectedShipId);
            PlayerPrefs.Save();
        }
    }

    sealed class UnityClock : IClock
    {
        public long UtcUnixMilliseconds => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    // Presentation systems currently consume GameEvents. These intentionally remain silent
    // until audio/haptics/leaderboard implementations are swapped in at the composition root.
    sealed class SilentAudioOutput : IAudioOutput { public void Play(AudioCue cue) { } }
    sealed class SilentHapticsOutput : IHapticsOutput { public void Play(HapticCue cue) { } }
    sealed class SilentAnalyticsSink : IAnalyticsSink { public void Track(AnalyticsEvent analyticsEvent) { } }
    sealed class SilentLeaderboardService : ILeaderboardService { public void SubmitScore(long score) { } }
}
