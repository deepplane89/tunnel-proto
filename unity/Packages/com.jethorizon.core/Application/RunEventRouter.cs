using System;
using JetHorizon.Simulation;

namespace JetHorizon.Application
{
    /// <summary>
    /// Converts neutral simulation events into platform-facing effects. It is intentionally
    /// outside the simulation so audio, haptics, analytics, and saves cannot affect replay.
    /// </summary>
    public sealed class RunEventRouter
    {
        readonly GameServices _services;
        readonly RunCompletionService _completion;

        public RunCompletionOutcome? LastCompletion { get; private set; }

        public RunEventRouter(GameServices services)
        {
            _services = services ?? throw new ArgumentNullException(nameof(services));
            _completion = new RunCompletionService(_services);
        }

        public void Dispatch(SimulationEventBuffer events, RunResult completedRun = null)
        {
            if (events == null) throw new ArgumentNullException(nameof(events));
            for (int i = 0; i < events.Count; i++) Dispatch(events[i], completedRun);
        }

        void Dispatch(SimulationEvent simulationEvent, RunResult completedRun)
        {
            switch (simulationEvent.Type)
            {
                case SimulationEventType.RunStarted:
                    LastCompletion = null;
                    _services.Audio.Play(AudioCue.RunStarted);
                    _services.Analytics.Track(new AnalyticsEvent(
                        "run_started",
                        timestampUnixMilliseconds: _services.Clock.UtcUnixMilliseconds));
                    break;

                case SimulationEventType.StageChanged:
                    _services.Audio.Play(AudioCue.StageChanged);
                    _services.Analytics.Track(new AnalyticsEvent("stage_changed", simulationEvent.EntityId));
                    break;

                case SimulationEventType.KlaxonCountdown:
                    _services.Audio.Play(AudioCue.SpeedWarning);
                    _services.Haptics.Play(HapticCue.Warning);
                    break;

                case SimulationEventType.NearMiss:
                    _services.Audio.Play(AudioCue.NearMiss);
                    _services.Haptics.Play(HapticCue.Light);
                    _services.Analytics.Track(new AnalyticsEvent("near_miss", simulationEvent.ValueA));
                    break;

                case SimulationEventType.PickupCollected:
                    _services.Audio.Play(AudioCue.Pickup);
                    _services.Haptics.Play(HapticCue.Light);
                    break;

                case SimulationEventType.PlayerDied:
                    _services.Audio.Play(AudioCue.PlayerDied);
                    _services.Haptics.Play(HapticCue.Impact);
                    if (completedRun != null) LastCompletion = _completion.Complete(completedRun);
                    break;

                case SimulationEventType.RunExtracted:
                    _services.Audio.Play(AudioCue.RunExtracted);
                    _services.Haptics.Play(HapticCue.Light);
                    if (completedRun != null) LastCompletion = _completion.Complete(completedRun);
                    break;
            }
        }
    }
}
