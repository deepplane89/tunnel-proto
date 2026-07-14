using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Speed-scaled warp streaks (spec/03 §4c). The permanent star backdrop now
    /// lives in the skybox shader, where it remains dense, crisp and visible at title
    /// without creating almost one thousand tiny scene objects.
    /// </summary>
    public sealed class StarfieldController : MonoBehaviour
    {
        public Material StarMaterial;     // retained for scene/backward serialization
        public Material StreakMaterial;   // JH/Additive plain

        const int StreakCount = 400;
        const float VolZ = 600f;

        Transform[] _streaks;

        void Start()
        {
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
        }

        static Vector3 RandomStreakPos() => new Vector3(
            Random.Range(-520f, 520f), Random.Range(2f, 450f), Random.Range(-VolZ, 0f));

        void Update()
        {
            if (GameManager.I == null || GameManager.I.Phase != GamePhase.Playing) return;
            var s = GameManager.I.Session;
            float rawDt = Mathf.Min(Time.deltaTime, Tuning.MaxRawDt);
            float step = s.EffectiveSpeed * rawDt;

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
