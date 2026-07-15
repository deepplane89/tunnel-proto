using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Seam-locked Unity projection of the core-owned canyon route. The route is
    /// constructed once, but each span retains the source slab's 5x6 crystalline
    /// triangle grid, snap quantization, crest breakup, and closed wall volume.
    /// </summary>
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public sealed class StableCanyonPresenter : MonoBehaviour, ISimSystem
    {
        const int MaximumSlices = 96;
        const int LongitudinalSegmentsPerSlice = 5;
        const int VerticalSegments = 6;

        public Material CanyonMaterial;
        public float WallHeight = 55f;
        public float WallThickness = 60f;
        public float Displacement = 4f;
        [Range(.1f, 2f)] public float Snap = .7f;
        [Range(0f, 1f)] public float Brightness = 0.72f;
        [Range(0f, 2f)] public float Emission = 0.28f;
        public float FadeStartZ = -305f;
        public float FadeEndZ = -235f;

        readonly CorridorSliceSnapshot[] _sorted = new CorridorSliceSnapshot[MaximumSlices];
        readonly List<Vector3> _vertices = new List<Vector3>(42000);
        readonly List<Vector2> _uv = new List<Vector2>(42000);
        readonly List<Color> _colors = new List<Color>(42000);
        readonly List<int> _triangles = new List<int>(42000);

        Mesh _mesh;
        MeshRenderer _renderer;
        Material _runtimeMaterial;
        Texture2D _cyanSurface;
        Texture2D _darkSurface;
        int _builtSliceCount;
        int _builtFirstId;
        int _builtLastId;

        static readonly int BrightnessId = Shader.PropertyToID("_Brightness");
        static readonly int EmissionId = Shader.PropertyToID("_Emission");
        static readonly int FadeStartId = Shader.PropertyToID("_FadeStart");
        static readonly int FadeEndId = Shader.PropertyToID("_FadeEnd");
        static readonly int CyanSurfaceId = Shader.PropertyToID("_CyanSurface");
        static readonly int DarkSurfaceId = Shader.PropertyToID("_DarkSurface");

        void Awake() => EnsureBuilt();

        void EnsureBuilt()
        {
            if (_mesh != null) return;
            _mesh = new Mesh { name = "JH_StableCrystallineCanyon", indexFormat = IndexFormat.UInt32 };
            var filter = GetComponent<MeshFilter>() ?? gameObject.AddComponent<MeshFilter>();
            _renderer = GetComponent<MeshRenderer>() ?? gameObject.AddComponent<MeshRenderer>();
            filter.sharedMesh = _mesh;
            _renderer.shadowCastingMode = ShadowCastingMode.Off;
            _renderer.receiveShadows = false;
            gameObject.layer = 8;

            if (CanyonMaterial != null) _runtimeMaterial = new Material(CanyonMaterial);
            else
            {
                Shader shader = Shader.Find("JH/StableCanyon");
                if (shader != null) _runtimeMaterial = new Material(shader) { name = "JH_StableCanyon_Runtime" };
            }
            _renderer.sharedMaterial = _runtimeMaterial;
            if (_runtimeMaterial != null)
            {
                _cyanSurface = TextureFactory.CyanSlab();
                _darkSurface = TextureFactory.DarkSlab();
                _cyanSurface.wrapMode = TextureWrapMode.Repeat;
                _darkSurface.wrapMode = TextureWrapMode.Repeat;
                if (_runtimeMaterial.HasProperty(CyanSurfaceId))
                    _runtimeMaterial.SetTexture(CyanSurfaceId, _cyanSurface);
                if (_runtimeMaterial.HasProperty(DarkSurfaceId))
                    _runtimeMaterial.SetTexture(DarkSurfaceId, _darkSurface);
            }
            _renderer.enabled = false;
        }

        public void ResetSystem()
        {
            EnsureBuilt();
            _mesh.Clear(false);
            _renderer.enabled = false;
            _builtSliceCount = 0;
            _builtFirstId = 0;
            _builtLastId = 0;
            transform.localPosition = Vector3.zero;
        }

        public void SimTick(float dt)
        {
            EnsureBuilt();
            SimulationSnapshot snapshot = GameManager.I != null ? GameManager.I.CoreSnapshot : null;
            int count = CopyCanyonSlices(snapshot);
            if (count < 2)
            {
                _renderer.enabled = false;
                return;
            }

            SortByZ(count);
            float originZ = _sorted[0].Z;
            bool topologyChanged = count != _builtSliceCount
                || _sorted[0].Id != _builtFirstId
                || _sorted[count - 1].Id != _builtLastId;
            if (topologyChanged)
            {
                RebuildMesh(count, originZ);
                _builtSliceCount = count;
                _builtFirstId = _sorted[0].Id;
                _builtLastId = _sorted[count - 1].Id;
            }

            // Every core sample advances by the same distance, so the complete
            // canyon can move rigidly after its one-time construction.
            transform.localPosition = new Vector3(0f, 0f, originZ);
            if (_runtimeMaterial != null)
            {
                _runtimeMaterial.SetFloat(BrightnessId, Brightness);
                _runtimeMaterial.SetFloat(EmissionId, Emission);
                _runtimeMaterial.SetFloat(FadeStartId, FadeStartZ);
                _runtimeMaterial.SetFloat(FadeEndId, FadeEndZ);
            }
            _renderer.enabled = true;
        }

        int CopyCanyonSlices(SimulationSnapshot snapshot)
        {
            if (snapshot == null) return 0;
            int count = 0;
            for (int i = 0; i < snapshot.CorridorSliceCount && count < MaximumSlices; i++)
            {
                CorridorSliceSnapshot slice = snapshot.GetCorridorSlice(i);
                if (slice.Family != CorridorFamily.CrystallineCanyon) continue;
                _sorted[count++] = slice;
            }
            return count;
        }

        void SortByZ(int count)
        {
            for (int i = 1; i < count; i++)
            {
                CorridorSliceSnapshot value = _sorted[i];
                int j = i - 1;
                while (j >= 0 && _sorted[j].Z > value.Z)
                {
                    _sorted[j + 1] = _sorted[j];
                    j--;
                }
                _sorted[j + 1] = value;
            }
        }

        void RebuildMesh(int sliceCount, float originZ)
        {
            _vertices.Clear();
            _uv.Clear();
            _colors.Clear();
            _triangles.Clear();

            int intervalCount = sliceCount - 1;
            int columnCount = intervalCount * LongitudinalSegmentsPerSlice + 1;
            var inner = new Vector3[2, columnCount, VerticalSegments + 1];
            var outer = new Vector3[2, columnCount, VerticalSegments + 1];

            for (int column = 0; column < columnCount; column++)
            {
                int interval = Mathf.Min(intervalCount - 1, column / LongitudinalSegmentsPerSlice);
                int localColumn = column - interval * LongitudinalSegmentsPerSlice;
                float t = localColumn / (float)LongitudinalSegmentsPerSlice;
                CorridorSliceSnapshot a = _sorted[interval];
                CorridorSliceSnapshot b = _sorted[interval + 1];
                float center = Mathf.Lerp(a.CenterX, b.CenterX, t);
                float halfWidth = Mathf.Lerp(a.HalfWidth, b.HalfWidth, t);
                float z = Mathf.Lerp(a.Z, b.Z, t) - originZ;

                for (int sideIndex = 0; sideIndex < 2; sideIndex++)
                {
                    int side = sideIndex == 0 ? -1 : 1;
                    for (int vertical = 0; vertical <= VerticalSegments; vertical++)
                    {
                        float v = vertical / (float)VerticalSegments;
                        float profile = WallProfile(v);
                        float jitter = SignedHash(column, vertical, sideIndex) * Displacement;
                        if (v > .8f)
                            jitter += SignedHash(column + 173, vertical + 41, sideIndex) * Displacement
                                * ((v - .8f) / .2f);
                        float snappedProfile = Mathf.Round((profile + jitter) * Snap) / Snap;
                        float y = v * WallHeight;
                        if (v > .85f)
                            y += SignedHash(column + 307, vertical + 89, sideIndex) * WallHeight * .09f;
                        y = Mathf.Round(y * 1.5f) / 1.5f;

                        inner[sideIndex, column, vertical] = new Vector3(
                            center + side * (halfWidth + snappedProfile), y, z);
                        outer[sideIndex, column, vertical] = new Vector3(
                            center + side * (halfWidth + WallThickness), y, z);
                    }
                }
            }

            for (int sideIndex = 0; sideIndex < 2; sideIndex++)
            {
                for (int interval = 0; interval < intervalCount; interval++)
                {
                    for (int local = 0; local < LongitudinalSegmentsPerSlice; local++)
                    {
                        int c0 = interval * LongitudinalSegmentsPerSlice + local;
                        int c1 = c0 + 1;
                        float u0 = interval + local / (float)LongitudinalSegmentsPerSlice;
                        float u1 = interval + (local + 1) / (float)LongitudinalSegmentsPerSlice;

                        for (int vertical = 0; vertical < VerticalSegments; vertical++)
                        {
                            float v0 = vertical / (float)VerticalSegments;
                            float v1 = (vertical + 1) / (float)VerticalSegments;
                            AddQuad(
                                inner[sideIndex, c0, vertical], inner[sideIndex, c0, vertical + 1],
                                inner[sideIndex, c1, vertical], inner[sideIndex, c1, vertical + 1],
                                new Vector2(u0, v0), new Vector2(u0, v1),
                                new Vector2(u1, v0), new Vector2(u1, v1), 1f);
                            AddQuad(
                                outer[sideIndex, c1, vertical], outer[sideIndex, c1, vertical + 1],
                                outer[sideIndex, c0, vertical], outer[sideIndex, c0, vertical + 1],
                                new Vector2(u1, v0), new Vector2(u1, v1),
                                new Vector2(u0, v0), new Vector2(u0, v1), .70f);
                        }

                        AddQuad(
                            inner[sideIndex, c0, 0], outer[sideIndex, c0, 0],
                            inner[sideIndex, c1, 0], outer[sideIndex, c1, 0],
                            new Vector2(u0, 0f), new Vector2(u0, 1f),
                            new Vector2(u1, 0f), new Vector2(u1, 1f), .78f);
                        AddQuad(
                            inner[sideIndex, c1, VerticalSegments], outer[sideIndex, c1, VerticalSegments],
                            inner[sideIndex, c0, VerticalSegments], outer[sideIndex, c0, VerticalSegments],
                            new Vector2(u1, 0f), new Vector2(u1, 1f),
                            new Vector2(u0, 0f), new Vector2(u0, 1f), .82f);
                    }
                }

                for (int end = 0; end < 2; end++)
                {
                    int column = end == 0 ? 0 : columnCount - 1;
                    float u = end == 0 ? 0f : intervalCount;
                    for (int vertical = 0; vertical < VerticalSegments; vertical++)
                    {
                        float v0 = vertical / (float)VerticalSegments;
                        float v1 = (vertical + 1) / (float)VerticalSegments;
                        AddQuad(
                            inner[sideIndex, column, vertical], outer[sideIndex, column, vertical],
                            inner[sideIndex, column, vertical + 1], outer[sideIndex, column, vertical + 1],
                            new Vector2(u, v0), new Vector2(u + 1f, v0),
                            new Vector2(u, v1), new Vector2(u + 1f, v1), .80f);
                    }
                }
            }

            _mesh.Clear(false);
            _mesh.SetVertices(_vertices);
            _mesh.SetUVs(0, _uv);
            _mesh.SetColors(_colors);
            _mesh.SetTriangles(_triangles, 0, false);
            float depth = Mathf.Max(1f, _sorted[sliceCount - 1].Z - originZ);
            _mesh.bounds = new Bounds(
                new Vector3(0f, WallHeight * .5f, depth * .5f),
                new Vector3(520f, WallHeight + 30f, depth + 40f));
        }

        void AddQuad(
            Vector3 a, Vector3 b, Vector3 c, Vector3 d,
            Vector2 uvA, Vector2 uvB, Vector2 uvC, Vector2 uvD,
            float shade)
        {
            AddTriangle(a, b, c, uvA, uvB, uvC, shade);
            AddTriangle(c, b, d, uvC, uvB, uvD, shade);
        }

        void AddTriangle(
            Vector3 a, Vector3 b, Vector3 c,
            Vector2 uvA, Vector2 uvB, Vector2 uvC,
            float shade)
        {
            int first = _vertices.Count;
            _vertices.Add(a); _vertices.Add(b); _vertices.Add(c);
            _uv.Add(uvA); _uv.Add(uvB); _uv.Add(uvC);
            Color tint = new Color(shade, shade, shade, 1f);
            _colors.Add(tint); _colors.Add(tint); _colors.Add(tint);
            _triangles.Add(first); _triangles.Add(first + 1); _triangles.Add(first + 2);
        }

        // Exact knife-arches profile from the Three.js L3/L4 recreation preset.
        static float WallProfile(float v)
        {
            const float foot = 26f;
            const float sweep = 20f;
            const float mid = 0f;
            const float crest = 0f;
            if (v < .15f) return Mathf.Lerp(foot, sweep, v / .15f);
            if (v < .45f) return Mathf.Lerp(sweep, mid, (v - .15f) / .30f);
            if (v < .85f) return Mathf.Lerp(mid, crest, (v - .45f) / .40f);
            return crest;
        }

        static float SignedHash(int column, int vertical, int side)
        {
            unchecked
            {
                uint value = (uint)(column * 73856093)
                    ^ (uint)(vertical * 19349663)
                    ^ (uint)(side * 83492791)
                    ^ 0x9e3779b9u;
                value ^= value >> 16;
                value *= 0x7feb352du;
                value ^= value >> 15;
                return (value & 0xffffu) / 32767.5f - 1f;
            }
        }

        void OnDestroy()
        {
            if (_mesh != null) Destroy(_mesh);
            if (_runtimeMaterial != null) Destroy(_runtimeMaterial);
            if (_cyanSurface != null) Destroy(_cyanSurface);
            if (_darkSurface != null) Destroy(_darkSurface);
        }
    }
}
