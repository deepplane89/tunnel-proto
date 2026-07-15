using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Seam-locked Unity projection of core-owned canyon slices. The core owns the
    /// route and collision opening; this component owns only the faceted wall skin.
    /// </summary>
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public sealed class StableCanyonPresenter : MonoBehaviour, ISimSystem
    {
        const int MaximumSlices = 96;
        const int VerticalSegments = 7;
        const int VerticalStride = VerticalSegments + 1;

        public Material CanyonMaterial;
        public float WallHeight = 62f;
        public float Displacement = 2.6f;
        [Range(0f, 1f)] public float Brightness = 0.34f;
        [Range(0f, 2f)] public float Emission = 0.20f;
        public float FadeStartZ = -290f;
        public float FadeEndZ = -155f;

        readonly CorridorSliceSnapshot[] _sorted = new CorridorSliceSnapshot[MaximumSlices];
        readonly Vector3[] _vertices = new Vector3[MaximumSlices * VerticalStride * 2];
        readonly Vector2[] _uv = new Vector2[MaximumSlices * VerticalStride * 2];
        readonly Color[] _colors = new Color[MaximumSlices * VerticalStride * 2];
        readonly int[] _triangles = new int[(MaximumSlices - 1) * VerticalSegments * 6 * 2];

        Mesh _mesh;
        MeshRenderer _renderer;
        Material _runtimeMaterial;

        static readonly int BrightnessId = Shader.PropertyToID("_Brightness");
        static readonly int EmissionId = Shader.PropertyToID("_Emission");
        static readonly int FadeStartId = Shader.PropertyToID("_FadeStart");
        static readonly int FadeEndId = Shader.PropertyToID("_FadeEnd");

        void Awake() => EnsureBuilt();

        void EnsureBuilt()
        {
            if (_mesh != null) return;
            _mesh = new Mesh { name = "JH_StableCrystallineCanyon", indexFormat = IndexFormat.UInt32 };
            _mesh.MarkDynamic();
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
            _renderer.enabled = false;
        }

        public void ResetSystem()
        {
            EnsureBuilt();
            _mesh.Clear(false);
            _renderer.enabled = false;
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
            RebuildMesh(count);
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

        void RebuildMesh(int sliceCount)
        {
            int sideVertexCount = sliceCount * VerticalStride;
            for (int sideIndex = 0; sideIndex < 2; sideIndex++)
            {
                int side = sideIndex == 0 ? -1 : 1;
                int sideOffset = sideIndex * sideVertexCount;
                for (int sliceIndex = 0; sliceIndex < sliceCount; sliceIndex++)
                {
                    CorridorSliceSnapshot slice = _sorted[sliceIndex];
                    Color palette = Palette(slice.RowIndex);
                    for (int vertical = 0; vertical <= VerticalSegments; vertical++)
                    {
                        float v = vertical / (float)VerticalSegments;
                        float profile = WallProfile(v);
                        float jitter = SignedHash(slice.RowIndex, vertical) * Displacement * Mathf.Sin(v * Mathf.PI);
                        int vertex = sideOffset + sliceIndex * VerticalStride + vertical;
                        _vertices[vertex] = new Vector3(
                            slice.CenterX + side * (slice.HalfWidth + profile + jitter),
                            v * WallHeight,
                            slice.Z);
                        _uv[vertex] = new Vector2(v, slice.RowIndex * .33f);
                        _colors[vertex] = Color.Lerp(palette * .32f, palette, .25f + v * .75f);
                    }
                }
            }

            int triangleCount = 0;
            for (int sideIndex = 0; sideIndex < 2; sideIndex++)
            {
                int offset = sideIndex * sideVertexCount;
                for (int slice = 0; slice < sliceCount - 1; slice++)
                {
                    int row = offset + slice * VerticalStride;
                    int next = row + VerticalStride;
                    for (int vertical = 0; vertical < VerticalSegments; vertical++)
                    {
                        _triangles[triangleCount++] = row + vertical;
                        _triangles[triangleCount++] = next + vertical;
                        _triangles[triangleCount++] = row + vertical + 1;
                        _triangles[triangleCount++] = row + vertical + 1;
                        _triangles[triangleCount++] = next + vertical;
                        _triangles[triangleCount++] = next + vertical + 1;
                    }
                }
            }

            int vertexCount = sideVertexCount * 2;
            _mesh.Clear(false);
            _mesh.SetVertices(_vertices, 0, vertexCount);
            _mesh.SetUVs(0, _uv, 0, vertexCount);
            _mesh.SetColors(_colors, 0, vertexCount);
            _mesh.SetTriangles(_triangles, 0, triangleCount, 0, false);
            _mesh.bounds = new Bounds(Vector3.zero, new Vector3(440f, 150f, 760f));
        }

        static float WallProfile(float v)
        {
            if (v < .16f) return Mathf.Lerp(6f, 1.5f, v / .16f);
            if (v < .48f) return Mathf.Lerp(1.5f, 11f, (v - .16f) / .32f);
            if (v < .84f) return Mathf.Lerp(11f, 19f, (v - .48f) / .36f);
            return Mathf.Lerp(19f, 23f, (v - .84f) / .16f);
        }

        static float SignedHash(int row, int vertical)
        {
            unchecked
            {
                uint value = (uint)(row * 73856093) ^ (uint)(vertical * 19349663) ^ 0x9e3779b9u;
                value ^= value >> 16;
                value *= 0x7feb352du;
                value ^= value >> 15;
                return (value & 0xffffu) / 32767.5f - 1f;
            }
        }

        static Color Palette(int row)
        {
            switch (Mathf.Abs(row / 3) % 3)
            {
                case 0: return new Color(.05f, .58f, .72f, 1f);
                case 1: return new Color(.38f, .10f, .62f, 1f);
                default: return new Color(.08f, .24f, .58f, 1f);
            }
        }

        void OnDestroy()
        {
            if (_mesh != null) Destroy(_mesh);
            if (_runtimeMaterial != null) Destroy(_runtimeMaterial);
        }
    }
}
