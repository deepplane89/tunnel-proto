using UnityEngine;

namespace JetHorizon
{
    [CreateAssetMenu(menuName = "Jet Horizon/Feel Profile", fileName = "JetHorizonFeel")]
    public sealed class JetHorizonFeelProfile : ScriptableObject
    {
        [Header("Engine-neutral handling — Three.js baseline")]
        public float Snap = 0.5625f;
        public float AccelBase = 22f;
        public float AccelSnap = 52f;
        [Range(0f, 1f)] public float HandlingDrift = 0.86f;
        public float MaxVelocityBase = 9f;
        public float MaxVelocitySnap = 13f;
        public float DecelerationBasePercent = 0.02f;
        public float DecelerationFullPercent = 0.05f;
        public float CounterSteerBoost = 3.15f;
        public float BankMaximumRadians = 0.52f;
        public float BankSmoothing = 7.2f;
        public float BankReturnRate = 9.5f;
        public float BankZeroCrossMultiplier = 2.7f;

        [Header("Ship presentation")]
        [Tooltip("Unity camera faces -Z, so the source yaw needs this explicit presentation sign.")]
        public float VisualYawSign = -1f;
        public float VisualYawRadians = 0.055f;
        [Range(0f, 1f)] public float VisualYawWeight = 0.40f;
        public float VisualYawResponse = 10f;
        public float VisualBankScale = 1f;
        public float TurnLiftHeight = 0.08f;
        public float TurnLiftResponse = 6f;
        public float ModelLateralLag = 0.08f;
        public float ModelSwayDistance = 0.10f;
        public float ModelSwayYawDegrees = 2.8f;
        public float ModelSwayRollDegrees = 4.5f;
        public float ModelPitchDegrees = 1.6f;
        public float ModelRotationResponse = 7.5f;
        public float TurbulencePosition = 0.012f;
        public float TurbulenceRotationDegrees = 0.35f;

        [Header("Layered camera")]
        public float CameraFollowResponse = 14f;
        public float CameraLookAhead = 0.65f;
        public float CameraLateralLag = 0.22f;
        public float CameraSpeedPullback = 1.8f;
        public float CameraSpeedHeightDrop = 0.65f;
        public float CameraSpeedLookAhead = 5f;
        public float CameraRollResponse = 9f;
        [Range(0f, 0.95f)] public float CameraRollActivation = 0.52f;
        public float CameraRollHoldSeconds = 0.22f;
        public float CameraRollPower = 1.6f;
        public float CameraRollMaximumDegrees = 2.5f;
        public float CameraHeightResponse = 6f;
        public float BaseFov = 76f;
        public float SpeedFovBoost = 22f;
        public float MaximumFov = 100f;
        public float OverdriveFovBoost = 8f;
        public float FovResponse = 5f;
        public AnimationCurve FovBySpeed = AnimationCurve.EaseInOut(0f, 0f, 1f, 1f);

        [Header("Shared speed perception")]
        [Range(0f, 1f)] public float StarterSpeedPresentation = 0.20f;
        public float SpeedPresentationStart = 36f;
        public float SpeedPresentationFull = 160f;
        public float CameraSpeedVibration = 0.018f;
        public AnimationCurve IntensityBySpeed = AnimationCurve.EaseInOut(0f, 0f, 1f, 1f);
        public float ThrusterMinimum = 0.45f;
        public float ThrusterMaximum = 1.35f;
        public float StarStreakMinimum = 0.10f;
        public float StarStreakMaximum = 1f;
        public float WakeMinimum = 0.25f;
        public float WakeMaximum = 1.25f;
        public float FogSpeedCompression = 0.0012f;
        public float OverdriveExposurePulse = 0.2f;

        [Header("Gate crossing feedback")]
        [Range(0f, 1f)] public float CommonGateStrength = 0.24f;
        [Range(0f, 1f)] public float SurgeGateStrength = 0.65f;
        [Range(0f, 1f)] public float TransitionGateStrength = 1f;
        public float GateKickRecovery = 5f;
        public float GateFovKickDegrees = 4.5f;
        public float GateFovResponse = 18f;
        public float GateCameraPullback = 0.65f;
        public float GateThrusterBurst = 0.70f;
        public float GateWakeBurst = 0.65f;
        public float GateSurfaceCueBurst = 0.75f;

        [Header("Impact feedback")]
        public float NearMissImpulse = 0.08f;
        public float PickupImpulse = 0.025f;
        public float ShieldHitImpulse = 0.12f;
        public float LightningImpulse = 0.18f;
        public float DeathImpulse = 0.32f;
        public float ImpulseRecovery = 8f;

        public float Acceleration => (AccelBase + Snap * AccelSnap) * (0.75f + (1f - HandlingDrift) * 0.25f);
        public float Deceleration => (10f + Snap * 26f) * (DecelerationBasePercent + (1f - HandlingDrift) * (DecelerationFullPercent - DecelerationBasePercent));
        public float MaximumLateralVelocity => MaxVelocityBase + Snap * MaxVelocitySnap;
    }

    public readonly struct ShipFeelSignals
    {
        public readonly float Speed01, SpeedPresentation, Steering01, Lateral01, Bank01, Overdrive01, Slip01, GateKick01;
        public ShipFeelSignals(float speed01, float speedPresentation, float steering01, float lateral01, float bank01, float overdrive01, float slip01, float gateKick01)
        {
            Speed01 = speed01;
            SpeedPresentation = speedPresentation;
            Steering01 = steering01;
            Lateral01 = lateral01;
            Bank01 = bank01;
            Overdrive01 = overdrive01;
            Slip01 = slip01;
            GateKick01 = gateKick01;
        }
    }
}
