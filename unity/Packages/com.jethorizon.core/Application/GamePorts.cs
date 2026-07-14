using System;

namespace JetHorizon.Application
{
    public struct RunProgress
    {
        public int SchemaVersion;
        public float HighScore;
        public float LongestDistance;
        public int CompletedRuns;
        public string SelectedShipId;

        public static RunProgress Empty => new RunProgress
        {
            SchemaVersion = 1,
            SelectedShipId = "default"
        };
    }

    public interface IRunProgressStore
    {
        bool TryLoad(out RunProgress progress);
        void Save(RunProgress progress);
    }

    public enum AudioCue
    {
        RunStarted,
        StageChanged,
        SpeedWarning,
        NearMiss,
        Pickup,
        PlayerDied
    }

    public interface IAudioOutput
    {
        void Play(AudioCue cue);
    }

    public enum HapticCue
    {
        Light,
        Warning,
        Impact
    }

    public interface IHapticsOutput
    {
        void Play(HapticCue cue);
    }

    public struct AnalyticsEvent
    {
        public string Name { get; }
        public float ValueA { get; }
        public float ValueB { get; }
        public long TimestampUnixMilliseconds { get; }

        public AnalyticsEvent(
            string name,
            float valueA = 0f,
            float valueB = 0f,
            long timestampUnixMilliseconds = 0L)
        {
            Name = string.IsNullOrWhiteSpace(name)
                ? throw new ArgumentException("Analytics event name is required.", nameof(name))
                : name;
            ValueA = valueA;
            ValueB = valueB;
            TimestampUnixMilliseconds = timestampUnixMilliseconds;
        }
    }

    public interface IAnalyticsSink
    {
        void Track(AnalyticsEvent analyticsEvent);
    }

    public interface IClock
    {
        long UtcUnixMilliseconds { get; }
    }

    public interface ILeaderboardService
    {
        void SubmitScore(long score);
    }

    /// <summary>
    /// Explicit application composition. Engine adapters supply these ports at startup;
    /// gameplay and content never locate global platform objects themselves.
    /// </summary>
    public sealed class GameServices
    {
        public IRunProgressStore Progress { get; }
        public IAudioOutput Audio { get; }
        public IHapticsOutput Haptics { get; }
        public IAnalyticsSink Analytics { get; }
        public IClock Clock { get; }
        public ILeaderboardService Leaderboard { get; }

        public GameServices(
            IRunProgressStore progress,
            IAudioOutput audio,
            IHapticsOutput haptics,
            IAnalyticsSink analytics,
            IClock clock,
            ILeaderboardService leaderboard)
        {
            Progress = progress ?? throw new ArgumentNullException(nameof(progress));
            Audio = audio ?? throw new ArgumentNullException(nameof(audio));
            Haptics = haptics ?? throw new ArgumentNullException(nameof(haptics));
            Analytics = analytics ?? throw new ArgumentNullException(nameof(analytics));
            Clock = clock ?? throw new ArgumentNullException(nameof(clock));
            Leaderboard = leaderboard ?? throw new ArgumentNullException(nameof(leaderboard));
        }
    }
}
