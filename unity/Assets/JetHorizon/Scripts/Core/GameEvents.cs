using System;
using JetHorizon.Simulation;

namespace JetHorizon
{
    /// <summary>
    /// Global event bus. Systems communicate through events instead of reaching
    /// into each other — the #1 architectural fix over the JS version, where a
    /// single mutated global (_canyonTuner et al.) leaked state between systems.
    /// </summary>
    public static class GameEvents
    {
        public static event Action<GamePhase, GamePhase> PhaseChanged;   // (from, to)
        public static event Action RunStarted;
        public static event Action PlayerDied;
        public static event Action<int> StageChanged;                    // stage index
        public static event Action<float, float> SpeedChanged;           // (from, to) u/s
        public static event Action<SpeedGateKind, float, int> SpeedGateCrossed; // kind, gain, streak
        public static event Action<int> VibeChanged;                     // palette index
        public static event Action NearMiss;
        public static event Action CoinCollected;
        public static event Action<int, RunCargoKind, int> CargoCollected; // id, kind, credit value
        public static event Action<PowerupType> PowerupCollected;
        public static event Action<PowerupType, float> PowerupActivated;
        public static event Action<PowerupType> PowerupExpired;
        public static event Action<int> ShieldHit;
        public static event Action ShieldBroken;
        public static event Action<float> LaserFired;
        public static event Action<int, float, float> HazardDestroyed; // id, x, z
        public static event Action<int, int> LaserChainAdvanced; // chain, destroyed total
        public static event Action<float, float> LaserFormationCompleted; // x, z
        public static event Action CanyonRevealed;
        public static event Action KlaxonCountdown;                      // 1.5s before a speed bump
        public static event Action LightningStruck;
        public static event Action<int> RunExtracted;

        public static void RaisePhaseChanged(GamePhase from, GamePhase to) => PhaseChanged?.Invoke(from, to);
        public static void RaiseRunStarted()                => RunStarted?.Invoke();
        public static void RaisePlayerDied()                => PlayerDied?.Invoke();
        public static void RaiseStageChanged(int idx)       => StageChanged?.Invoke(idx);
        public static void RaiseSpeedChanged(float a, float b) => SpeedChanged?.Invoke(a, b);
        public static void RaiseSpeedGateCrossed(SpeedGateKind kind, float gain, int streak) => SpeedGateCrossed?.Invoke(kind, gain, streak);
        public static void RaiseVibeChanged(int idx)        => VibeChanged?.Invoke(idx);
        public static void RaiseNearMiss()                  => NearMiss?.Invoke();
        public static void RaiseCoinCollected()             => CoinCollected?.Invoke();
        public static void RaiseCargoCollected(int id, RunCargoKind kind, int creditValue) => CargoCollected?.Invoke(id, kind, creditValue);
        public static void RaisePowerupCollected(PowerupType type) => PowerupCollected?.Invoke(type);
        public static void RaisePowerupActivated(PowerupType type, float duration) => PowerupActivated?.Invoke(type, duration);
        public static void RaisePowerupExpired(PowerupType type) => PowerupExpired?.Invoke(type);
        public static void RaiseShieldHit(int remaining)    => ShieldHit?.Invoke(remaining);
        public static void RaiseShieldBroken()              => ShieldBroken?.Invoke();
        public static void RaiseLaserFired(float laneOffset) => LaserFired?.Invoke(laneOffset);
        public static void RaiseHazardDestroyed(int id, float x, float z) => HazardDestroyed?.Invoke(id, x, z);
        public static void RaiseLaserChainAdvanced(int chain, int destroyedTotal) => LaserChainAdvanced?.Invoke(chain, destroyedTotal);
        public static void RaiseLaserFormationCompleted(float x, float z) => LaserFormationCompleted?.Invoke(x, z);
        public static void RaiseCanyonRevealed()            => CanyonRevealed?.Invoke();
        public static void RaiseKlaxonCountdown()           => KlaxonCountdown?.Invoke();
        public static void RaiseLightningStruck()            => LightningStruck?.Invoke();
        public static void RaiseRunExtracted(int cargoUnits)  => RunExtracted?.Invoke(cargoUnits);

        /// <summary>Clear all listeners (domain reload safety / scene reload).</summary>
        public static void Reset()
        {
            PhaseChanged = null; RunStarted = null; PlayerDied = null; StageChanged = null;
            SpeedChanged = null; SpeedGateCrossed = null; VibeChanged = null; NearMiss = null; CoinCollected = null; CargoCollected = null;
            PowerupCollected = null; PowerupActivated = null; PowerupExpired = null;
            ShieldHit = null; ShieldBroken = null; LaserFired = null; HazardDestroyed = null;
            LaserChainAdvanced = null; LaserFormationCompleted = null;
            CanyonRevealed = null; KlaxonCountdown = null; LightningStruck = null;
            RunExtracted = null;
        }
    }
}
