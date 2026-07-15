using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Ship water wake (spec/03 §5c): ring ripples spawned every 0.07 s under the ship
    /// (life 0.20 s, grow + fade, ellipse-skewed by lateral velocity) + a V-wake chevron
    /// (two thin additive quads, tip at ship, spread ±8 at 20 u behind, opacity ∝ speed).
    /// </summary>
    public sealed class ShipWakeFX : MonoBehaviour
    {
        public Material RingMaterial;   // JH/Additive + ring sprite
        public Material WakeMaterial;   // JH/Additive plain

        const int RingPool = 24;
        const float SpawnInterval = 0.07f;
        const float RingLife = 0.20f;

        sealed class Ring
        {
            public Transform T; public MeshRenderer R; public MaterialPropertyBlock Mpb;
            public float Life; public bool Active; public float SkewX;
        }

        Ring[] _rings;
        Transform _vwakeL, _vwakeR;
        MeshRenderer _vwakeLR, _vwakeRR;
        MaterialPropertyBlock _vMpb;
        float _spawnTimer;
        static readonly int TintId = Shader.PropertyToID("_Tint");

        void Start()
        {
            _rings = new Ring[RingPool];
            for (int i = 0; i < RingPool; i++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
                Destroy(go.GetComponent<Collider>());
                go.name = "wakeRing";
                go.transform.SetParent(transform, false);
                go.transform.rotation = Quaternion.Euler(90f, 0f, 0f);   // flat on water
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = RingMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                go.SetActive(false);
                _rings[i] = new Ring { T = go.transform, R = mr, Mpb = new MaterialPropertyBlock() };
            }

            // V-wake chevron: two thin quads angled outward behind the ship
            _vMpb = new MaterialPropertyBlock();
            _vwakeL = MakeVWakeArm(-1, out _vwakeLR);
            _vwakeR = MakeVWakeArm(+1, out _vwakeRR);
        }

        Transform MakeVWakeArm(int side, out MeshRenderer mr)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(go.GetComponent<Collider>());
            go.name = "vwake";
            go.transform.SetParent(transform, false);
            mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = WakeMaterial;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            // arm from tip (ship) to (±8, 20 behind): length ~21.5, yaw ±21.8°
            float len = Mathf.Sqrt(8f * 8f + 20f * 20f);
            go.transform.localScale = new Vector3(0.55f, len, 1f);
            go.transform.rotation = Quaternion.Euler(90f, side * -21.8f, 0f);
            return go.transform;
        }

        void Update()
        {
            if (GameManager.I == null) return;
            var s = GameManager.I.Session;
            bool on = GameManager.I.Phase == GamePhase.Playing && !s.IntroLiftActive;
            float rawDt = Mathf.Min(Time.deltaTime, Tuning.MaxRawDt);
            float speedFrac = ShipFeelPresenter.I != null ? ShipFeelPresenter.I.Signals.SpeedPresentation : Mathf.Clamp01(s.EffectiveSpeed / (Tuning.BaseSpeed * 2.5f));

            // ── V-wake follows ship X, opacity with speed ──
            bool vOn = on;
            _vwakeL.gameObject.SetActive(vOn);
            _vwakeR.gameObject.SetActive(vOn);
            if (vOn)
            {
                float halfLen = Mathf.Sqrt(8f * 8f + 20f * 20f) * 0.5f;
                // position arm centers so the tips meet at the ship
                _vwakeL.position = new Vector3(s.ShipX - 8f * 0.5f, 0.03f, Tuning.ShipZ + 20f * 0.5f);
                _vwakeR.position = new Vector3(s.ShipX + 8f * 0.5f, 0.03f, Tuning.ShipZ + 20f * 0.5f);
                Color c = new Color(1f, 1f, 1f, 0.10f + 0.22f * speedFrac);
                _vMpb.SetColor(TintId, c);
                _vwakeLR.SetPropertyBlock(_vMpb);
                _vwakeRR.SetPropertyBlock(_vMpb);
            }

            // ── ring ripples ──
            if (on)
            {
                _spawnTimer -= rawDt;
                if (_spawnTimer <= 0f)
                {
                    _spawnTimer = SpawnInterval;
                    SpawnRing(s);
                }
            }

            foreach (var r in _rings)
            {
                if (!r.Active) continue;
                r.Life += rawDt;
                float t = r.Life / RingLife;
                if (t >= 1f) { r.Active = false; r.T.gameObject.SetActive(false); continue; }
                float grow = Mathf.Lerp(0.5f, 2.6f, t);
                r.T.localScale = new Vector3(grow * (1f + r.SkewX), grow, 1f);
                // rings also drift back with the world
                var p = r.T.position;
                p.z += s.EffectiveSpeed * rawDt * 0.35f;
                r.T.position = p;
                Color c = new Color(1f, 1f, 1f, 0.45f * (1f - t));
                r.Mpb.SetColor(TintId, c);
                r.R.SetPropertyBlock(r.Mpb);
            }
        }

        void SpawnRing(RunSession s)
        {
            foreach (var r in _rings)
            {
                if (r.Active) continue;
                r.Active = true;
                r.Life = 0f;
                r.SkewX = Mathf.Min(1f, Mathf.Abs(s.ShipVelX) / 16f);   // ellipse skew with lateral vel
                r.T.position = new Vector3(s.ShipX + (Random.value - 0.5f) * 0.3f, 0.025f, Tuning.ShipZ + 0.6f);
                r.T.gameObject.SetActive(true);
                return;
            }
        }
    }
}
