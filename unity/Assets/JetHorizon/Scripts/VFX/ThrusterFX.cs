using UnityEngine;
using JetHorizon.Simulation;

namespace JetHorizon
{
    /// <summary>
    /// Thruster exhaust. Default = the shipping "LIGHT" preset (spec/03 §9): a subtle
    /// particle stream + small pulsing nozzle-bloom sprite per nozzle (scale 0.80,
    /// bloom scale ~0.10 opacity 0.43 pulse 0.15, short particle life ~0.20 s).
    /// PYLON (the unlockable shader-cone preset) is kept as an option.
    /// </summary>
    public sealed class ThrusterFX : MonoBehaviour
    {
        public enum Style { Light, Pylon }

        [Header("Preset")]
        public Style Preset = Style.Light;

        [Header("Materials (wired by bootstrap)")]
        public Material ExhaustMaterial;    // JH/ConeExhaust (Pylon)
        public Material AdditiveMaterial;   // JH/Additive + radial sprite (Light)

        [Header("Fallback offsets (ship-local) — tweak live in Play mode if misaligned")]
        public Vector3 NozzleL = new Vector3(-0.48f, 0.05f, 5.16f);
        public Vector3 NozzleR = new Vector3(0.50f, -0.01f, 5.10f);
        [Tooltip("Anchor to the GLB's fire/nozzle nodes if present")]
        public bool AutoAnchorToModel = true;

        const int   ParticlesPerNozzle = 22;
        const float ParticleDrift = 4.2f;         // ship-local u/s backward

        sealed class Particle
        {
            public Transform T; public MeshRenderer R; public MaterialPropertyBlock Mpb;
            public Vector3 LocalPos, LocalVel; public float Life, MaxLife;
        }

        Particle[] _particles;
        Transform _bloomL, _bloomR;
        MeshRenderer _bloomLR, _bloomRR;
        MaterialPropertyBlock _bloomMpb;
        Transform _coneL, _coneR;
        Material _matL, _matR;
        Transform _socketL, _socketR;
        ThrusterEffectDefinition _effect;
        Color _color = new Color(0.27f, 0.67f, 1f);   // 0x44aaff
        static readonly int TintId = Shader.PropertyToID("_Tint");

        void OnEnable() => GameEvents.VibeChanged += OnVibe;
        void OnDisable() => GameEvents.VibeChanged -= OnVibe;
        void OnVibe(int idx) => _color = Vibes.Get(idx).thrusterColor;

        void Start()
        {
            _effect = ThrusterEffectCatalog.Light;
            if (AutoAnchorToModel) AutoAnchor();
            if (Preset == Style.Pylon) BuildPylon();
            else BuildLight();
        }

        void AutoAnchor()
        {
            var rig = GetComponent<ShipSocketRig>();
            if (rig == null)
            {
                var model = transform.Find("ShipModel");
                if (model != null)
                {
                    rig = gameObject.AddComponent<ShipSocketRig>();
                    rig.Configure(ShipCatalog.Runner, model);
                }
            }
            if (rig != null && rig.MainThrusterLeft != null && rig.MainThrusterRight != null)
            {
                _socketL = rig.MainThrusterLeft;
                _socketR = rig.MainThrusterRight;
                NozzleL = SocketLocal(_socketL, NozzleL);
                NozzleR = SocketLocal(_socketR, NozzleR);
                return;
            }

            Transform a = null, b = null;
            foreach (var t in GetComponentsInChildren<Transform>(true))
            {
                string n = t.name.ToLowerInvariant();
                if (!n.Contains("fire") && !n.Contains("nozzle") && !n.Contains("exhaust")) continue;
                if (a == null) a = t;
                else if (b == null && t != a) b = t;
            }
            if (a == null) return;
            Vector3 pa = transform.InverseTransformPoint(a.position);
            Vector3 pb = b != null ? transform.InverseTransformPoint(b.position) : pa;
            NozzleL = pa.x <= pb.x ? pa : pb;
            NozzleR = pa.x <= pb.x ? pb : pa;
            if (b == null) { NozzleL += Vector3.left * 0.48f; NozzleR += Vector3.right * 0.48f; }
        }

        // ── LIGHT ────────────────────────────────────────────────────────
        void BuildLight()
        {
            _bloomMpb = new MaterialPropertyBlock();
            _bloomL = MakeSprite("nozzleBloomL", NozzleL, _effect.BloomScale, out _bloomLR);
            _bloomR = MakeSprite("nozzleBloomR", NozzleR, _effect.BloomScale, out _bloomRR);

            _particles = new Particle[ParticlesPerNozzle * 2];
            for (int i = 0; i < _particles.Length; i++)
            {
                var p = new Particle();
                p.T = MakeSprite($"puff{i}", Vector3.zero, _effect.ParticleSize, out p.R);
                p.Mpb = new MaterialPropertyBlock();
                p.MaxLife = 0.01f; p.Life = -Random.value * _effect.ParticleLifeBase;  // stagger
                _particles[i] = p;
            }
        }

        Transform MakeSprite(string name, Vector3 localPos, float size, out MeshRenderer mr)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(go.GetComponent<Collider>());
            go.name = name;
            go.transform.SetParent(transform, false);
            go.transform.localPosition = localPos;
            go.transform.localScale = Vector3.one * size * _effect.Scale;
            mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = AdditiveMaterial;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return go.transform;
        }

        // ── PYLON ────────────────────────────────────────────────────────
        void BuildPylon()
        {
            _coneL = MakeCone(NozzleL, out _matL);
            _coneR = MakeCone(NozzleR, out _matR);
        }

        Transform MakeCone(Vector3 localPos, out Material mat)
        {
            var go = new GameObject("exhaust");
            go.transform.SetParent(transform, false);
            go.transform.localPosition = localPos;
            go.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);   // tip → +Z (behind)
            var mf = go.AddComponent<MeshFilter>();
            mf.sharedMesh = MeshFactory.Cone(1f, 1f, 16);
            var mr = go.AddComponent<MeshRenderer>();
            mat = new Material(ExhaustMaterial);
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return go.transform;
        }

        void Update()
        {
            if (GameManager.I == null) return;
            bool on = GameManager.I.Phase == GamePhase.Playing;
            var s = GameManager.I.Session;
            float rawDt = Mathf.Min(Time.deltaTime, Tuning.MaxRawDt);
            float speedFrac = Mathf.Clamp01(s.EffectiveSpeed / (Tuning.BaseSpeed * 2.5f));
            var cam = UnityEngine.Camera.main;

            if (Preset == Style.Pylon)
            {
                if (_coneL == null) return;
                _coneL.gameObject.SetActive(on); _coneR.gameObject.SetActive(on);
                if (!on) return;
                float len = _effect.ConeLength * (0.7f + 0.5f * speedFrac) * (1f + Mathf.Sin(Time.time * 31f) * 0.04f);
                var sc = new Vector3(_effect.ConeRadius * 2f, len, _effect.ConeRadius * 2f);
                _coneL.localScale = sc; _coneR.localScale = sc;
                _coneL.localPosition = SocketLocal(_socketL, NozzleL);
                _coneR.localPosition = SocketLocal(_socketR, NozzleR);
                _matL.SetColor("_Color", _color); _matR.SetColor("_Color", _color);
                return;
            }

            // LIGHT
            if (_particles == null) return;
            _bloomL.gameObject.SetActive(on); _bloomR.gameObject.SetActive(on);
            if (!on)
            {
                foreach (var p in _particles) p.T.gameObject.SetActive(false);
                return;
            }

            // nozzle bloom: pulse + face camera
            float pulse = _effect.BloomOpacity * (1f + _effect.BloomPulse * Mathf.Sin(Time.time * 22f)) * (0.75f + 0.5f * speedFrac);
            Color bloomCol = Color.Lerp(_color, Color.white, 0.35f); bloomCol.a = Mathf.Clamp01(pulse);
            _bloomMpb.SetColor(TintId, bloomCol);
            _bloomLR.SetPropertyBlock(_bloomMpb); _bloomRR.SetPropertyBlock(_bloomMpb);
            Vector3 nozzleL = SocketLocal(_socketL, NozzleL);
            Vector3 nozzleR = SocketLocal(_socketR, NozzleR);
            _bloomL.localPosition = nozzleL; _bloomR.localPosition = nozzleR;
            if (cam != null) { _bloomL.rotation = cam.transform.rotation; _bloomR.rotation = cam.transform.rotation; }

            // particles: recycle stream from alternating nozzles
            for (int i = 0; i < _particles.Length; i++)
            {
                var p = _particles[i];
                p.Life += rawDt;
                if (p.Life >= p.MaxLife)
                {
                    // respawn at nozzle with jitter
                    bool left = i < ParticlesPerNozzle;
                    Vector3 noz = left ? nozzleL : nozzleR;
                    p.LocalPos = noz + Random.insideUnitSphere * _effect.SpawnJitter;
                    p.LocalVel = new Vector3((Random.value - 0.5f) * 0.6f, (Random.value - 0.5f) * 0.6f,
                                             ParticleDrift * (0.8f + 0.6f * speedFrac + Random.value * 0.4f));
                    p.Life = 0f;
                    p.MaxLife = _effect.ParticleLifeBase + Random.value * _effect.ParticleLifeJitter;
                    p.T.gameObject.SetActive(true);
                }
                p.LocalPos += p.LocalVel * rawDt;
                p.T.localPosition = p.LocalPos;
                float lifeT = p.Life / p.MaxLife;
                float size = _effect.ParticleSize * _effect.Scale * (0.7f + lifeT * 0.9f);
                p.T.localScale = Vector3.one * size;
                if (cam != null) p.T.rotation = cam.transform.rotation;
                Color c = _color; c.a = _effect.ParticleOpacity * (1f - lifeT);
                p.Mpb.SetColor(TintId, c);
                p.R.SetPropertyBlock(p.Mpb);
            }
        }

        Vector3 SocketLocal(Transform socket, Vector3 fallback)
        {
            return socket != null ? transform.InverseTransformPoint(socket.position) : fallback;
        }
    }
}
