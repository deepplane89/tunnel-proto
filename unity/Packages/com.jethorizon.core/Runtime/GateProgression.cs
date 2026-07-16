using System;

namespace JetHorizon.Simulation
{
    public enum SpeedGateKind
    {
        Common,
        Surge,
        CanyonTransition,
        PrismaticTransition,
        Extraction
    }

    public enum RunEnvironmentKind
    {
        OpenWater,
        CrystallineCanyon,
        PrismaticCorridor
    }

    public enum EnvironmentLifecycle
    {
        Dormant,
        ApproachingTransition,
        GateCrossedReveal,
        Active,
        ExitBreakup,
        Retired
    }

    public readonly struct GateProgressionState
    {
        public float EarnedSpeedBonus { get; }
        public float CurrentCruiseSpeed { get; }
        public float SoftCap { get; }
        public int Streak { get; }
        public int HighestStreak { get; }
        public int GatesCrossed { get; }
        public int GatesMissed { get; }

        internal GateProgressionState(
            float earnedSpeedBonus,
            float currentCruiseSpeed,
            float softCap,
            int streak,
            int highestStreak,
            int gatesCrossed,
            int gatesMissed)
        {
            EarnedSpeedBonus = earnedSpeedBonus;
            CurrentCruiseSpeed = currentCruiseSpeed;
            SoftCap = softCap;
            Streak = streak;
            HighestStreak = highestStreak;
            GatesCrossed = gatesCrossed;
            GatesMissed = gatesMissed;
        }
    }

    /// <summary>
    /// The only rule set allowed to convert gate crossings into run-long speed.
    /// It is deliberately additive so no caller can create exponential pace growth.
    /// </summary>
    public sealed class GateProgressionModel
    {
        float _earnedSpeedBonus;
        int _streak;
        int _highestStreak;
        int _gatesCrossed;
        int _gatesMissed;

        public float EarnedSpeedBonus => _earnedSpeedBonus;
        public int Streak => _streak;
        public int HighestStreak => _highestStreak;
        public int GatesCrossed => _gatesCrossed;
        public int GatesMissed => _gatesMissed;

        public void Reset()
        {
            _earnedSpeedBonus = 0f;
            _streak = 0;
            _highestStreak = 0;
            _gatesCrossed = 0;
            _gatesMissed = 0;
        }

        public float Cross(SpeedGateKind kind, float baseCruiseSpeed, int heat)
        {
            if (kind == SpeedGateKind.Extraction) return 0f;
            float current = baseCruiseSpeed + _earnedSpeedBonus;
            float gain = GainFor(kind, current);
            float cap = SoftCapForHeat(heat);
            if (current >= cap) gain *= .15f;
            else if (current + gain > cap)
                gain = (cap - current) + (current + gain - cap) * .15f;

            _earnedSpeedBonus += Math.Max(0f, gain);
            _streak++;
            _highestStreak = Math.Max(_highestStreak, _streak);
            _gatesCrossed++;
            return gain;
        }

        public void Miss()
        {
            _streak = 0;
            _gatesMissed++;
        }

        public GateProgressionState Snapshot(float baseCruiseSpeed, int heat)
        {
            float cap = SoftCapForHeat(heat);
            return new GateProgressionState(
                _earnedSpeedBonus,
                Math.Max(0f, Math.Min(cap, baseCruiseSpeed + _earnedSpeedBonus)),
                cap,
                _streak,
                _highestStreak,
                _gatesCrossed,
                _gatesMissed);
        }

        public static float GainFor(SpeedGateKind kind, float currentSpeed)
        {
            bool surge = kind == SpeedGateKind.Surge
                || kind == SpeedGateKind.CanyonTransition
                || kind == SpeedGateKind.PrismaticTransition;
            if (currentSpeed < 90f) return surge ? 6f : 1f;
            if (currentSpeed <= 120f) return surge ? 4f : .65f;
            return surge ? 2.5f : .35f;
        }

        public static float SoftCapForHeat(int heat)
        {
            switch (Math.Max(0, Math.Min(5, heat)))
            {
                case 0: return 90f;
                case 1: return 112f;
                case 2: return 132f;
                case 3: return 150f;
                case 4: return 165f;
                default: return 180f;
            }
        }
    }
}
