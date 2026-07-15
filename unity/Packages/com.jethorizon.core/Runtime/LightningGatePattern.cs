using System;

namespace JetHorizon.Simulation
{
    public enum LightningGatePatternKind
    {
        SweepRight,
        SweepLeft,
        CrossCut,
        Reversal
    }

    /// <summary>
    /// Deterministic lateral openings for lightning rows. Every sequence blocks both
    /// edge-camping positions and neutral flight while moving the safe opening in
    /// reachable increments instead of aiming a strike at the live player.
    /// </summary>
    public static class LightningGatePattern
    {
        static readonly float[][] Steps =
        {
            new[] { -0.55f, -0.28f, 0.00f, 0.28f, 0.55f, 0.22f, -0.12f },
            new[] {  0.55f,  0.28f, 0.00f,-0.28f,-0.55f,-0.22f,  0.12f },
            new[] { -0.48f, -0.12f, 0.34f, 0.05f,-0.38f, 0.18f,  0.50f },
            new[] {  0.42f,  0.12f,-0.18f,-0.50f,-0.12f, 0.28f, -0.30f }
        };

        public static int StepCount(LightningGatePatternKind kind) => Steps[(int)kind].Length;

        public static float SafeCenterNormalized(LightningGatePatternKind kind, int step)
        {
            float[] sequence = Steps[(int)kind];
            if (step < 0) throw new ArgumentOutOfRangeException(nameof(step));
            return sequence[step % sequence.Length];
        }

        public static bool DefeatsConstantPosition(LightningGatePatternKind kind, float normalizedPosition, float safeHalfWidthNormalized)
        {
            if (safeHalfWidthNormalized <= 0f || safeHalfWidthNormalized >= 1f)
                throw new ArgumentOutOfRangeException(nameof(safeHalfWidthNormalized));
            float[] sequence = Steps[(int)kind];
            for (int i = 0; i < sequence.Length; i++)
                if (Math.Abs(normalizedPosition - sequence[i]) > safeHalfWidthNormalized) return true;
            return false;
        }

        public static bool IsReachable(
            LightningGatePatternKind kind,
            float corridorHalfWidth,
            float safeHalfWidth,
            float maxLateralTravelPerStep)
        {
            if (corridorHalfWidth <= 0f || safeHalfWidth <= 0f || maxLateralTravelPerStep <= 0f) return false;
            float[] sequence = Steps[(int)kind];
            for (int i = 1; i < sequence.Length; i++)
            {
                float travel = Math.Abs(sequence[i] - sequence[i - 1]) * corridorHalfWidth;
                if (travel > maxLateralTravelPerStep + safeHalfWidth) return false;
            }
            return true;
        }
    }
}
