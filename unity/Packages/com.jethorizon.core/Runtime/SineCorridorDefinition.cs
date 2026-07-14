using System;

namespace JetHorizon.Simulation
{
    /// <summary>
    /// Portable row geometry for the L4/L5 sine corridors. The definition owns the
    /// gameplay numbers; engines only decide how to draw the resulting hazards.
    /// </summary>
    public sealed class SineCorridorDefinition
    {
        public CorridorFamily Family { get; }
        public int CloseRows { get; }
        public int StraightRows { get; }
        public int TotalRows { get; }
        public int ExitRows { get; }
        public int CenterConeInterval { get; }
        public float WideHalfWidth { get; }
        public float NarrowHalfWidth { get; }
        public float SqueezedHalfWidth { get; }
        public float AmplitudeStart { get; }
        public float AmplitudeMaximum { get; }
        public float AmplitudeRampRows { get; }
        public float PeriodStartRows { get; }
        public float PeriodMinimumRows { get; }
        public float PeriodRampRows { get; }
        public float StartDelaySeconds { get; }
        public bool EasedExit { get; }
        public HazardStyle ConeStyle { get; }

        public int SineStartRow => CloseRows + StraightRows;

        internal SineCorridorDefinition(
            CorridorFamily family,
            int closeRows,
            int straightRows,
            int totalRows,
            int exitRows,
            int centerConeInterval,
            float wideHalfWidth,
            float narrowHalfWidth,
            float squeezedHalfWidth,
            float amplitudeStart,
            float amplitudeMaximum,
            float amplitudeRampRows,
            float periodStartRows,
            float periodMinimumRows,
            float periodRampRows,
            float startDelaySeconds,
            bool easedExit,
            HazardStyle coneStyle)
        {
            Family = family;
            CloseRows = closeRows;
            StraightRows = straightRows;
            TotalRows = totalRows;
            ExitRows = exitRows;
            CenterConeInterval = centerConeInterval;
            WideHalfWidth = wideHalfWidth;
            NarrowHalfWidth = narrowHalfWidth;
            SqueezedHalfWidth = squeezedHalfWidth;
            AmplitudeStart = amplitudeStart;
            AmplitudeMaximum = amplitudeMaximum;
            AmplitudeRampRows = amplitudeRampRows;
            PeriodStartRows = periodStartRows;
            PeriodMinimumRows = periodMinimumRows;
            PeriodRampRows = periodRampRows;
            StartDelaySeconds = startDelaySeconds;
            EasedExit = easedExit;
            ConeStyle = coneStyle;
        }

        public float HalfWidthAtRow(int rowsDone, int maximumRows = 0)
        {
            if (rowsDone < 0) throw new ArgumentOutOfRangeException(nameof(rowsDone));
            int maxRows = maximumRows > 0 ? maximumRows : TotalRows;
            float halfWidth;
            if (rowsDone < CloseRows)
            {
                float t = rowsDone / (float)CloseRows;
                halfWidth = WideHalfWidth + (NarrowHalfWidth - WideHalfWidth) * Ease(t);
            }
            else
            {
                int curveRows = Math.Max(0, rowsDone - SineStartRow);
                float squeezeT = Math.Min(1f, curveRows / AmplitudeRampRows);
                halfWidth = NarrowHalfWidth
                    - (NarrowHalfWidth - SqueezedHalfWidth) * squeezeT * squeezeT;

                if (Family == CorridorFamily.L4Sine && curveRows >= 370 && curveRows < 395)
                {
                    float knifeT = (curveRows - 370) / 25f;
                    float spike = 1f - Math.Abs(knifeT * 2f - 1f);
                    halfWidth -= (halfWidth - 3f) * spike;
                }
            }

            if (rowsDone >= maxRows - ExitRows)
            {
                float exitT = Math.Min(1f, (rowsDone - (maxRows - ExitRows)) / (float)ExitRows);
                if (EasedExit) exitT = Ease(exitT);
                halfWidth += (WideHalfWidth - halfWidth) * exitT;
            }
            return halfWidth;
        }

        public float CenterAtRow(int rowsDone, float anchor, ref float sinePhase)
        {
            if (rowsDone < 0) throw new ArgumentOutOfRangeException(nameof(rowsDone));
            if (rowsDone < SineStartRow)
            {
                sinePhase = 0f;
                return anchor;
            }

            int curveRows = rowsDone - SineStartRow;
            float amplitudeT = Math.Min(1f, curveRows / AmplitudeRampRows);
            float amplitude = AmplitudeStart
                + (AmplitudeMaximum - AmplitudeStart) * amplitudeT * amplitudeT;
            float periodT = Math.Min(1f, curveRows / PeriodRampRows);
            float period = PeriodStartRows
                - (PeriodStartRows - PeriodMinimumRows) * periodT * periodT;
            sinePhase += (float)(2.0 * Math.PI) / period;
            return anchor + amplitude * (float)Math.Sin(sinePhase);
        }

        public bool ShouldSpawnCenterCone(int rowsDone, int maximumRows = 0)
        {
            if (CenterConeInterval <= 0) return false;
            int sinceStart = rowsDone - SineStartRow;
            int maxRows = maximumRows > 0 ? maximumRows : TotalRows;
            return sinceStart > 0
                && sinceStart % CenterConeInterval == 0
                && rowsDone < maxRows - ExitRows;
        }

        static float Ease(float t) => t < 0.5f
            ? 2f * t * t
            : -1f + (4f - 2f * t) * t;
    }

    public static class SineCorridorCatalog
    {
        public static readonly SineCorridorDefinition L4 = new SineCorridorDefinition(
            CorridorFamily.L4Sine,
            35, 10, 518, 20, 0,
            80f, 6f, 4.5f,
            14f, 44f, 120f,
            220f, 160f, 260f,
            1.5f, false,
            HazardStyle.L4CorridorCone);

        public static readonly SineCorridorDefinition L5 = new SineCorridorDefinition(
            CorridorFamily.L5Sine,
            29, 12, 420, 20, 12,
            64f, 10f, 8f,
            10f, 40f, 180f,
            200f, 140f, 280f,
            0f, true,
            HazardStyle.L5CorridorCone);

        public static SineCorridorDefinition For(CorridorFamily family)
        {
            switch (family)
            {
                case CorridorFamily.L4Sine: return L4;
                case CorridorFamily.L5Sine: return L5;
                default: throw new ArgumentOutOfRangeException(nameof(family), family, "Not a sine corridor family.");
            }
        }
    }
}
