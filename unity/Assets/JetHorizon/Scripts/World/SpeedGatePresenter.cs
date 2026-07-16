using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>Snapshot-only pooled presentation for common, surge and transition gates.</summary>
    public sealed class SpeedGatePresenter : MonoBehaviour, ISimSystem
    {
        sealed class GateView
        {
            public int Id;
            public Transform Root;
            public Transform Ring;
            public MeshRenderer Renderer;
            public Light Light;
            public MaterialPropertyBlock Properties;
        }

        readonly List<GateView> _views = new List<GateView>(16);
        readonly Dictionary<int, GateSnapshot> _facts = new Dictionary<int, GateSnapshot>(16);
        Mesh _mesh;
        Material _material;

        static readonly int TintId = Shader.PropertyToID("_Tint");
        static readonly int BodyColorId = Shader.PropertyToID("_BodyColor");
        static readonly int GlowStrengthId = Shader.PropertyToID("_GlowStrength");
        static readonly int EdgeStrengthId = Shader.PropertyToID("_EdgeStrength");
        static readonly int FadeId = Shader.PropertyToID("_Fade");

        void Awake() => EnsurePool();

        void EnsurePool()
        {
            if (_views.Count > 0) return;
            _mesh = MeshFactory.PolygonTorus(1f, .12f, 20, 8);
            Shader shader = Shader.Find("JH/NeonCone");
            if (shader != null) _material = new Material(shader) { name = "JH_SpeedGate_Runtime" };
            for (int i = 0; i < 16; i++) _views.Add(CreateView(i));
        }

        GateView CreateView(int index)
        {
            var root = new GameObject("Speed Gate " + index).transform;
            root.SetParent(transform, false);
            var ring = new GameObject("Glowing Band").transform;
            ring.SetParent(root, false);
            ring.gameObject.AddComponent<MeshFilter>().sharedMesh = _mesh;
            var renderer = ring.gameObject.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = _material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            var lightObject = new GameObject("Gate Light");
            lightObject.transform.SetParent(root, false);
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Point;
            light.range = 20f;
            light.shadows = LightShadows.None;
            root.gameObject.SetActive(false);
            return new GateView
            {
                Root = root,
                Ring = ring,
                Renderer = renderer,
                Light = light,
                Properties = new MaterialPropertyBlock()
            };
        }

        public void ResetSystem()
        {
            EnsurePool();
            foreach (GateView view in _views)
            {
                view.Id = 0;
                view.Root.gameObject.SetActive(false);
            }
        }

        public void SimTick(float dt)
        {
            EnsurePool();
            SimulationSnapshot snapshot = GameManager.I != null ? GameManager.I.CoreSnapshot : null;
            _facts.Clear();
            if (snapshot != null)
            {
                for (int i = 0; i < snapshot.GateCount; i++)
                {
                    GateSnapshot gate = snapshot.GetGate(i);
                    if (gate.Active && gate.Kind != SpeedGateKind.Extraction)
                        _facts[gate.Id] = gate;
                }
            }

            foreach (GateView view in _views)
            {
                if (view.Id == 0 || !_facts.TryGetValue(view.Id, out GateSnapshot fact))
                {
                    view.Id = 0;
                    view.Root.gameObject.SetActive(false);
                    continue;
                }
                Present(view, fact, snapshot);
                _facts.Remove(view.Id);
            }
            foreach (KeyValuePair<int, GateSnapshot> pair in _facts)
            {
                GateView view = Acquire();
                if (view == null) break;
                view.Id = pair.Key;
                Present(view, pair.Value, snapshot);
            }
        }

        GateView Acquire()
        {
            foreach (GateView view in _views)
                if (view.Id == 0) return view;
            return null;
        }

        static Color ColorFor(SpeedGateKind kind)
        {
            switch (kind)
            {
                case SpeedGateKind.Surge: return new Color(.16f, .95f, 1f);
                case SpeedGateKind.CanyonTransition: return new Color(1f, .48f, .10f);
                case SpeedGateKind.PrismaticTransition: return new Color(1f, .18f, .82f);
                default: return new Color(.12f, 1f, .38f);
            }
        }

        void Present(GateView view, GateSnapshot gate, SimulationSnapshot snapshot)
        {
            Color tint = ColorFor(gate.Kind);
            float special = gate.Kind == SpeedGateKind.Common ? 0f : 1f;
            float pulse = 1f + Mathf.Sin(snapshot.Elapsed * (5f + special * 2f) + gate.Id * .17f) * (.025f + special * .025f);
            view.Root.gameObject.SetActive(true);
            view.Root.position = new Vector3(gate.X, 7.4f, gate.Z);
            view.Ring.localScale = Vector3.one * gate.HalfWidth * pulse;
            view.Ring.localRotation = Quaternion.Euler(0f, 0f, snapshot.Elapsed * (gate.Id % 2 == 0 ? 8f : -8f));
            view.Properties.SetColor(TintId, tint);
            view.Properties.SetColor(BodyColorId, tint * .12f);
            view.Properties.SetFloat(GlowStrengthId, 3.2f + special * 1.3f);
            view.Properties.SetFloat(EdgeStrengthId, .95f);
            view.Properties.SetFloat(FadeId, Mathf.InverseLerp(-700f, -120f, gate.Z));
            view.Renderer.SetPropertyBlock(view.Properties);
            view.Light.color = tint;
            view.Light.intensity = 2.5f + special * 3f;
        }

        void OnDestroy()
        {
            if (_mesh != null) Destroy(_mesh);
            if (_material != null) Destroy(_material);
        }
    }
}
