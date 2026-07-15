using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Physically-inspired secondary motion for the imported model. The deterministic
    /// ship root and collision never move; model, sockets and exhaust inherit this spring.
    /// </summary>
    public sealed class ShipOrganicMotion : MonoBehaviour
    {
        public Transform VisualModel;
        Vector3 _basePosition, _positionVelocity;
        Quaternion _baseRotation;
        float _noiseSeed;

        void Start() { _noiseSeed = Random.Range(0f, 1000f); ResolveModel(); }

        void ResolveModel()
        {
            if (VisualModel == null) VisualModel = transform.Find("ShipModel");
            if (VisualModel == null) return;
            _basePosition = VisualModel.localPosition;
            _baseRotation = VisualModel.localRotation;
        }

        void LateUpdate()
        {
            if (VisualModel == null) { ResolveModel(); if (VisualModel == null) return; }
            if (GameManager.I == null || ShipFeelPresenter.I == null || GameManager.I.FeelProfile == null) return;
            JetHorizonFeelProfile profile = GameManager.I.FeelProfile;
            ShipFeelSignals signals = ShipFeelPresenter.I.Signals;
            float dt = Mathf.Min(Time.unscaledDeltaTime, Tuning.MaxRawDt);
            float time = GameManager.I.Session.Elapsed;
            float noiseX = (Mathf.PerlinNoise(_noiseSeed, time * 1.7f) - .5f) * 2f;
            float noiseY = (Mathf.PerlinNoise(_noiseSeed + 17f, time * 1.3f) - .5f) * 2f;
            float active = GameManager.I.Phase == GamePhase.Playing ? 1f : 0f;

            Vector3 targetPosition = _basePosition + new Vector3(
                -signals.Slip01 * profile.ModelSwayDistance,
                noiseY * profile.TurbulencePosition * active,
                Mathf.Abs(signals.Steering01) * profile.ModelSwayDistance * .18f);
            VisualModel.localPosition = Vector3.SmoothDamp(
                VisualModel.localPosition, targetPosition, ref _positionVelocity,
                Mathf.Max(.02f, profile.ModelLateralLag), Mathf.Infinity, dt);

            Quaternion secondary = Quaternion.Euler(
                -Mathf.Abs(signals.Steering01) * profile.ModelPitchDegrees + noiseY * profile.TurbulenceRotationDegrees * active,
                -signals.Slip01 * profile.ModelSwayYawDegrees,
                -signals.Steering01 * profile.ModelSwayRollDegrees + noiseX * profile.TurbulenceRotationDegrees * active);
            Quaternion targetRotation = _baseRotation * secondary;
            VisualModel.localRotation = Quaternion.Slerp(
                VisualModel.localRotation, targetRotation,
                1f - Mathf.Exp(-profile.ModelRotationResponse * dt));
        }
    }
}
