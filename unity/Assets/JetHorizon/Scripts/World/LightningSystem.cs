using System.Collections.Generic;
using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Canyon lightning (spec/02 §1.10): telegraphed strike at a lane X —
    /// 0.3 s warning ring, bolt lives 0.5 s, kill radius 3.5 u ground circle.
    /// </summary>
    public sealed class LightningSystem : MonoBehaviour, ISimSystem
    {
        public CameraRig Camera;
        public Material BoltMaterial;   // additive white (JH/Additive)

        const float WarnTime = 0.3f;
        const float BoltLife = 0.5f;
        const float KillRadius = 3.5f;
        const float SpawnZ = -83f;

        sealed class Strike
        {
            public float X, Z;
            public float Timer;          // counts up; < WarnTime = telegraph, then bolt
            public GameObject Warn, Bolt;
            public bool Struck;
        }

        readonly List<Strike> _strikes = new List<Strike>(8);
        bool _patternActive;
        float _freq, _timer;
        static MaterialPropertyBlock _mpb;
        static readonly int TintId = Shader.PropertyToID("_Tint");

        static void SetTint(MeshRenderer mr, Color c)
        {
            _mpb ??= new MaterialPropertyBlock();
            _mpb.Clear();
            _mpb.SetColor(TintId, c);
            mr.SetPropertyBlock(_mpb);
        }

        RunSession S => GameManager.I.Session;

        public void ResetSystem() { StopPattern(); ClearAll(); }

        public void BeginPattern(float frequency) { _patternActive = true; _freq = frequency; _timer = 0f; }
        public void StopPattern() => _patternActive = false;

        void ClearAll()
        {
            foreach (var st in _strikes) { if (st.Warn) Destroy(st.Warn); if (st.Bolt) Destroy(st.Bolt); }
            _strikes.Clear();
        }

        public void SimTick(float dt)
        {
            var s = S;
            float eff = s.EffectiveSpeed;

            if (_patternActive && s.CanyonActive)
            {
                _timer += dt;
                if (_timer >= _freq)
                {
                    _timer = 0f;
                    SpawnStrike(s.ShipX + Random.Range(-8, 9) * 1f, SpawnZ);
                }
            }

            for (int i = _strikes.Count - 1; i >= 0; i--)
            {
                var st = _strikes[i];
                st.Timer += dt;
                st.Z += eff * dt;
                if (st.Warn) st.Warn.transform.position = new Vector3(st.X, 0.05f, st.Z);
                if (st.Bolt) st.Bolt.transform.position = new Vector3(st.X, 15f, st.Z);

                if (!st.Struck && st.Timer >= WarnTime)
                {
                    st.Struck = true;
                    if (st.Warn) { Destroy(st.Warn); st.Warn = null; }
                    st.Bolt = MakeBolt(st.X, st.Z);
                    Camera.Shake();

                    // kill check at strike moment
                    float dx = s.ShipX - st.X, dz = Tuning.ShipZ - st.Z;
                    if (s.InvincibleTimer <= 0f && !s.IntroActive && dx * dx + dz * dz < KillRadius * KillRadius)
                    {
                        GameManager.I.KillPlayer();
                    }
                }

                if (st.Timer >= WarnTime + BoltLife || st.Z > Tuning.DespawnZ)
                {
                    if (st.Warn) Destroy(st.Warn);
                    if (st.Bolt) Destroy(st.Bolt);
                    _strikes.RemoveAt(i);
                }
            }
        }

        void SpawnStrike(float x, float z)
        {
            var warn = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(warn.GetComponent<Collider>());
            warn.name = "lt_warn";
            warn.transform.SetParent(transform, false);
            warn.transform.position = new Vector3(x, 0.05f, z);
            warn.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
            warn.transform.localScale = Vector3.one * (KillRadius * 2f);
            var mr = warn.GetComponent<MeshRenderer>();
            mr.sharedMaterial = BoltMaterial;
            SetTint(mr, new Color(1f, 0.9f, 0.3f, 0.35f));
            _strikes.Add(new Strike { X = x, Z = z, Warn = warn });
        }

        GameObject MakeBolt(float x, float z)
        {
            // jagged vertical bolt: thin stretched cube segments
            var bolt = new GameObject("lt_bolt");
            bolt.transform.SetParent(transform, false);
            float y = 30f; float px = 0f;
            for (int i = 0; i < 6; i++)
            {
                var seg = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Destroy(seg.GetComponent<Collider>());
                seg.transform.SetParent(bolt.transform, false);
                float ny = y - 5f, nx = px + Random.Range(-1.5f, 1.5f);
                Vector3 a = new Vector3(px, y, 0), b = new Vector3(nx, ny, 0);
                seg.transform.localPosition = (a + b) / 2f;
                seg.transform.localScale = new Vector3(0.25f, (a - b).magnitude, 0.25f);
                seg.transform.localRotation = Quaternion.FromToRotation(Vector3.up, (a - b).normalized);
                var mr = seg.GetComponent<MeshRenderer>();
                mr.sharedMaterial = BoltMaterial;
                SetTint(mr, new Color(0.9f, 0.95f, 1f, 1f));
                y = ny; px = nx;
            }
            bolt.transform.position = new Vector3(x, 15f, z);
            return bolt;
        }
    }
}
