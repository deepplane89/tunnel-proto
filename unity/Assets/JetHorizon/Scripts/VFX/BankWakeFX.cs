using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Bank-water wake (spec/03 §6): a noise-dissolved strip at the bank-DOWN rear
    /// wingtip when banking ≥ ~24° at speed. Intensity attack 10/s, release 4/s.
    /// </summary>
    public sealed class BankWakeFX : MonoBehaviour
    {
        public Material WakeMaterial;    // JH/BankWake
        public Transform ShipRoot;

        const float BandLength = 4.5f, BandLengthSpeedBonus = 2.0f;
        const float BandWidth = 0.14f * 8f;    // JS width is in ship-local units pre-scale; tuned for 0.30 ship scale
        const float PeakOpacity = 0.65f;
        const float WingX = 1.55f;             // rear wingtip offset (ship-scaled)

        Transform _strip;
        Material _mat;
        float _intensity;

        void Start()
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(go.GetComponent<Collider>());
            go.name = "BankWake";
            go.transform.SetParent(transform, false);
            _mat = new Material(WakeMaterial);
            _mat.SetTexture("_Noise", TextureFactory.WakeNoise());
            var mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = _mat;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            _strip = go.transform;
            _strip.gameObject.SetActive(false);
        }

        void Update()
        {
            if (GameManager.I == null || _strip == null) return;
            var s = GameManager.I.Session;
            float rawDt = Mathf.Min(Time.deltaTime, Tuning.MaxRawDt);

            float roll = Mathf.Abs(s.BankRoll);
            float speedFrac = ShipFeelPresenter.I != null ? ShipFeelPresenter.I.Signals.SpeedPresentation : Mathf.Clamp01(s.EffectiveSpeed / (Tuning.BaseSpeed * 2.5f));
            float target = GameManager.I.Phase == GamePhase.Playing
                ? Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.42f, 0.52f, roll)) * speedFrac
                : 0f;

            float rate = target > _intensity ? 10f : 4f;
            _intensity = Mathf.MoveTowards(_intensity, target, rate * rawDt);

            if (_intensity < 0.01f) { _strip.gameObject.SetActive(false); return; }
            _strip.gameObject.SetActive(true);

            // bank-DOWN side only
            float side = Mathf.Sign(-s.BankRoll);
            float len = BandLength + BandLengthSpeedBonus * speedFrac;
            _strip.position = new Vector3(
                s.ShipX + side * (WingX + 0.10f),
                0.005f,
                Tuning.ShipZ + 1.4f + len * 0.30f);   // head at wingtip, tail behind
            _strip.rotation = Quaternion.Euler(90f, 180f, 0f);   // flat on water, V toward +Z
            _strip.localScale = new Vector3(BandWidth, len, 1f);

            _mat.SetFloat("_Opacity", PeakOpacity * _intensity);
            _mat.SetFloat("_Intensity", _intensity);
            _mat.SetFloat("_Scroll", 6f * (0.4f + 0.6f * _intensity));
        }
    }
}
