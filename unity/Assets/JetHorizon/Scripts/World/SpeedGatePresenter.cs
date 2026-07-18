using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Direct Unity presentation port of the Three.js checkpoint-beam proof.
    /// Route placement and hit authority remain exclusively in the simulation core.
    /// </summary>
    public sealed class SpeedGatePresenter : MonoBehaviour, ISimSystem
    {
        sealed class GateView
        {
            public int Id;
            public SpeedGateKind Kind;
            public float HitRemaining;
            public float Reveal;
            public Transform Root;
            public Transform Core;
            public Transform Outer;
            public Transform Disc;
            public Transform Ring;
            public Transform Pulse;
            public MeshRenderer CoreRenderer;
            public MeshRenderer OuterRenderer;
            public MeshRenderer DiscRenderer;
            public MeshRenderer RingRenderer;
            public MeshRenderer PulseRenderer;
            public Light Light;
            public MaterialPropertyBlock CoreProperties;
            public MaterialPropertyBlock OuterProperties;
            public MaterialPropertyBlock DiscProperties;
            public MaterialPropertyBlock RingProperties;
            public MaterialPropertyBlock PulseProperties;
        }

        const int PoolSize = 16;
        const float BeamHeight = 170f;
        const float TargetRadius = 4.25f;
        const float HitDuration = .72f;

        static readonly Color PendingColor = new Color(36f / 255f, 216f / 255f, 1f, 1f);
        static readonly Color HitColor = new Color(1f, 59f / 255f, 213f / 255f, 1f);

        readonly List<GateView> _views = new List<GateView>(PoolSize);
        readonly Dictionary<int, GateSnapshot> _facts = new Dictionary<int, GateSnapshot>(PoolSize);
        Mesh _coreMesh;
        Mesh _outerMesh;
        Material _beamMaterial;
        Material _discMaterial;
        Material _ringMaterial;
        Texture2D _discTexture;
        Texture2D _ringTexture;

        static readonly int TintId = Shader.PropertyToID("_Tint");
        static readonly int OpacityId = Shader.PropertyToID("_Opacity");
        static readonly int DistanceFadeId = Shader.PropertyToID("_DistanceFade");
        static readonly int RevealId = Shader.PropertyToID("_Reveal");

        void Awake() => EnsurePool();
        void OnEnable() => GameEvents.SpeedGateCrossed += GateCrossed;
        void OnDisable() => GameEvents.SpeedGateCrossed -= GateCrossed;

        void EnsurePool()
        {
            if (_views.Count > 0) return;
            _coreMesh = OpenTaperedCylinder(.62f, .34f, BeamHeight, 12, "JH_CheckpointCore");
            _outerMesh = OpenTaperedCylinder(2.5f, 1.7f, BeamHeight, 16, "JH_CheckpointOuter");

            Shader beamShader = Shader.Find("JH/CheckpointBeam");
            Shader additive = Shader.Find("JH/Additive");
            if (beamShader != null)
                _beamMaterial = new Material(beamShader) { name = "JH_CheckpointBeam_Runtime" };
            if (additive != null)
            {
                _discTexture = TextureFactory.RadialSprite(128);
                _ringTexture = TextureFactory.RingSprite(128);
                _discMaterial = new Material(additive) { name = "JH_CheckpointDisc_Runtime" };
                _ringMaterial = new Material(additive) { name = "JH_CheckpointRing_Runtime" };
                _discMaterial.SetTexture("_MainTex", _discTexture);
                _ringMaterial.SetTexture("_MainTex", _ringTexture);
            }

            for (int i = 0; i < PoolSize; i++) _views.Add(CreateView(i));
        }

        GateView CreateView(int index)
        {
            var root = new GameObject("Checkpoint Beam " + index).transform;
            root.SetParent(transform, false);

            Transform outer = CreateMeshChild("Outer Sky Column", root, _outerMesh, _beamMaterial, out MeshRenderer outerRenderer);
            Transform core = CreateMeshChild("Beam Core", root, _coreMesh, _beamMaterial, out MeshRenderer coreRenderer);
            Transform disc = CreateQuad("Water Target Disc", root, _discMaterial, .055f, out MeshRenderer discRenderer);
            Transform ring = CreateQuad("Water Target Ring", root, _ringMaterial, .08f, out MeshRenderer ringRenderer);
            Transform pulse = CreateQuad("Hit Ring Pulse", root, _ringMaterial, .10f, out MeshRenderer pulseRenderer);
            disc.localScale = Vector3.one * TargetRadius * 2f;
            ring.localScale = Vector3.one * TargetRadius * 2f;
            pulse.localScale = Vector3.one * TargetRadius * 2f;
            pulse.gameObject.SetActive(false);

            var lightObject = new GameObject("Checkpoint Water Light");
            lightObject.transform.SetParent(root, false);
            lightObject.transform.localPosition = new Vector3(0f, 3.2f, 0f);
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Point;
            light.range = 20f;
            light.shadows = LightShadows.None;

            root.gameObject.SetActive(false);
            return new GateView
            {
                Root = root,
                Core = core,
                Outer = outer,
                Disc = disc,
                Ring = ring,
                Pulse = pulse,
                CoreRenderer = coreRenderer,
                OuterRenderer = outerRenderer,
                DiscRenderer = discRenderer,
                RingRenderer = ringRenderer,
                PulseRenderer = pulseRenderer,
                Light = light,
                CoreProperties = new MaterialPropertyBlock(),
                OuterProperties = new MaterialPropertyBlock(),
                DiscProperties = new MaterialPropertyBlock(),
                RingProperties = new MaterialPropertyBlock(),
                PulseProperties = new MaterialPropertyBlock()
            };
        }

        static Transform CreateMeshChild(
            string name,
            Transform parent,
            Mesh mesh,
            Material material,
            out MeshRenderer renderer)
        {
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
            child.AddComponent<MeshFilter>().sharedMesh = mesh;
            renderer = child.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return child.transform;
        }

        static Transform CreateQuad(
            string name,
            Transform parent,
            Material material,
            float y,
            out MeshRenderer renderer)
        {
            GameObject quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(quad.GetComponent<Collider>());
            quad.name = name;
            quad.transform.SetParent(parent, false);
            quad.transform.localPosition = new Vector3(0f, y, 0f);
            quad.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            renderer = quad.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return quad.transform;
        }

        static Mesh OpenTaperedCylinder(float bottomRadius, float topRadius, float height, int segments, string name)
        {
            int stride = segments + 1;
            var vertices = new Vector3[stride * 2];
            var normals = new Vector3[stride * 2];
            var uvs = new Vector2[stride * 2];
            var triangles = new int[segments * 6];
            for (int i = 0; i <= segments; i++)
            {
                float u = i / (float)segments;
                float angle = u * Mathf.PI * 2f;
                float x = Mathf.Cos(angle);
                float z = Mathf.Sin(angle);
                vertices[i] = new Vector3(x * bottomRadius, 0f, z * bottomRadius);
                vertices[stride + i] = new Vector3(x * topRadius, height, z * topRadius);
                Vector3 normal = new Vector3(x, (bottomRadius - topRadius) / height, z).normalized;
                normals[i] = normal;
                normals[stride + i] = normal;
                uvs[i] = new Vector2(u, 0f);
                uvs[stride + i] = new Vector2(u, 1f);
            }
            int t = 0;
            for (int i = 0; i < segments; i++)
            {
                int a = i;
                int b = i + 1;
                int c = stride + i;
                int d = stride + i + 1;
                triangles[t++] = a; triangles[t++] = c; triangles[t++] = b;
                triangles[t++] = b; triangles[t++] = c; triangles[t++] = d;
            }
            var mesh = new Mesh { name = name };
            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.uv = uvs;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }

        public void ResetSystem()
        {
            EnsurePool();
            foreach (GateView view in _views) Release(view);
        }

        public void SimTick(float dt)
        {
            EnsurePool();
            SimulationSnapshot snapshot = GameManager.I != null ? GameManager.I.CoreSnapshot : null;
            float speed = GameManager.I != null ? GameManager.I.Session.EffectiveSpeed : Tuning.BaseSpeed;
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
                GateSnapshot fact = default;
                bool hasFact = view.Id != 0 && _facts.TryGetValue(view.Id, out fact);
                if (view.HitRemaining > 0f)
                {
                    view.HitRemaining = Mathf.Max(0f, view.HitRemaining - dt);
                    if (hasFact)
                    {
                        SetFact(view, fact);
                        _facts.Remove(view.Id);
                    }
                    else
                    {
                        Vector3 position = view.Root.position;
                        position.z += speed * dt;
                        view.Root.position = position;
                    }
                    Present(view, snapshot, true);
                    if (view.HitRemaining <= 0f) Release(view);
                    continue;
                }

                if (!hasFact)
                {
                    Release(view);
                    continue;
                }
                view.Reveal = Mathf.Min(1f, view.Reveal + dt / .82f);
                SetFact(view, fact);
                Present(view, snapshot, false);
                _facts.Remove(view.Id);
            }

            foreach (KeyValuePair<int, GateSnapshot> pair in _facts)
            {
                GateView view = Acquire();
                if (view == null) break;
                view.Id = pair.Key;
                view.Reveal = 0f;
                SetFact(view, pair.Value);
                Present(view, snapshot, false);
            }
        }

        void GateCrossed(SpeedGateKind kind, float gain, int streak)
        {
            EnsurePool();
            GateView nearest = null;
            float nearestDepth = float.MaxValue;
            for (int i = 0; i < _views.Count; i++)
            {
                GateView candidate = _views[i];
                if (candidate.Id == 0 || candidate.HitRemaining > 0f) continue;
                float depth = Mathf.Abs(candidate.Root.position.z - Tuning.ShipZ);
                if (depth >= nearestDepth) continue;
                nearest = candidate;
                nearestDepth = depth;
            }
            if (nearest == null) return;
            nearest.Kind = kind;
            nearest.HitRemaining = HitDuration;
            nearest.Reveal = 1f;
            nearest.Pulse.gameObject.SetActive(true);
        }

        static void SetFact(GateView view, GateSnapshot gate)
        {
            view.Kind = gate.Kind;
            view.Root.position = new Vector3(gate.X, 0f, gate.Z);
        }

        static void Present(GateView view, SimulationSnapshot snapshot, bool hit)
        {
            float elapsed = snapshot != null ? snapshot.Elapsed : Time.unscaledTime;
            float distanceFade = Mathf.SmoothStep(0f, 1f,
                Mathf.InverseLerp(-760f, -170f, view.Root.position.z));
            Color tint = hit ? HitColor : PendingColor;
            float coreOpacity = hit ? 1f : .72f;
            float outerOpacity = hit ? .34f : .16f;
            float discOpacity = hit ? .34f : .12f;
            float ringOpacity = hit ? 1f : .78f;
            float reveal = hit ? 1f : view.Reveal;
            float waterArrival = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(.78f, 1f, reveal));

            view.Root.gameObject.SetActive(true);
            float verticalPulse = 1f + Mathf.Sin((elapsed + view.Id * .37f) * 1.7f) * .008f;
            view.Core.localScale = new Vector3(1f, verticalPulse, 1f);
            view.Outer.localScale = new Vector3(1f, verticalPulse, 1f);

            SetBeam(view.CoreRenderer, view.CoreProperties, tint, coreOpacity, distanceFade, reveal);
            SetBeam(view.OuterRenderer, view.OuterProperties, tint, outerOpacity, distanceFade, reveal);
            SetAdditive(view.DiscRenderer, view.DiscProperties, tint, discOpacity * distanceFade * waterArrival);
            SetAdditive(view.RingRenderer, view.RingProperties, tint, ringOpacity * distanceFade * waterArrival);

            if (hit)
            {
                float hitT = 1f - Mathf.Clamp01(view.HitRemaining / HitDuration);
                view.Pulse.gameObject.SetActive(true);
                view.Pulse.localScale = Vector3.one * TargetRadius * 2f * (1f + hitT * 2.8f);
                SetAdditive(view.PulseRenderer, view.PulseProperties, HitColor, (1f - hitT) * distanceFade);
            }
            else
            {
                view.Pulse.gameObject.SetActive(false);
            }

            view.Light.color = tint;
            view.Light.intensity = distanceFade * (hit ? 6f : 2f);
        }

        static void SetBeam(
            MeshRenderer renderer,
            MaterialPropertyBlock properties,
            Color tint,
            float opacity,
            float distanceFade,
            float reveal)
        {
            properties.SetColor(TintId, tint);
            properties.SetFloat(OpacityId, opacity);
            properties.SetFloat(DistanceFadeId, distanceFade);
            properties.SetFloat(RevealId, reveal);
            renderer.SetPropertyBlock(properties);
        }

        static void SetAdditive(
            MeshRenderer renderer,
            MaterialPropertyBlock properties,
            Color tint,
            float opacity)
        {
            tint.a = opacity;
            properties.SetColor(TintId, tint);
            renderer.SetPropertyBlock(properties);
        }

        GateView Acquire()
        {
            foreach (GateView view in _views)
                if (view.Id == 0) return view;
            return null;
        }

        static void Release(GateView view)
        {
            view.Id = 0;
            view.HitRemaining = 0f;
            view.Reveal = 0f;
            view.Root.gameObject.SetActive(false);
            view.Pulse.gameObject.SetActive(false);
        }

        void OnDestroy()
        {
            if (_coreMesh != null) Destroy(_coreMesh);
            if (_outerMesh != null) Destroy(_outerMesh);
            if (_beamMaterial != null) Destroy(_beamMaterial);
            if (_discMaterial != null) Destroy(_discMaterial);
            if (_ringMaterial != null) Destroy(_ringMaterial);
            if (_discTexture != null) Destroy(_discTexture);
            if (_ringTexture != null) Destroy(_ringTexture);
        }
    }
}
