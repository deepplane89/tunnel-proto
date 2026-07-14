using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Z-recycled starfield + speed-scaled warp streaks (spec/03 §4c), built from
    /// procedural meshes — no particle system assets needed.
    /// Stars scroll at 0.72 × speed; streak count and length grow with speed.
    /// </summary>
    public sealed class StarfieldController : MonoBehaviour
    {
        public Material StarMaterial;     // JH/Additive with radial sprite
        public Material StreakMaterial;   // JH/Additive plain

        const int StarCount = 900;        // (5000 in JS; billboard quads are pricier than gl points)
        const int StreakCount = 400;
        const int NebulaCount = 90;       // (600 pts in JS at opacity 0.02 — large soft tinted blobs)
        const float VolX = 500f, VolY = 220f, VolZ = 600f;

        Transform[] _stars;
        Transform[] _streaks;
        Transform[] _nebula;
        MeshRenderer[] _nebulaR;
        MaterialPropertyBlock _nebulaMpb;
        Color _nebulaTint = new Color(0.13f, 0.27f, 0.67f);

        void OnEnable() => GameEvents.VibeChanged += OnVibe;
        void OnDisable() => GameEvents.VibeChanged -= OnVibe;
        void OnVibe(int idx) => _nebulaTint = Vibes.Get(idx).nebulaTint;

        void Start()
        {
            _stars = new Transform[StarCount];
            var starParent = new GameObject("Stars").transform;
            starParent.SetParent(transform, false);
            for (int i = 0; i < StarCount; i++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
                Destroy(go.GetComponent<Collider>());
                go.transform.SetParent(starParent, false);
                go.transform.position = RandomStarPos();
                float size = Random.Range(0.25f, 0.8f);
                go.transform.localScale = Vector3.one * size;
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = StarMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                _stars[i] = go.transform;
            }

            _streaks = new Transform[StreakCount];
            var streakParent = new GameObject("WarpStreaks").transform;
            streakParent.SetParent(transform, false);
            for (int i = 0; i < StreakCount; i++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Destroy(go.GetComponent<Collider>());
                go.transform.SetParent(streakParent, false);
                go.transform.position = RandomStreakPos();
                go.transform.localScale = new Vector3(0.05f, 0.05f, 2f);
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = StreakMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                go.SetActive(false);
                _streaks[i] = go.transform;
            }

            // nebula: big, faint, vibe-tinted soft blobs (parallax layer)
            _nebula = new Transform[NebulaCount];
            _nebulaR = new MeshRenderer[NebulaCount];
            _nebulaMpb = new MaterialPropertyBlock();
            var nebParent = new GameObject("Nebula").transform;
            nebParent.SetParent(transform, false);
            for (int i = 0; i < NebulaCount; i++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
                Destroy(go.GetComponent<Collider>());
                go.transform.SetParent(nebParent, false);
                go.transform.position = RandomStarPos() + Vector3.up * 40f;
                go.transform.localScale = Vector3.one * Random.Range(28f, 60f);
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = StarMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                _nebula[i] = go.transform;
                _nebulaR[i] = mr;
            }
        }

        static Vector3 RandomStarPos() => new Vector3(
            Random.Range(-VolX, VolX), Random.Range(2f, VolY), Random.Range(-VolZ, 50f));

        static Vector3 RandomStreakPos() => new Vector3(
            Random.Range(-520f, 520f), Random.Range(2f, 450f), Random.Range(-VolZ, 0f));

        void Update()
        {
            if (GameManager.I == null || GameManager.I.Phase != GamePhase.Playing) return;
            var s = GameManager.I.Session;
            float rawDt = Mathf.Min(Time.deltaTime, Tuning.MaxRawDt);
            float step = s.EffectiveSpeed * rawDt;

            // billboard stars toward camera + scroll
            var cam = UnityEngine.Camera.main;
            foreach (var st in _stars)
            {
                var p = st.position;
                p.z += step * 0.72f;
                if (p.z > 60f) { p = RandomStarPos(); p.z = -VolZ; }
                st.position = p;
                if (cam != null) st.rotation = cam.transform.rotation;
            }

            // nebula: slow parallax (0.40× star step), vibe tint
            Color nc = _nebulaTint; nc.a = 0.06f;
            _nebulaMpb.SetColor(Shader.PropertyToID("_Tint"), nc);
            for (int i = 0; i < _nebula.Length; i++)
            {
                var p = _nebula[i].position;
                p.z += step * 0.72f * 0.40f;
                if (p.z > 60f) { p = RandomStarPos() + Vector3.up * 40f; p.z = -VolZ; }
                _nebula[i].position = p;
                if (cam != null) _nebula[i].rotation = cam.transform.rotation;
                _nebulaR[i].SetPropertyBlock(_nebulaMpb);
            }

            // warp streaks: active count + length scale with speed
            float speedFrac = Mathf.Clamp01((s.EffectiveSpeed - Tuning.BaseSpeed) / (Tuning.BaseSpeed * 1.5f));
            int active = Mathf.RoundToInt(Mathf.Lerp(40, StreakCount, speedFrac));
            float len = Mathf.Lerp(1.5f, 4f, speedFrac);
            for (int i = 0; i < _streaks.Length; i++)
            {
                var t = _streaks[i];
                bool on = i < active;
                if (t.gameObject.activeSelf != on) t.gameObject.SetActive(on);
                if (!on) continue;
                var p = t.position;
                p.z += step * 1.4f;
                if (p.z > 40f) p = RandomStreakPos();
                t.position = p;
                t.localScale = new Vector3(0.05f, 0.05f, len);
            }
        }
    }
}
