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
        float _cameraRollHold;
        float _shakeTime;
        Vector3 _lastShakeOffset;

        // Death orbit
        bool _deathOrbit; Vector3 _crashPos, _deathAnchor; float _deathT;
        // Retry sweep
        bool _sweeping; float _sweepT;
        float _launchTime;
        float _lookAheadX;

        RunSession S => GameManager.I.Session;

        static Vector3 BasePivot(float shipX) =>
            new Vector3(shipX, Tuning.CamBaseY + Tuning.CamPivotYOffset, Tuning.CamPivotZ);

        public void ResetSystem()
        {
            _deathOrbit = false; _sweeping = false; _shakeTime = 0f; _cameraRoll = 0f; _cameraRollHold = 0f;
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
            _launchTime = S.Elapsed;
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
            var feel = GameManager.I.FeelProfile;
            var signals = ShipFeelPresenter.I != null ? ShipFeelPresenter.I.Signals : default;
            float lookAhead = feel != null ? signals.Lateral01 * feel.CameraLookAhead : 0f;
            _lookAheadX = Mathf.Lerp(_lookAheadX, lookAhead, 1f - Mathf.Exp(-(feel != null ? feel.CameraFollowResponse : 18f) * dt));
            p.x = Mathf.Lerp(p.x, s.ShipX + _lookAheadX, 1f - Mathf.Exp(-(feel != null ? feel.CameraFollowResponse : 18f) * dt));
            float shipAlt = s.ShipY - Tuning.ShipHoverY;
            float targetY = Tuning.CamBaseY + Tuning.CamPivotYOffset + shipAlt * Tuning.CamYFollow;
            p.y = Mathf.Lerp(p.y, targetY, Mathf.Min(1f, Tuning.CamYLerp * dt));
            p.z = Tuning.CamPivotZ;
            transform.position = p;

            // Keep the horizon stable for ordinary corrections. It only leans after
            // the ship has sustained a strong lateral move, and never follows the
            // explicit knife-edge roll. This preserves speed/readability while still
            // giving committed strafes a small cinematic response.
            float lateral = Mathf.Abs(signals.Lateral01);
            float activation = feel != null && feel.CameraRollActivation > 0f
                ? feel.CameraRollActivation
                : 0.52f;
            float holdSeconds = feel != null && feel.CameraRollHoldSeconds > 0f
                ? feel.CameraRollHoldSeconds
                : 0.22f;
            if (lateral > activation) _cameraRollHold = Mathf.Min(holdSeconds, _cameraRollHold + dt);
            else _cameraRollHold = Mathf.Max(0f, _cameraRollHold - dt * 2.5f);
            float strength = Mathf.InverseLerp(activation, 1f, lateral);
            float power = feel != null && feel.CameraRollPower > 0f ? feel.CameraRollPower : 1.6f;
            strength = Mathf.Pow(strength, power) * Mathf.SmoothStep(0f, 1f, _cameraRollHold / holdSeconds);
            float maximumDegrees = feel != null && feel.CameraRollMaximumDegrees > 0f
                ? feel.CameraRollMaximumDegrees
                : 2.5f;
            float targetRoll = Mathf.Abs(s.RollAngle) > 0.001f
                ? 0f
                : Mathf.Sign(s.BankRoll) * maximumDegrees * Mathf.Deg2Rad * strength;
            _cameraRoll = Mathf.Lerp(_cameraRoll, targetRoll, 1f - Mathf.Exp(-(feel != null ? feel.CameraRollResponse : 9f) * dt));
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
                float speedFrac = ShipFeelPresenter.I != null
                    ? ShipFeelPresenter.I.Signals.SpeedPresentation
                    : Mathf.Clamp01((s.EffectiveSpeed - Tuning.BaseSpeed) / (Tuning.BaseSpeed * 1.5f));
                var feel = GameManager.I.FeelProfile;
                float fovCurve = feel != null && feel.FovBySpeed != null
                    ? feel.FovBySpeed.Evaluate(speedFrac)
                    : speedFrac;
                float targetFOV = feel != null
                    ? feel.BaseFov + feel.SpeedFovBoost * fovCurve + (s.OverdriveActive ? feel.OverdriveFovBoost : 0f)
                    : Tuning.CamBaseFovDesktop + Tuning.FovSpeedBoost * Mathf.Pow(speedFrac, Tuning.FovKickExponent);
                bool launch = s.Elapsed - _launchTime < 0.5f;
                float rate = launch ? 12f : (Mathf.Abs(targetFOV - Cam.fieldOfView) > 0.5f ? 5f : 3f);
                if (feel != null) rate = feel.FovResponse;
                Cam.fieldOfView = Mathf.Lerp(Cam.fieldOfView, targetFOV, 1f - Mathf.Exp(-rate * rawDt));

                // Constant, tiny engine vibration keeps starter cruise alive without
                // competing with authored lightning and collision impulses.
                float vibration = feel != null && feel.CameraSpeedVibration > 0f
                    ? feel.CameraSpeedVibration
                    : 0.018f;
                float vibrationAmount = vibration * speedFrac;
                Vector3 speedOffset = new Vector3(
                    Mathf.Sin(Time.unscaledTime * 37f) * vibrationAmount,
                    Mathf.Sin(Time.unscaledTime * 53f + 1.7f) * vibrationAmount * 0.55f,
                    0f);
                _lastShakeOffset += speedOffset;
                Cam.transform.position += speedOffset;

                // Lightning shake — §3.5
                if (_shakeTime > 0f)
                {
                    _shakeTime -= rawDt;
                    float amp = Tuning.ShakeAmt * Mathf.Max(0f, _shakeTime / Tuning.ShakeDur);
                    Vector3 lightningOffset = new Vector3((Random.value - 0.5f) * amp, (Random.value - 0.5f) * amp * 0.4f, 0f);
                    _lastShakeOffset += lightningOffset;
                    Cam.transform.position += lightningOffset;
                }
                if (ShipFeelPresenter.I != null && ShipFeelPresenter.I.CameraImpulse > 0f)
                {
                    float amp = ShipFeelPresenter.I.CameraImpulse;
                    Vector3 impulseOffset = new Vector3((Random.value - .5f) * amp, (Random.value - .5f) * amp * .45f, 0f);
                    _lastShakeOffset += impulseOffset;
                    Cam.transform.position += impulseOffset;
                }
            }
        }
    }
}
