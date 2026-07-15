using UnityEngine;

namespace JetHorizon
{
    /// <summary>Single read-only interpretation of core motion for every Unity presentation system.</summary>
    public sealed class ShipFeelPresenter : MonoBehaviour
    {
        public static ShipFeelPresenter I { get; private set; }
        public JetHorizonFeelProfile Profile;
        public ShipFeelSignals Signals { get; private set; }
        public float CameraImpulse { get; private set; }

        float _speed, _steer, _bank;

        void Awake() => I = this;
        void OnDestroy() { if (I == this) I = null; }

        public void Initialize(JetHorizonFeelProfile profile) => Profile = profile;

        void Update()
        {
            if (GameManager.I == null || Profile == null) return;
            RunSession session = GameManager.I.Session;
            float dt = Mathf.Min(Time.unscaledDeltaTime, Tuning.MaxRawDt);
            float startSpeed = Profile.SpeedPresentationStart > 0f ? Profile.SpeedPresentationStart : 50f;
            float fullSpeed = Profile.SpeedPresentationFull > startSpeed ? Profile.SpeedPresentationFull : 100f;
            float starterPresentation = Profile.StarterSpeedPresentation > 0f
                ? Mathf.Clamp01(Profile.StarterSpeedPresentation)
                : 0.35f;
            float rawSpeed = Mathf.InverseLerp(startSpeed, fullSpeed, session.EffectiveSpeed);
            float rawLateral = Mathf.Clamp(session.ShipVelX / Mathf.Max(.01f, Profile.MaximumLateralVelocity), -1f, 1f);
            float rawBank = Mathf.Clamp(session.BankRoll / Mathf.Max(.01f, Profile.BankMaximumRadians), -1f, 1f);
            _speed = Exp(_speed, rawSpeed, 7f, dt);
            _steer = Exp(_steer, rawLateral, 12f, dt);
            _bank = Exp(_bank, rawBank, 10f, dt);
            float presentationCurve = Profile.IntensityBySpeed != null
                ? Profile.IntensityBySpeed.Evaluate(_speed)
                : _speed;
            float presentation = Mathf.Lerp(starterPresentation, 1f, presentationCurve);
            float overdrive = session.OverdriveActive ? 1f : 0f;
            Signals = new ShipFeelSignals(_speed, presentation, _steer, rawLateral, _bank, overdrive, rawLateral - rawBank);
            CameraImpulse = Mathf.MoveTowards(CameraImpulse, 0f, Profile.ImpulseRecovery * dt);
        }

        public void AddImpulse(float amount) => CameraImpulse = Mathf.Max(CameraImpulse, Mathf.Max(0f, amount));
        static float Exp(float current, float target, float response, float dt) => Mathf.Lerp(current, target, 1f - Mathf.Exp(-response * dt));
    }
}
