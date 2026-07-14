using System.Collections.Generic;
using UnityEngine;
using JetHorizon.Simulation;

namespace JetHorizon
{
    /// <summary>
    /// Presents core-owned canyon lightning. The 3.5-unit warning disc is visual;
    /// the simulation owns the narrow bolt hitbox, timing, lifetime, and targeting.
    /// </summary>
    public sealed class LightningSystem : MonoBehaviour, ISimSystem
    {
        public CameraRig Camera;
        public Material BoltMaterial;   // additive white (JH/Additive)

        const float WarningDiscRadius = 3.5f;

        sealed class Strike
        {
            public int CoreId;
            public GameObject Warn, Bolt;
            public bool Struck;
        }

        readonly List<Strike> _strikes = new List<Strike>(8);
        readonly Dictionary<int, HazardSnapshot> _coreStrikes = new Dictionary<int, HazardSnapshot>(32);
        static MaterialPropertyBlock _mpb;
        static readonly int TintId = Shader.PropertyToID("_Tint");

        static void SetTint(MeshRenderer mr, Color c)
        {
            _mpb ??= new MaterialPropertyBlock();
            _mpb.Clear();
            _mpb.SetColor(TintId, c);
            mr.SetPropertyBlock(_mpb);
        }

        public void ResetSystem() => ClearAll();

        void ClearAll()
        {
            foreach (var st in _strikes) { if (st.Warn) Destroy(st.Warn); if (st.Bolt) Destroy(st.Bolt); }
            _strikes.Clear();
        }

        public void SimTick(float dt)
        {
            var snapshot = GameManager.I.CoreSnapshot;
            _coreStrikes.Clear();
            if (snapshot != null)
            {
                for (int i = 0; i < snapshot.HazardCount; i++)
                {
                    var hazard = snapshot.GetHazard(i);
                    if (hazard.Kind == HazardKind.Lightning) _coreStrikes[hazard.Id] = hazard;
                }
                EnsureCorePresenters(snapshot);
            }

            for (int i = _strikes.Count - 1; i >= 0; i--)
            {
                var st = _strikes[i];
                if (!_coreStrikes.TryGetValue(st.CoreId, out var hazard))
                {
                    DestroyPresenter(st);
                    _strikes.RemoveAt(i);
                    continue;
                }

                if (st.Warn) st.Warn.transform.position = new Vector3(hazard.X, 0.05f, hazard.Z);
                if (st.Bolt) st.Bolt.transform.position = new Vector3(hazard.X, 15f, hazard.Z);

                if (!st.Struck && hazard.CollisionActive)
                {
                    st.Struck = true;
                    if (st.Warn) { Destroy(st.Warn); st.Warn = null; }
                    st.Bolt = MakeBolt(hazard.X, hazard.Z);
                    Camera.Shake();
                }
            }
        }

        void EnsureCorePresenters(SimulationSnapshot snapshot)
        {
            for (int i = 0; i < snapshot.HazardCount; i++)
            {
                var hazard = snapshot.GetHazard(i);
                if (hazard.Kind != HazardKind.Lightning) continue;
                bool found = false;
                foreach (var strike in _strikes)
                {
                    if (strike.CoreId == hazard.Id) { found = true; break; }
                }
                if (!found) SpawnPresenter(hazard);
            }
        }

        void SpawnPresenter(HazardSnapshot hazard)
        {
            var warn = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(warn.GetComponent<Collider>());
            warn.name = "lt_warn";
            warn.transform.SetParent(transform, false);
            warn.transform.position = new Vector3(hazard.X, 0.05f, hazard.Z);
            warn.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
            warn.transform.localScale = Vector3.one * (WarningDiscRadius * 2f);
            var mr = warn.GetComponent<MeshRenderer>();
            mr.sharedMaterial = BoltMaterial;
            SetTint(mr, new Color(1f, 0.9f, 0.3f, 0.35f));
            var strike = new Strike { CoreId = hazard.Id, Warn = warn };
            if (hazard.CollisionActive)
            {
                strike.Struck = true;
                Destroy(warn);
                strike.Warn = null;
                strike.Bolt = MakeBolt(hazard.X, hazard.Z);
            }
            _strikes.Add(strike);
        }

        static void DestroyPresenter(Strike strike)
        {
            if (strike.Warn) Destroy(strike.Warn);
            if (strike.Bolt) Destroy(strike.Bolt);
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
