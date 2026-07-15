using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Visualizes the core-owned extraction crossing. This component never decides
    /// whether the gate is open or whether the ship extracted.
    /// </summary>
    public sealed class ExtractionGatePresenter : MonoBehaviour, ISimSystem
    {
        public Material GateMaterial;
        public float GateCenterY = 8f;

        Transform _root;
        Transform _outerRing;
        Transform _innerRing;
        MeshRenderer _outerRenderer;
        MeshRenderer _innerRenderer;
        Light _light;
        Material _runtimeMaterial;
        Mesh _outerMesh;
        Mesh _innerMesh;
        readonly MaterialPropertyBlock _outerProperties = new MaterialPropertyBlock();
        readonly MaterialPropertyBlock _innerProperties = new MaterialPropertyBlock();

        static readonly int TintId = Shader.PropertyToID("_Tint");
        static readonly int FadeId = Shader.PropertyToID("_Fade");
        static readonly int BodyColorId = Shader.PropertyToID("_BodyColor");
        static readonly int GlowStrengthId = Shader.PropertyToID("_GlowStrength");
        static readonly int EdgeStrengthId = Shader.PropertyToID("_EdgeStrength");

        void Awake() => EnsureBuilt();

        void EnsureBuilt()
        {
            if (_root != null) return;
            Material material = GateMaterial;
            if (material == null)
            {
                Shader shader = Shader.Find("JH/NeonCone");
                if (shader != null)
                {
                    _runtimeMaterial = new Material(shader) { name = "JH_ExtractionGate_Runtime" };
                    material = _runtimeMaterial;
                }
            }

            _root = new GameObject("Spatial Extraction Gate").transform;
            _root.SetParent(transform, false);
            _outerMesh = MeshFactory.PolygonTorus(1f, .075f, 12, 8);
            _innerMesh = MeshFactory.PolygonTorus(1f, .035f, 12, 6);
            _outerRing = CreateRing("Outer Gate Ring", _outerMesh, material, out _outerRenderer);
            _innerRing = CreateRing("Inner Gate Ring", _innerMesh, material, out _innerRenderer);

            var lightObject = new GameObject("Gate Light");
            lightObject.transform.SetParent(_root, false);
            _light = lightObject.AddComponent<Light>();
            _light.type = LightType.Point;
            _light.color = new Color(.18f, .84f, 1f);
            _light.range = 32f;
            _light.intensity = 0f;
            _light.shadows = LightShadows.None;

            ConfigureProperties(_outerProperties, new Color(.1f, .92f, 1f), 3.1f, .95f);
            ConfigureProperties(_innerProperties, new Color(1f, .18f, .82f), 3.6f, 1f);
            _outerRenderer.SetPropertyBlock(_outerProperties);
            _innerRenderer.SetPropertyBlock(_innerProperties);
            _root.gameObject.SetActive(false);
        }

        Transform CreateRing(string name, Mesh mesh, Material material, out MeshRenderer renderer)
        {
            var go = new GameObject(name);
            go.transform.SetParent(_root, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return go.transform;
        }

        static void ConfigureProperties(MaterialPropertyBlock block, Color tint, float glow, float edge)
        {
            block.SetColor(TintId, tint);
            block.SetColor(BodyColorId, tint * .16f);
            block.SetFloat(GlowStrengthId, glow);
            block.SetFloat(EdgeStrengthId, edge);
            block.SetFloat(FadeId, 1f);
        }

        public void ResetSystem()
        {
            EnsureBuilt();
            _root.gameObject.SetActive(false);
            _light.intensity = 0f;
        }

        public void SimTick(float dt)
        {
            EnsureBuilt();
            SimulationSnapshot snapshot = GameManager.I != null ? GameManager.I.CoreSnapshot : null;
            if (snapshot == null || !snapshot.ExtractionGateVisible)
            {
                _root.gameObject.SetActive(false);
                return;
            }

            _root.gameObject.SetActive(true);
            _root.position = new Vector3(snapshot.ExtractionGateX, GateCenterY, snapshot.ExtractionGateZ);
            float radius = Mathf.Max(4f, snapshot.ExtractionGateHalfWidth);
            float pulse = 1f + Mathf.Sin(snapshot.Elapsed * 5.2f) * .035f;
            _outerRing.localScale = Vector3.one * radius * pulse;
            _innerRing.localScale = Vector3.one * radius * .82f * (2f - pulse);
            _innerRing.localRotation = Quaternion.Euler(0f, 0f, snapshot.Elapsed * 32f);
            _outerRing.localRotation = Quaternion.Euler(0f, 0f, -snapshot.Elapsed * 14f);
            float approach = Mathf.InverseLerp(-240f, 8f, snapshot.ExtractionGateZ);
            _light.intensity = Mathf.Lerp(3.5f, 10f, approach) * (.9f + .1f * Mathf.Sin(snapshot.Elapsed * 8f));
        }

        void OnDestroy()
        {
            if (_outerMesh != null) Destroy(_outerMesh);
            if (_innerMesh != null) Destroy(_innerMesh);
            if (_runtimeMaterial != null) Destroy(_runtimeMaterial);
        }
    }
}
