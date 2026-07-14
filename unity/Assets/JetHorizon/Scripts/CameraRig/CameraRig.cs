using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Pivot-based rig, spec/01 §3: instant lateral follow, lerped Y, FOV speed kick
    /// (variable-rate), death orbit, retry establishing sweep, lightning shake.
    /// </summary>
    public sealed class CameraRig : MonoBehaviour, ISimSystem
    {
        public UnityEngine.Camera Cam;      // child of this pivot at local (0,0,0)

        float _cameraRoll;
        float _shakeTime;
        Vector3 _lastShakeOffset;

        // Death orbit
        bool _deathOrbit; Vector3 _crashPos, _deathAnchor; float _deathT;
        // Retry sweep
        bool _sweeping; float _sweepT;
        float _launchTime;

        RunSession S => GameManager.I.Session;

        static Vector3 BasePivot(float shipX) =>
            new Vector3(shipX, Tuning.CamBaseY + Tuning.CamPivotYOffset, Tuning.CamPivotZ);

        public void ResetSystem()
        {
            _deathOrbit = false; _sweeping = false; _shakeTime = 0f; _cameraRoll = 0f;
            _lastShakeOffset = Vector3.zero;
            transform.position = BasePivot(0f);
            if (Cam != null)
            {
                Cam.transform.localPosition = Vector3.zero;
                Cam.fieldOfView = Tuning.CamBaseFovDesktop;
                AimAtLook();
            }
        }

        public void OnRunStart(bool skipIntro)
        {
            _launchTime = Time.time;
            if (Cam != null) Cam.fieldOfView = Tuning.CamBaseFovDesktop + 15f;  // launch snap-in
        }

        public void PlayRetrySweep() { _sweeping = true; _sweepT = 0f; }

        public void OnPlayerDied(Vector3 crashPos)
        {
            _deathOrbit = true; _deathT = 0f; _crashPos = crashPos;
            _deathAnchor = transform.position;
        }

        public void ResetToTitle() => ResetSystem();

        public void Shake() => _shakeTime = Tuning.ShakeDur;

        // Fixed-step: pivot follow
        public void SimTick(float dt)
        {
            if (_deathOrbit) return;
            var s = S;

            if (_sweeping)
            {
                _sweepT += dt;
                float t = Mathf.Clamp01(_sweepT / Tuning.RetrySweepDur);
                float e = t < 0.5f ? 4f * t * t * t : 1f - Mathf.Pow(-2f * t + 2f, 3f) / 2f;
                Vector3 target = BasePivot(s.ShipX);
                transform.position = Vector3.Lerp(Tuning.RetryCamStart, target, e);
                if (Cam != null) Cam.fieldOfView = Mathf.Lerp(Tuning.RetryFovStart, Tuning.CamBaseFovDesktop, e);
                if (t >= 1f) _sweeping = false;
                AimAtLook();
                return;
            }

            Vector3 p = transform.position;
            p.x = s.ShipX;                                          // no lateral lag
            float shipAlt = s.ShipY - Tuning.ShipHoverY;
            float targetY = Tuning.CamBaseY + Tuning.CamPivotYOffset + shipAlt * Tuning.CamYFollow;
            p.y = Mathf.Lerp(p.y, targetY, Mathf.Min(1f, Tuning.CamYLerp * dt));
            p.z = Tuning.CamPivotZ;
            transform.position = p;

            // Horizon tilts with steering bank only (NOT knife-edge roll)
            _cameraRoll = Mathf.Abs(s.RollAngle) > 0.001f ? 0f : s.BankRoll * Tuning.CamRollAmt;
            AimAtLook();
        }

        void AimAtLook()
        {
            if (Cam == null) return;
            Vector3 lookWorld = transform.position + Tuning.CamLookLocal;
            Cam.transform.position = transform.position;
            Cam.transform.LookAt(lookWorld);
            Cam.transform.Rotate(0f, 0f, _cameraRoll * Mathf.Rad2Deg, Space.Self);
        }

        // Variable-rate: FOV kick, death orbit, shake
        void LateUpdate()
        {
            if (GameManager.I == null || Cam == null) return;
            float rawDt = Mathf.Min(Time.deltaTime, Tuning.MaxRawDt);
            var phase = GameManager.I.Phase;
            var s = S;

            // undo last frame's shake offset
            Cam.transform.position -= _lastShakeOffset;
            _lastShakeOffset = Vector3.zero;

            if (phase == GamePhase.Dead && _deathOrbit)
            {
                _deathT += Tuning.DeathOrbitRate * rawDt;
                float e = 1f - Mathf.Pow(1f - Mathf.Clamp01(_deathT), 3f);
                Vector3 target = _deathAnchor + new Vector3(
                    (_crashPos.x < _deathAnchor.x ? 1.5f : -1.5f) * e,
                    Tuning.DeathCamRise * e,
                    Tuning.DeathCamPullback * e);
                transform.position = target;
                Cam.transform.position = target;
                Cam.transform.LookAt(new Vector3(_crashPos.x, _crashPos.y, _crashPos.z - 2f));
                Cam.fieldOfView = Mathf.Lerp(Cam.fieldOfView, Tuning.CamBaseFovDesktop + 15f, 0.8f * rawDt);
                return;
            }

            if (phase == GamePhase.Playing && !_sweeping)
            {
                // FOV speed kick — spec/01 §3.2
                float frac = Mathf.Clamp01((s.EffectiveSpeed - Tuning.BaseSpeed) / (Tuning.BaseSpeed * 1.5f));
                float speedFrac = Mathf.Pow(frac, Tuning.FovKickExponent);
                float targetFOV = Tuning.CamBaseFovDesktop + Tuning.FovSpeedBoost * speedFrac;
                bool launch = Time.time - _launchTime < 0.5f;
                float rate = launch ? 12f : (Mathf.Abs(targetFOV - Cam.fieldOfView) > 0.5f ? 5f : 3f);
                Cam.fieldOfView = Mathf.Lerp(Cam.fieldOfView, targetFOV, rate * rawDt);

                // Lightning shake — §3.5
                if (_shakeTime > 0f)
                {
                    _shakeTime -= rawDt;
                    float amp = Tuning.ShakeAmt * Mathf.Max(0f, _shakeTime / Tuning.ShakeDur);
                    _lastShakeOffset = new Vector3((Random.value - 0.5f) * amp, (Random.value - 0.5f) * amp * 0.4f, 0f);
                    Cam.transform.position += _lastShakeOffset;
                }
            }
        }
    }
}
