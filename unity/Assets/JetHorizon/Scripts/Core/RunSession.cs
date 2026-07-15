using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// All mutable per-run state, in ONE object, reset in ONE method.
    /// (Replaces the JS `state` global + module-scoped variables.)
    /// </summary>
    public sealed class RunSession
    {
        // ── Speed / progress ───────────────────────────────
        public float Speed;              // u/s (world scroll)
        public float CoreEffectiveSpeed; // full unified pace, including temporary effects
        public float SpeedFloor;         // _drSpeedFloor ratchet (multiplier)
        public float Distance;
        public float Elapsed;
        public float Score;              // canonical core score shown on HUD and finalized on death
        public int   PhysTier = 1;

        // ── Ship ───────────────────────────────────────────
        public float ShipX;
        public float ShipVelX;
        public float RollAngle;          // knife-edge roll, radians
        public int   RollDir;            // -1/0/+1 held direction
        public bool  RollHeld;
        public float TiltTimer;
        public float ShipY = Tuning.ShipPreLaunchY;
        public float BankRoll;           // smoothed visual bank (rotation.z)

        // ── Flags / timers ─────────────────────────────────
        public bool  IntroActive;
        public bool  IntroLiftActive;
        public float IntroLiftT;
        public float PostLaunchGrace;
        public float InvincibleTimer;
        public bool  OverdriveActive;    // world x1.8
        public float ShieldTimer;
        public int   ShieldHits;
        public float LaserTimer;
        public float OverdriveTimer;
        public float OverdriveSpeedTimer;
        public float MagnetTimer;
        public float RestBeat;           // suppresses spawner while > 0
        public float NextSpawnZ;         // spawn accumulator
        public float CorridorGapCenter;  // canyon / corridor centerline base

        // ── Mechanic ownership flags (mutually exclusive families) ──
        public bool CanyonActive;
        public bool CanyonExiting;
        public bool SineCorridorActive;
        public bool ZipperActive;
        public bool SlalomActive;
        public bool AngledWallsActive;

        /// <summary>Effective world scroll speed this tick.</summary>
        public float EffectiveSpeed => CoreEffectiveSpeed > 0f
            ? CoreEffectiveSpeed
            : OverdriveActive ? Speed * 1.8f : Speed;

        public bool AnyCorridorActive => CanyonActive || SineCorridorActive;

        /// <summary>The single authoritative run reset (JS needed ~90 scattered fields).</summary>
        public void ResetForNewRun()
        {
            Speed = Tuning.BaseSpeed;
            CoreEffectiveSpeed = Tuning.BaseSpeed;
            SpeedFloor = 1f;
            Distance = 0f; Elapsed = 0f; Score = 0f;
            PhysTier = 1;

            ShipX = 0f; ShipVelX = 0f;
            RollAngle = 0f; RollDir = 0; RollHeld = false; TiltTimer = 0f;
            ShipY = Tuning.ShipPreLaunchY; BankRoll = 0f;

            IntroActive = false; IntroLiftActive = false; IntroLiftT = 0f;
            PostLaunchGrace = 0f;
            InvincibleTimer = 0f; OverdriveActive = false;
            ShieldTimer = 0f; ShieldHits = 0; LaserTimer = 0f;
            OverdriveTimer = 0f; OverdriveSpeedTimer = 0f; MagnetTimer = 0f;
            RestBeat = 0f;
            NextSpawnZ = -5f;
            CorridorGapCenter = 0f;

            CanyonActive = false; CanyonExiting = false;
            SineCorridorActive = false; ZipperActive = false;
            SlalomActive = false; AngledWallsActive = false;
        }

        /// <summary>Repair ("Save Me"): same run continues; score resets, distance kept.</summary>
        public void ResetForRepair()
        {
            Score = 0f;
            CoreEffectiveSpeed = Speed;
            ShipX = 0f; ShipVelX = 0f; RollAngle = 0f; RollDir = 0; RollHeld = false;
            TiltTimer = 0f; BankRoll = 0f;
            ShipY = Tuning.ShipHoverY;
            InvincibleTimer = Tuning.InvulnAfterRepair;
            RestBeat = 1.5f;
        }
    }
}
