// Jet Horizon — authoritative tuning constants.
// Every value here was extracted from the shipping three.js build (see unity/spec/*.md).
// Do not "improve" numbers casually — these ARE the game feel.
namespace JetHorizon
{
    public static class Tuning
    {
        // ── World ──────────────────────────────────────────────
        public const float BaseSpeed        = 36f;    // u/s at 1.0x
        public const int   LaneCount        = 21;
        public const float LaneWidth        = 3.2f;
        public const float SpawnZ           = -160f;
        public const float DespawnZ         = 6f;
        public const float ShipZ            = 3.9f;   // ship never moves in Z
        public const float ShipHoverY       = 1.21f;
        public const float ShipPreLaunchY   = 0.38f;
        public const float ShipScale        = 0.30f;
        public const float ShipHalfWidth    = 1.2f;   // canyon collision
        public const float FixedDt          = 1f / 60f;
        public const float MaxRawDt         = 0.05f;

        // ── Lateral physics (prod, locked across levels) ───────
        public const float Snap             = 0.5625f;
        public const float AccelBase        = 27.5f;
        public const float AccelSnap        = 65f;
        public const float MaxVelBase       = 9f;
        public const float MaxVelSnap       = 13f;
        public const float DecelBasePct     = 0.02f;
        public const float CounterSteerBoost= 3f;
        // Derived (drift = 1.0): ACCEL = (27.5 + .5625*65) * 0.75 = 48.05
        public static float Accel   => (AccelBase + Snap * AccelSnap) * 0.75f;
        public static float Decel   => (10f + Snap * 26f) * DecelBasePct;      // 0.4925 /s
        public static float MaxVel  => MaxVelBase + Snap * MaxVelSnap;         // 16.31 u/s

        // ── Roll / knife-edge ──────────────────────────────────
        public const float TiltGrace        = 2.0f;
        public static float SpinSpeed => (1.2f + Snap * 2.3f) * UnityEngine.Mathf.PI; // ~7.83 rad/s
        public const float RollMaxAngle     = UnityEngine.Mathf.PI / 2f;
        public const float RollReturnMult   = 1.5f;

        // ── Banking (visual) ───────────────────────────────────
        public const float SteerBankRadMax  = 0.52f;
        public const float BankSmoothing    = 8f;
        public const float BankReturnRate   = 12f;
        public const float BankZeroCrossMult= 3f;
        public const float CamRollAmt       = 0.4f;
        public const float YawMax           = 0.01f;
        public const float YawSmoothing     = 12f;
        public const float PitchForwardMax  = 0.15f;
        public const float PitchBackMax     = 0.08f;
        public const float PitchSmoothing   = 5f;
        public const float ShipRotXOffset   = 0.02f;

        // ── Hover / intro ──────────────────────────────────────
        public const float BobAmplitude     = 0.03f;
        public const float BobFrequency     = 0.60f;
        public const float IntroLiftDur     = 0.8f;
        public const float IntroLiftPitch   = -0.18f;
        public const float PostLaunchGrace  = 2.0f;

        // ── Camera ─────────────────────────────────────────────
        public const float CamBaseFovDesktop = 78f;
        public const float CamBaseY          = 2.8f;
        public const float CamPivotYOffset   = 0.10f;
        public const float CamPivotZ         = 9f - 1.5f;   // 7.5
        public const float CamYFollow        = 0.35f;
        public const float CamYLerp          = 6f;
        public static readonly UnityEngine.Vector3 CamLookLocal = new UnityEngine.Vector3(0f, -7.8f, -19.5f);
        public const float FovSpeedBoost     = 32f;
        public const float FovKickExponent   = 1.4f;
        public const float DeathCamRise      = 35f;
        public const float DeathCamPullback  = 2f;
        public const float DeathOrbitRate    = 0.38f;
        public const float RetrySweepDur     = 1.3f;
        public static readonly UnityEngine.Vector3 RetryCamStart = new UnityEngine.Vector3(0f, 7.5f, 16f);
        public const float RetryFovStart     = 85f;
        public const float ShakeAmt          = 0.18f;
        public const float ShakeDur          = 0.35f;

        // ── Collision ──────────────────────────────────────────
        public const float WingHalf          = 1.5f;
        public const float BodyHalf          = 0.8f;
        public const float ColDistZ          = 1.5f;
        public const float NearMissBand      = 0.6f;
        public const float NearMissZ         = 2.0f;

        // ── Flow / death ───────────────────────────────────────
        public const float GameOverDelay     = 2.8f;
        public const float InvulnAfterRepair = 3.0f;

        // ── Spawner ────────────────────────────────────────────
        public const int   ObstaclePoolSize  = 500;
        public const float FadeInEndZ        = -110f;  // opacity 0 at -160 → 1 at -110

        // ── Zipper ─────────────────────────────────────────────
        public const int   ZipperRows        = 13;
        public const float ZipperGapHalf     = 7.5f;
        public const float ZipperOffset      = 11f;

        // ── Slalom ─────────────────────────────────────────────
        public const float SlalomZSpacing    = 60f;
        public const float SlalomGapWidthDR  = 10f;
        public const float SlalomConeStep    = 14f;
        public const float SlalomMinGapFromShip = 14f;

        // ── Scoring ────────────────────────────────────────────
        public const float ScoreRatePerSec   = 8f;
        public const float NearMissScore     = 25f;
        public const float CoinScore         = 75f;
    }
}
