using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Ship lateral physics + all visual rotation (bank/yaw/pitch), knife-edge roll,
    /// hover bob and intro lift. Direct port of spec/01 §1 — the core feel.
    /// Ship stays at Z = 3.9; the world scrolls.
    /// </summary>
    public sealed class ShipController : MonoBehaviour, ISimSystem
    {
        public ShipInput Input;
        public Transform ShipRoot;      // scaled 0.30, position driven here

        // Bank state
        float _bankVelX;
        float _yawSmooth;
        float _pitchSmooth;
        float _prevSpeed;
        float _bobBlend = 1f, _bobSteerBlend = 1f;

        RunSession S => GameManager.I.Session;

        public void ResetSystem()
        {
            _bankVelX = 0f; _yawSmooth = 0f; _pitchSmooth = 0f;
            _prevSpeed = Tuning.BaseSpeed; _bobBlend = 1f; _bobSteerBlend = 1f;
            if (ShipRoot != null)
            {
                ShipRoot.position = new Vector3(0f, Tuning.ShipPreLaunchY, Tuning.ShipZ);
                ShipRoot.rotation = Quaternion.Euler(Tuning.ShipRotXOffset * Mathf.Rad2Deg, 0f, 0f);
                ShipRoot.gameObject.SetActive(true);
            }
        }

        public void SimTick(float dt)
        {
            var s = S;
            bool steerL = Input.SteerLeft, steerR = Input.SteerRight;

            // ── Tilt (knife-edge) penalty — §1.5 ─────────────────────────
            if (Mathf.Abs(s.RollAngle) > 0.1f) s.TiltTimer = Mathf.Min(s.TiltTimer + dt, Tuning.TiltGrace + 1f);
            else                               s.TiltTimer = Mathf.Max(0f, s.TiltTimer - dt * 3f);
            float penaltyT   = Mathf.Clamp01(s.TiltTimer - Tuning.TiltGrace);
            float tiltPenalty = 0.35f + 0.65f * Mathf.Cos(s.RollAngle);
            float tiltFactor  = 1f - penaltyT * (1f - tiltPenalty);

            // ── Lateral integration — §1.3/§1.4 ──────────────────────────
            // NOTE: signs flipped vs the JS spec. three.js is right-handed, Unity is
            // left-handed; with the camera facing −Z, world +X is SCREEN-LEFT here.
            // Steer-left therefore adds +velX. Bank/yaw derive from velX so they
            // stay self-consistent.
            float ACCEL = Tuning.Accel, DECEL = Tuning.Decel, MAX_VEL = Tuning.MaxVel;
            bool counterSteer = (steerL && s.ShipVelX < 0f) || (steerR && s.ShipVelX > 0f);
            float csBoost = counterSteer ? Tuning.CounterSteerBoost : 1f;

            if (steerL)      s.ShipVelX += ACCEL * csBoost * tiltFactor * dt;
            else if (steerR) s.ShipVelX -= ACCEL * csBoost * tiltFactor * dt;
            else             s.ShipVelX *= Mathf.Max(0f, 1f - DECEL * dt);   // long glide

            s.ShipVelX = Mathf.Clamp(s.ShipVelX, -MAX_VEL * tiltFactor, MAX_VEL * tiltFactor);
            if (!s.IntroActive) s.ShipX += s.ShipVelX * dt;

            // ── Knife-edge roll — §1.6 hold-to-spin ──────────────────────
            s.RollHeld = Input.RollHeld;
            if (Input.RollHeld) s.RollDir = Input.RollDir;
            float spin = Tuning.SpinSpeed;
            if (s.RollHeld && s.RollDir != 0)
                s.RollAngle = Mathf.Clamp(s.RollAngle + s.RollDir * spin * dt, -Tuning.RollMaxAngle, Tuning.RollMaxAngle);
            else if (s.RollAngle != 0f)
            {
                float ret = spin * Tuning.RollReturnMult * dt;
                s.RollAngle = Mathf.Abs(s.RollAngle) <= ret ? 0f : s.RollAngle - Mathf.Sign(s.RollAngle) * ret;
            }

            // ── Banking (visual) — §1.6 ──────────────────────────────────
            bool steering = steerL || steerR;
            if (steering)
            {
                bool opposes = (steerL && _bankVelX < 0f) || (steerR && _bankVelX > 0f);
                if (opposes) _bankVelX = 0f;                                  // never dip wrong way
                _bankVelX += (s.ShipVelX - _bankVelX) * Mathf.Min(1f, 20f * dt);
            }
            else _bankVelX *= Mathf.Max(0f, 1f - Tuning.BankReturnRate * dt);

            float velNorm    = Mathf.Clamp(_bankVelX / (MAX_VEL * tiltFactor), -1f, 1f);
            float targetRoll = -velNorm * Tuning.SteerBankRadMax;
            bool crossingZero = Mathf.Sign(targetRoll) != Mathf.Sign(s.BankRoll) && Mathf.Abs(s.BankRoll) > 0.001f;
            float lerpSpeed  = Tuning.BankSmoothing * (crossingZero ? Tuning.BankZeroCrossMult : 1f);
            s.BankRoll = Mathf.Lerp(s.BankRoll, targetRoll, Mathf.Min(1f, lerpSpeed * dt));
            s.BankRoll = Mathf.Clamp(s.BankRoll, -Tuning.SteerBankRadMax * 1.15f, Tuning.SteerBankRadMax * 1.15f);

            // ── Yaw / pitch — §1.7 ───────────────────────────────────────
            float yawTarget = -s.ShipVelX / 14f * Tuning.YawMax;
            _yawSmooth += (yawTarget - _yawSmooth) * Mathf.Min(1f, dt * Tuning.YawSmoothing);

            float speedDelta = (s.Speed - _prevSpeed) / dt;
            _prevSpeed = s.Speed;
            float targetPitch = speedDelta > 0.5f  ? -Tuning.PitchForwardMax * Mathf.Min(1f, speedDelta / 50f)
                              : speedDelta < -0.5f ?  Tuning.PitchBackMax    * Mathf.Min(1f, -speedDelta / 50f)
                              : 0f;
            _pitchSmooth += (targetPitch - _pitchSmooth) * Mathf.Min(1f, dt * Tuning.PitchSmoothing);

            // ── Vertical: intro lift then hover bob — §1.8 ───────────────
            if (s.IntroLiftActive)
            {
                s.IntroLiftT += dt;
                float t = Mathf.Clamp01(s.IntroLiftT / Tuning.IntroLiftDur);
                float ease = 1f - Mathf.Pow(1f - t, 3f);
                s.ShipY = Mathf.Lerp(Tuning.ShipPreLaunchY, Tuning.ShipHoverY, ease);
                _pitchSmooth = Tuning.IntroLiftPitch * Mathf.Sin(t * Mathf.PI * 0.5f) * (1f - t) * 2f;
                if (t >= 1f) { s.IntroLiftActive = false; s.ShipY = Tuning.ShipHoverY; }
            }
            else
            {
                float steerAbs = Mathf.Abs(s.ShipVelX);
                float target = steerAbs > 0.5f ? 0f : 1f;
                float rate = target < _bobSteerBlend ? 4f : 2f;
                _bobSteerBlend = Mathf.MoveTowards(_bobSteerBlend, target, rate * dt);
                s.ShipY = Tuning.ShipHoverY +
                          Mathf.Sin(s.Elapsed * Tuning.BobFrequency * 2f * Mathf.PI)
                          * Tuning.BobAmplitude * _bobBlend * _bobSteerBlend;
            }

            // ── Apply transform ──────────────────────────────────────────
            if (ShipRoot != null)
            {
                ShipRoot.position = new Vector3(s.ShipX, s.ShipY, Tuning.ShipZ);
                // While knife-edge rolling, roll drives rotation directly; else bank does.
                float rollZ = Mathf.Abs(s.RollAngle) > 0.001f ? s.RollAngle : s.BankRoll;
                ShipRoot.localRotation = Quaternion.Euler(
                    (_pitchSmooth + Tuning.ShipRotXOffset) * Mathf.Rad2Deg,
                    _yawSmooth * Mathf.Rad2Deg,
                    rollZ * Mathf.Rad2Deg);
            }
        }

        /// <summary>Roll-aware collision half-width — hitbox narrows 1.5 → 0.8 at knife-edge.</summary>
        public float CollisionHalfX
        {
            get
            {
                float rollFrac = Mathf.Min(Mathf.Abs(S.RollAngle) / (Mathf.PI / 2f), 1f);
                return Tuning.WingHalf * (1f - rollFrac) + Tuning.BodyHalf * rollFrac;
            }
        }
    }
}
