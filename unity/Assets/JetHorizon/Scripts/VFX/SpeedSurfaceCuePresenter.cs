using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// One-draw-call near-water motion field. Its fixed world density makes real speed
    /// changes readable even when gate cadence remains reaction-time based.
    /// </summary>
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public sealed class SpeedSurfaceCuePresenter : MonoBehaviour
    {
        const int CueCount = 96;
        readonly float[] _x = new float[CueCount];
        readonly float[] _z = new float[CueCount];
        readonly float[] _seed = new float[CueCount];
        readonly Vector3[] _vertices = new Vector3[CueCount * 4];
        readonly Vector2[] _uv = new Vector2[CueCount * 4];
        readonly int[] _triangles = new int[CueCount * 6];

        Mesh _mesh;
        MeshRenderer _renderer;
        Material _material;
        MaterialPropertyBlock _properties;
        System.Random _random;

        static readonly int TintId = Shader.PropertyToID("_Tint");

        void Awake()
        {
            _random = new System.Random(20260716);
            _properties = new MaterialPropertyBlock();
            _mesh = new Mesh { name = "JH_SurfaceSpeedCues", indexFormat = IndexFormat.UInt32 };
            _mesh.MarkDynamic();
            for (int i = 0; i < CueCount; i++)
            {
                _x[i] = Range(-70f, 70f);
                _z[i] = Range(-280f, 24f);
                _seed[i] = Range(0f, 1f);
                int vertex = i * 4;
                _uv[vertex] = new Vector2(0f, 0f);
                _uv[vertex + 1] = new Vector2(1f, 0f);
                _uv[vertex + 2] = new Vector2(1f, 1f);
                _uv[vertex + 3] = new Vector2(0f, 1f);
                int triangle = i * 6;
                _triangles[triangle] = vertex;
                _triangles[triangle + 1] = vertex + 2;
                _triangles[triangle + 2] = vertex + 1;
                _triangles[triangle + 3] = vertex;
                _triangles[triangle + 4] = vertex + 3;
                _triangles[triangle + 5] = vertex + 2;
            }
            _mesh.vertices = _vertices;
            _mesh.uv = _uv;
            _mesh.triangles = _triangles;
            _mesh.bounds = new Bounds(Vector3.zero, new Vector3(220f, 8f, 800f));
            GetComponent<MeshFilter>().sharedMesh = _mesh;
            _renderer = GetComponent<MeshRenderer>();
            Shader shader = Shader.Find("JH/Additive");
            if (shader != null)
            {
                _material = new Material(shader) { name = "JH_SurfaceSpeedCues_Runtime" };
                _material.SetTexture("_MainTex", Texture2D.whiteTexture);
                _renderer.sharedMaterial = _material;
            }
            _renderer.shadowCastingMode = ShadowCastingMode.Off;
            _renderer.receiveShadows = false;
        }

        void Update()
        {
            if (GameManager.I == null || _mesh == null || _renderer == null) return;
            bool active = GameManager.I.Phase == GamePhase.Playing;
            _renderer.enabled = active;
            if (!active) return;

            RunSession session = GameManager.I.Session;
            JetHorizonFeelProfile profile = GameManager.I.FeelProfile;
            ShipFeelSignals signals = ShipFeelPresenter.I != null ? ShipFeelPresenter.I.Signals : default;
            float dt = Mathf.Min(Time.unscaledDeltaTime, Tuning.MaxRawDt);
            float visual = Mathf.Clamp01(
                signals.SpeedPresentation
                + signals.GateKick01 * (profile != null ? profile.GateSurfaceCueBurst : .75f));
            float shipX = session.ShipX;
            for (int i = 0; i < CueCount; i++)
            {
                _z[i] += session.EffectiveSpeed * dt * Mathf.Lerp(.85f, 1.35f, _seed[i]);
                if (_z[i] > 30f)
                {
                    _z[i] = Range(-300f, -235f);
                    _x[i] = shipX + Range(-72f, 72f);
                    _seed[i] = Range(0f, 1f);
                }
                float width = Mathf.Lerp(.025f, .085f, visual) * Mathf.Lerp(.75f, 1.25f, _seed[i]);
                float length = Mathf.Lerp(.65f, 6f, visual) * Mathf.Lerp(.65f, 1.35f, _seed[i]);
                float x = _x[i];
                float z = _z[i];
                int vertex = i * 4;
                _vertices[vertex] = new Vector3(x - width, .055f, z - length);
                _vertices[vertex + 1] = new Vector3(x + width, .055f, z - length);
                _vertices[vertex + 2] = new Vector3(x + width, .055f, z);
                _vertices[vertex + 3] = new Vector3(x - width, .055f, z);
            }
            _mesh.vertices = _vertices;
            _mesh.bounds = new Bounds(new Vector3(shipX, .055f, -120f), new Vector3(220f, 8f, 800f));
            Color tint = Color.Lerp(
                new Color(.32f, .58f, .76f, .025f),
                new Color(.72f, .93f, 1f, .20f),
                visual);
            _properties.SetColor(TintId, tint);
            _renderer.SetPropertyBlock(_properties);
        }

        float Range(float minimum, float maximum)
            => minimum + (float)_random.NextDouble() * (maximum - minimum);

        void OnDestroy()
        {
            if (_mesh != null) Destroy(_mesh);
            if (_material != null) Destroy(_material);
        }
    }
}
