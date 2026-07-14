using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Immutable canyon activation preset — replaces the JS shared mutable _canyonTuner
    /// (the source of every "preset leaked into the next canyon" bug). A fresh copy is
    /// handed to CanyonSystem per activation; nothing persists between canyons.
    /// Values: spec/02 §6.6.
    /// </summary>
    public sealed class CanyonPreset
    {
        public string Name;
        public float Duration = 20f;
        public float ExitWindow = 4f;
        public float EntryRamp = 0.4f;
        public int Mode = 1;                     // 5 = tapered halfX + intensity ramp
        public float SlabH = 55f, SlabW = 20f, SlabThick = 60f;
        public int Cols = 5, Rows = 6;
        public float Disp = 4f, Snap = 0.7f;
        public bool SnapOscillates;              // L3 knife: 0.1 ↔ 1.5, 4 s period
        public float FootX = 9f, SweepX = 4f, MidX = 17f, CrestX = 20f;
        public float ScrollSpeed = 1f;
        public float HalfXOverride = 40f;
        public float HalfXStart = 60f, HalfXFull = 25f;      // mode-5 taper (Z −150 → −500)
        public float SineIntensity = 0.28f, SineStartI = 0f;
        public float SineAmp = 120f, SinePeriod = 330f, SineSpeed = 1f;
        public bool AllCyan, AllDark;
        public bool L4Recreation;                // bend along the L4 sine instead
        public float SpawnDepth = -250f;
        public float EntranceThick = 700f;
        public float LightningFreq;              // 0 = none
    }

    public static class CanyonPresets
    {
        public static CanyonPreset PreT4A(bool darkSlabs = false) => new CanyonPreset
        {
            Name = "PRE_T4A", Mode = 5,
            SlabH = 190f, ScrollSpeed = 1.5f,
            HalfXOverride = 50f, HalfXStart = 60f, HalfXFull = 25f,
            SineIntensity = 0.3f, SineStartI = 0f,
            AllCyan = false, AllDark = darkSlabs,
            LightningFreq = 0.3f,
        };

        public static CanyonPreset PreT4B() => new CanyonPreset
        {
            Name = "PRE_T4B", Mode = 1,
            HalfXOverride = 34f,
            SineIntensity = 0.28f, SineStartI = 0.28f,
            AllCyan = true,
            LightningFreq = 2.0f,
        };

        public static CanyonPreset L3Knife() => new CanyonPreset
        {
            Name = "L3_KNIFE", Mode = 1, Duration = 40f,
            SlabW = 40f, Disp = 2f,
            SnapOscillates = true,
            FootX = 26f, SweepX = 20f, MidX = 0f, CrestX = 0f,
            HalfXOverride = 21.5f,
            SineIntensity = 0.28f, SineStartI = 0.28f,
            L4Recreation = true,
            LightningFreq = 0f,
        };
    }
}
