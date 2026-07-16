using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>Pooled flaming-rock presentation for engine-neutral asteroid hazards.</summary>
    public sealed class AsteroidSystem : MonoBehaviour, ISimSystem
    {
        sealed class View
        {
            public int Id;
            public Transform Root;
            public Transform Rock;
            public MeshRenderer RockRenderer;
            public MeshRenderer FireRenderer;
            public Transform Warning;
            public MeshRenderer WarningRenderer;
            public LineRenderer Tail;
            public MaterialPropertyBlock Properties;
            public bool Impacted;
        }

        readonly List<View> _views = new List<View>(20);
        readonly Dictionary<int, HazardSnapshot> _facts = new Dictionary<int, HazardSnapshot>(20);
        Mesh _rockMesh;
        Mesh _fireMesh;
        Material _rockMaterial;
        Material _fireMaterial;
        Material _warningMaterial;
        Texture2D _warningTexture;

        static readonly int TintId = Shader.PropertyToID("_Tint");

        void Awake() => EnsurePool();

        void EnsurePool()
        {
            if (_views.Count > 0) return;
            _rockMesh = MeshFactory.Octahedron(1f);
            _fireMesh = MeshFactory.Sphere(1f, 16, 10);
            Shader neon = Shader.Find("JH/NeonCone");
            Shader additive = Shader.Find("JH/Additive");
            if (neon != null) _rockMaterial = new Material(neon) { name = "JH_AsteroidRock_Runtime" };
            if (additive != null)
            {
                _fireMaterial = new Material(additive) { name = "JH_AsteroidFire_Runtime" };
                _fireMaterial.SetTexture("_MainTex", Texture2D.whiteTexture);
                _warningTexture = TextureFactory.RingSprite(96);
                _warningMaterial = new Material(additive) { name = "JH_AsteroidWarning_Runtime" };
                _warningMaterial.SetTexture("_MainTex", _warningTexture);
            }
            for (int i = 0; i < 20; i++) _views.Add(CreateView(i));
        }

        View CreateView(int index)
        {
            var root = new GameObject("Asteroid " + index).transform;
            root.SetParent(transform, false);
            var rock = new GameObject("Rock").transform;
            rock.SetParent(root, false);
            rock.gameObject.AddComponent<MeshFilter>().sharedMesh = _rockMesh;
            var rockRenderer = rock.gameObject.AddComponent<MeshRenderer>();
            rockRenderer.sharedMaterial = _rockMaterial;
            rockRenderer.shadowCastingMode = ShadowCastingMode.On;

            var fire = new GameObject("Fire Shell");
            fire.transform.SetParent(rock, false);
            fire.transform.localScale = Vector3.one * 1.35f;
            fire.AddComponent<MeshFilter>().sharedMesh = _fireMesh;
            var fireRenderer = fire.AddComponent<MeshRenderer>();
            fireRenderer.sharedMaterial = _fireMaterial;
            fireRenderer.shadowCastingMode = ShadowCastingMode.Off;

            var warning = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(warning.GetComponent<Collider>());
            warning.name = "Impact Warning";
            warning.transform.SetParent(root, false);
            warning.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            var warningRenderer = warning.GetComponent<MeshRenderer>();
            warningRenderer.sharedMaterial = _warningMaterial;
            warningRenderer.shadowCastingMode = ShadowCastingMode.Off;

            var tailObject = new GameObject("Fire Tail");
            tailObject.transform.SetParent(root, false);
            var tail = tailObject.AddComponent<LineRenderer>();
            tail.sharedMaterial = _fireMaterial;
            tail.useWorldSpace = true;
            tail.positionCount = 2;
            tail.widthMultiplier = .8f;
            tail.numCapVertices = 4;
            tail.startColor = new Color(1f, .85f, .25f, .9f);
            tail.endColor = new Color(1f, .08f, .01f, 0f);
            root.gameObject.SetActive(false);
            return new View
            {
                Root = root,
                Rock = rock,
                RockRenderer = rockRenderer,
                FireRenderer = fireRenderer,
                Warning = warning.transform,
                WarningRenderer = warningRenderer,
                Tail = tail,
                Properties = new MaterialPropertyBlock()
            };
        }

        public void ResetSystem()
        {
            EnsurePool();
            foreach (View view in _views)
            {
                view.Id = 0;
                view.Impacted = false;
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
                for (int i = 0; i < snapshot.HazardCount; i++)
                {
                    HazardSnapshot hazard = snapshot.GetHazard(i);
                    if (hazard.Kind == HazardKind.Asteroid) _facts[hazard.Id] = hazard;
                }
            }

            foreach (View view in _views)
            {
                if (view.Id == 0 || !_facts.TryGetValue(view.Id, out HazardSnapshot hazard))
                {
                    view.Id = 0;
                    view.Root.gameObject.SetActive(false);
                    continue;
                }
                Present(view, hazard, snapshot);
                _facts.Remove(view.Id);
            }
            foreach (KeyValuePair<int, HazardSnapshot> pair in _facts)
            {
                View view = Acquire();
                if (view == null) break;
                view.Id = pair.Key;
                view.Impacted = false;
                Present(view, pair.Value, snapshot);
            }
        }

        View Acquire()
        {
            foreach (View view in _views)
                if (view.Id == 0) return view;
            return null;
        }

        void Present(View view, HazardSnapshot hazard, SimulationSnapshot snapshot)
        {
            float scale = Mathf.Max(.45f, hazard.VisualScale);
            view.Root.gameObject.SetActive(true);
            view.Root.position = new Vector3(hazard.X, 0f, hazard.Z);
            view.Rock.localPosition = new Vector3(0f, Mathf.Max(.1f, hazard.Y), 0f);
            view.Rock.localScale = Vector3.one * scale;
            view.Rock.localRotation = Quaternion.Euler(
                snapshot.Elapsed * 170f + hazard.Id * 13f,
                snapshot.Elapsed * 120f,
                snapshot.Elapsed * 90f);
            view.Warning.localPosition = new Vector3(0f, .05f, 0f);
            view.Warning.localScale = Vector3.one * scale * 5.2f
                * (1f + Mathf.Sin(snapshot.Elapsed * 13f) * .08f);
            view.Warning.gameObject.SetActive(!hazard.CollisionActive);
            view.Properties.SetColor(TintId, new Color(.10f, .025f, .015f, 1f));
            view.RockRenderer.SetPropertyBlock(view.Properties);
            view.Properties.SetColor(TintId, new Color(1f, .22f, .015f, .52f));
            view.FireRenderer.SetPropertyBlock(view.Properties);
            view.Properties.SetColor(TintId, new Color(1f, .38f, .05f, .75f));
            view.WarningRenderer.SetPropertyBlock(view.Properties);
            Vector3 rock = view.Root.TransformPoint(view.Rock.localPosition);
            view.Tail.SetPosition(0, rock);
            view.Tail.SetPosition(1, rock + Vector3.up * (8f + scale * 5f));
            view.Tail.enabled = !hazard.CollisionActive;
            if (!view.Impacted && hazard.CollisionActive)
            {
                view.Impacted = true;
            }
        }

        void OnDestroy()
        {
            if (_rockMesh != null) Destroy(_rockMesh);
            if (_fireMesh != null) Destroy(_fireMesh);
            if (_rockMaterial != null) Destroy(_rockMaterial);
            if (_fireMaterial != null) Destroy(_fireMaterial);
            if (_warningMaterial != null) Destroy(_warningMaterial);
            if (_warningTexture != null) Destroy(_warningTexture);
        }
    }
}
