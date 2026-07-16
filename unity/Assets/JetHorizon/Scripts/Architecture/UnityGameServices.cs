using System;
using System.Globalization;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using JetHorizon.Application;
using JetHorizon.Meta;
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
                new UnityHapticsOutput(),
                new SilentAnalyticsSink(),
                new UnityClock(),
                new PlayerPrefsLeaderboardOutbox());
        }

        public static GarageOrchestrator CreateGarage()
        {
            return new GarageOrchestrator(
                new PlayerPrefsGarageProgressStore(),
                new UnityClock(),
                new DisabledRepairAcceleration());
        }
    }

    sealed class PlayerPrefsGarageProgressStore : IGarageProgressStore
    {
        const string Key = "jh.garage.v1";

        public bool TryLoad(out GarageState state)
        {
            string json = PlayerPrefs.GetString(Key, string.Empty);
            if (string.IsNullOrWhiteSpace(json)) { state = null; return false; }
            try
            {
                state = JsonUtility.FromJson<GarageState>(json);
                return state != null && state.SchemaVersion > 0;
            }
            catch
            {
                state = null;
                return false;
            }
        }

        public void Save(GarageState state)
        {
            PlayerPrefs.SetString(Key, JsonUtility.ToJson(state));
            PlayerPrefs.Save();
        }
    }

    sealed class DisabledRepairAcceleration : IRepairAccelerationPort
    {
        public bool TryConsumeRepairAcceleration(long repairJobId) => false;
    }

    sealed class PlayerPrefsRunProgressStore : IRunProgressStore
    {
        const string SchemaKey = "jh.progress.schema";
        const string HighScoreKey = "jh.progress.highScore";
        const string HighScoreV2Key = "jh.progress.highScore.v2";
        const string DistanceKey = "jh.progress.longestDistance";
        const string RunsKey = "jh.progress.completedRuns";
        const string ShipKey = "jh.progress.selectedShip";
        const string LastRunKey = "jh.progress.lastCompletedRunId";

        public bool TryLoad(out RunProgress progress)
        {
            if (!PlayerPrefs.HasKey(SchemaKey))
            {
                progress = RunProgress.Empty;
                return false;
            }

            long highScore = 0L;
            if (!long.TryParse(PlayerPrefs.GetString(HighScoreV2Key, "0"), NumberStyles.Integer, CultureInfo.InvariantCulture, out highScore))
                highScore = 0L;
            if (!PlayerPrefs.HasKey(HighScoreV2Key))
                highScore = Math.Max(0L, (long)Math.Floor(PlayerPrefs.GetFloat(HighScoreKey, 0f)));

            long lastRunId = 0L;
            long.TryParse(PlayerPrefs.GetString(LastRunKey, "0"), NumberStyles.Integer, CultureInfo.InvariantCulture, out lastRunId);

            progress = new RunProgress
            {
                SchemaVersion = PlayerPrefs.GetInt(SchemaKey, 1),
                HighScore = highScore,
                LongestDistance = PlayerPrefs.GetFloat(DistanceKey, 0f),
                CompletedRuns = PlayerPrefs.GetInt(RunsKey, 0),
                SelectedShipId = PlayerPrefs.GetString(ShipKey, "default"),
                LastCompletedRunId = lastRunId
            };
            return true;
        }

        public void Save(RunProgress progress)
        {
            PlayerPrefs.SetInt(SchemaKey, progress.SchemaVersion);
            PlayerPrefs.SetString(HighScoreV2Key, progress.HighScore.ToString(CultureInfo.InvariantCulture));
            PlayerPrefs.SetFloat(DistanceKey, progress.LongestDistance);
            PlayerPrefs.SetInt(RunsKey, progress.CompletedRuns);
            PlayerPrefs.SetString(ShipKey, string.IsNullOrWhiteSpace(progress.SelectedShipId) ? "default" : progress.SelectedShipId);
            PlayerPrefs.SetString(LastRunKey, progress.LastCompletedRunId.ToString(CultureInfo.InvariantCulture));
            PlayerPrefs.Save();
        }
    }

    sealed class UnityClock : IUtcClock
    {
        public long UtcUnixMilliseconds => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    }

    // GameEvents still own rich Unity audio presentation. Application ports stay available
    // for platform effects and persistence that must not reach into gameplay.
    sealed class SilentAudioOutput : IAudioOutput { public void Play(AudioCue cue) { } }
    sealed class UnityHapticsOutput : IHapticsOutput
    {
#if UNITY_IOS && !UNITY_EDITOR
        [DllImport("__Internal")]
        static extern void JH_PlayHaptic(int style);
#endif

        public void Play(HapticCue cue)
        {
#if UNITY_IOS && !UNITY_EDITOR
            JH_PlayHaptic(cue == HapticCue.Light ? 0 : cue == HapticCue.Warning ? 1 : 2);
#elif UNITY_ANDROID && !UNITY_EDITOR
            if (cue != HapticCue.Light) Handheld.Vibrate();
#endif
        }
    }
    sealed class SilentAnalyticsSink : IAnalyticsSink { public void Track(AnalyticsEvent analyticsEvent) { } }
    /// <summary>
    /// Durable Unity-side submission queue. A network publisher can drain this after
    /// player-name/profile UI is connected without losing scores earned beforehand.
    /// </summary>
    sealed class PlayerPrefsLeaderboardOutbox : ILeaderboardService
    {
        const string QueueKey = "jh.leaderboard.pending.v1";
        const int MaxPending = 32;

        [Serializable]
        sealed class PendingEntry
        {
            public string runId;
            public string score;
        }

        [Serializable]
        sealed class PendingQueue
        {
            public List<PendingEntry> entries = new List<PendingEntry>();
        }

        public void SubmitScore(LeaderboardSubmission submission)
        {
            PendingQueue queue = Load();
            string runId = submission.RunId.ToString(CultureInfo.InvariantCulture);
            for (int i = 0; i < queue.entries.Count; i++)
                if (queue.entries[i].runId == runId) return;

            queue.entries.Add(new PendingEntry
            {
                runId = runId,
                score = submission.Score.ToString(CultureInfo.InvariantCulture)
            });
            if (queue.entries.Count > MaxPending)
                queue.entries.RemoveRange(0, queue.entries.Count - MaxPending);
            PlayerPrefs.SetString(QueueKey, JsonUtility.ToJson(queue));
            PlayerPrefs.Save();
        }

        static PendingQueue Load()
        {
            string json = PlayerPrefs.GetString(QueueKey, string.Empty);
            if (string.IsNullOrWhiteSpace(json)) return new PendingQueue();
            try
            {
                var queue = JsonUtility.FromJson<PendingQueue>(json);
                return queue ?? new PendingQueue();
            }
            catch
            {
                return new PendingQueue();
            }
        }
    }
}
