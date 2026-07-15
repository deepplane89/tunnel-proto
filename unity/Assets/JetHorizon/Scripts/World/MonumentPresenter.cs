using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Projects core-owned monumental barriers into Unity. Gameplay position,
    /// collision, lifetime, and encounter composition remain in the neutral core.
    /// </summary>
    public sealed class MonumentPresenter : MonoBehaviour, ISimSystem
    {
        public Material MonumentMaterial;

        sealed class Monument
        {
            public Transform Transform;
            public MeshRenderer Renderer;
            public MaterialPropertyBlock Properties;
            public int CoreId;
            public bool Active;
        }

        const int PoolSize = 48;
        readonly List<Monument> _pool = new List<Monument>(PoolSize);
        readonly Dictionary<int, HazardSnapshot> _snapshots = new Dictionary<int, HazardSnapshot>(PoolSize);

        static readonly int TintId = Shader.PropertyToID("_Tint");
        static readonly int FadeId = Shader.PropertyToID("_Fade");
        static readonly int BodyColorId = Shader.PropertyToID("_BodyColor");
        static readonly int GlowStrengthId = Shader.PropertyToID("_GlowStrength");
        static readonly int EdgeStrengthId = Shader.PropertyToID("_EdgeStrength");

        Material _runtimeMaterial;

        void Awake() => EnsurePool();

        void EnsurePool()
        {
            if (_pool.Count > 0) return;
            Material material = MonumentMaterial;
            if (material == null)
            {
                Shader shader = Shader.Find("JH/NeonCone");
                if (shader != null)
                {
                    _runtimeMaterial = new Material(shader) { name = "JH_Monument_Runtime" };
                    material = _runtimeMaterial;
                }
            }

            var parent = new GameObject("MonumentPool").transform;
            parent.SetParent(transform, false);
            for (int i = 0; i < PoolSize; i++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                go.name = "monument";
                go.transform.SetParent(parent, false);
                Destroy(go.GetComponent<Collider>());
                var renderer = go.GetComponent<MeshRenderer>();
                renderer.sharedMaterial = material;
                renderer.shadowCastingMode = ShadowCastingMode.On;
                renderer.receiveShadows = true;
                go.SetActive(false);
                _pool.Add(new Monument
                {
                    Transform = go.transform,
                    Renderer = renderer,
                    Properties = new MaterialPropertyBlock()
                });
            }
        }

        public void ResetSystem()
        {
            EnsurePool();
            foreach (Monument monument in _pool) Release(monument);
            _snapshots.Clear();
        }

        public void SimTick(float dt)
        {
            EnsurePool();
            SimulationSnapshot snapshot = GameManager.I != null ? GameManager.I.CoreSnapshot : null;
            _snapshots.Clear();
            if (snapshot != null)
            {
                for (int i = 0; i < snapshot.HazardCount; i++)
                {
                    HazardSnapshot hazard = snapshot.GetHazard(i);
                    if (hazard.Kind == HazardKind.Wall && hazard.Style == HazardStyle.MonumentWall)
                        _snapshots[hazard.Id] = hazard;
                }
                EnsurePresenters(snapshot);
            }

            foreach (Monument monument in _pool)
            {
                if (!monument.Active) continue;
                if (!_snapshots.TryGetValue(monument.CoreId, out HazardSnapshot hazard))
                {
                    Release(monument);
                    continue;
                }

                monument.Transform.position = new Vector3(hazard.X, hazard.Y, hazard.Z);
                float fade = Mathf.Clamp01((hazard.Z - Tuning.SpawnZ) / (-Tuning.SpawnZ * .42f));
                monument.Properties.SetFloat(FadeId, fade);
                monument.Renderer.SetPropertyBlock(monument.Properties);
            }
        }

        void EnsurePresenters(SimulationSnapshot snapshot)
        {
            for (int i = 0; i < snapshot.HazardCount; i++)
            {
                HazardSnapshot hazard = snapshot.GetHazard(i);
                if (hazard.Kind != HazardKind.Wall || hazard.Style != HazardStyle.MonumentWall) continue;
                bool found = false;
                foreach (Monument monument in _pool)
                {
                    if (monument.Active && monument.CoreId == hazard.Id) { found = true; break; }
                }
                if (!found) Acquire(hazard);
            }
        }

        void Acquire(HazardSnapshot hazard)
        {
            foreach (Monument monument in _pool)
            {
                if (monument.Active) continue;
                monument.Active = true;
                monument.CoreId = hazard.Id;
                monument.Transform.position = new Vector3(hazard.X, hazard.Y, hazard.Z);
                monument.Transform.rotation = Quaternion.Euler(
                    hazard.RotationXRadians * Mathf.Rad2Deg,
                    hazard.RotationYRadians * Mathf.Rad2Deg,
                    hazard.RotationZRadians * Mathf.Rad2Deg);
                monument.Transform.localScale = new Vector3(
                    Mathf.Max(.01f, hazard.VisualScale),
                    Mathf.Max(.01f, hazard.VisualScaleY),
                    Mathf.Max(.01f, hazard.VisualScaleZ));
                Color tint = Vibes.ConeColors[Mathf.Abs(hazard.VisualVariant) % Vibes.ConeColors.Length];
                monument.Properties.SetColor(TintId, tint);
                monument.Properties.SetColor(BodyColorId, new Color(.018f, .024f, .045f, 1f));
                monument.Properties.SetFloat(GlowStrengthId, 2.15f);
                monument.Properties.SetFloat(EdgeStrengthId, .72f);
                monument.Properties.SetFloat(FadeId, 0f);
                monument.Renderer.SetPropertyBlock(monument.Properties);
                monument.Transform.gameObject.SetActive(true);
                return;
            }
        }

        static void Release(Monument monument)
        {
            monument.Active = false;
            monument.CoreId = 0;
            if (monument.Transform != null) monument.Transform.gameObject.SetActive(false);
        }

        void OnDestroy()
        {
            if (_runtimeMaterial != null) Destroy(_runtimeMaterial);
        }
    }
}
