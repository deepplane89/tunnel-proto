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
        const int SurfaceCount = 4; // inner + outer shell for both canyon sides

        public Material CanyonMaterial;
        public float WallHeight = 62f;
        public float WallThickness = 8f;
        public float Displacement = 2.6f;
        [Range(0f, 1f)] public float Brightness = 0.72f;
        [Range(0f, 2f)] public float Emission = 0.28f;
        public float FadeStartZ = -305f;
        public float FadeEndZ = -235f;

        readonly CorridorSliceSnapshot[] _sorted = new CorridorSliceSnapshot[MaximumSlices];
        readonly Vector3[] _vertices = new Vector3[MaximumSlices * VerticalStride * SurfaceCount];
        readonly Vector2[] _uv = new Vector2[MaximumSlices * VerticalStride * SurfaceCount];
        readonly Color[] _colors = new Color[MaximumSlices * VerticalStride * SurfaceCount];
        readonly int[] _triangles = new int[
            (MaximumSlices - 1) * VerticalSegments * 6 * SurfaceCount
            + (MaximumSlices - 1) * 6 * 4
            + VerticalSegments * 6 * 4];

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
            // Every core slice advances by the same deterministic distance. Keep
            // the already-built canyon rigid and translate the complete construct
            // rather than regenerating its surface every simulation tick.
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
            int surfaceVertexCount = sliceCount * VerticalStride;
            for (int sideIndex = 0; sideIndex < 2; sideIndex++)
            {
                int side = sideIndex == 0 ? -1 : 1;
                for (int shell = 0; shell < 2; shell++)
                {
                    int surfaceOffset = (sideIndex * 2 + shell) * surfaceVertexCount;
                    for (int sliceIndex = 0; sliceIndex < sliceCount; sliceIndex++)
                    {
                        CorridorSliceSnapshot slice = _sorted[sliceIndex];
                        for (int vertical = 0; vertical <= VerticalSegments; vertical++)
                        {
                            float v = vertical / (float)VerticalSegments;
                            float profile = WallProfile(v);
                            float jitter = SignedHash(slice.RowIndex, vertical) * Displacement * Mathf.Sin(v * Mathf.PI);
                            int vertex = surfaceOffset + sliceIndex * VerticalStride + vertical;
                            _vertices[vertex] = new Vector3(
                                slice.CenterX + side * (slice.HalfWidth + profile + jitter + shell * WallThickness),
                                v * WallHeight,
                                slice.Z - originZ);
                            // One complete copy of the original slab texture spans
                            // each deterministic row; the shader alternates the
                            // original cyan streak and dark magenta-crack surfaces.
                            _uv[vertex] = new Vector2(slice.RowIndex, v);
                            float heightShade = Mathf.Lerp(.58f, 1f, .25f + v * .75f);
                            _colors[vertex] = Color.white * heightShade * (shell == 0 ? 1f : .72f);
                            _colors[vertex].a = 1f;
                        }
                    }
                }
            }

            int triangleCount = 0;
            for (int surface = 0; surface < SurfaceCount; surface++)
            {
                int offset = surface * surfaceVertexCount;
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

            // Close every shell along its waterline and crest. These strips keep
            // the canyon solid at grazing camera angles instead of exposing the
            // infinitely thin edge of the inner wall.
            for (int sideIndex = 0; sideIndex < 2; sideIndex++)
            {
                int inner = sideIndex * 2 * surfaceVertexCount;
                int outer = inner + surfaceVertexCount;
                for (int slice = 0; slice < sliceCount - 1; slice++)
                {
                    int innerRow = inner + slice * VerticalStride;
                    int innerNext = innerRow + VerticalStride;
                    int outerRow = outer + slice * VerticalStride;
                    int outerNext = outerRow + VerticalStride;
                    AddQuad(ref triangleCount, innerRow, outerRow, innerNext, outerNext);
                    AddQuad(ref triangleCount,
                        innerRow + VerticalSegments,
                        innerNext + VerticalSegments,
                        outerRow + VerticalSegments,
                        outerNext + VerticalSegments);
                }

                // Close both streamed ends so looking along a bend cannot reveal
                // the sky through the wall volume.
                for (int end = 0; end < 2; end++)
                {
                    int slice = end == 0 ? 0 : sliceCount - 1;
                    int innerRow = inner + slice * VerticalStride;
                    int outerRow = outer + slice * VerticalStride;
                    for (int vertical = 0; vertical < VerticalSegments; vertical++)
                        AddQuad(ref triangleCount,
                            innerRow + vertical,
                            innerRow + vertical + 1,
                            outerRow + vertical,
                            outerRow + vertical + 1);
                }
            }

            int vertexCount = surfaceVertexCount * SurfaceCount;
            _mesh.Clear(false);
            _mesh.SetVertices(_vertices, 0, vertexCount);
            _mesh.SetUVs(0, _uv, 0, vertexCount);
            _mesh.SetColors(_colors, 0, vertexCount);
            _mesh.SetTriangles(_triangles, 0, triangleCount, 0, false);
            float depth = Mathf.Max(1f, _sorted[sliceCount - 1].Z - originZ);
            _mesh.bounds = new Bounds(
                new Vector3(0f, WallHeight * .5f, depth * .5f),
                new Vector3(440f, WallHeight + 20f, depth + 30f));
        }

        void AddQuad(ref int triangleCount, int a, int b, int c, int d)
        {
            _triangles[triangleCount++] = a;
            _triangles[triangleCount++] = b;
            _triangles[triangleCount++] = c;
            _triangles[triangleCount++] = c;
            _triangles[triangleCount++] = b;
            _triangles[triangleCount++] = d;
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

        void OnDestroy()
        {
            if (_mesh != null) Destroy(_mesh);
            if (_runtimeMaterial != null) Destroy(_runtimeMaterial);
            if (_cyanSurface != null) Destroy(_cyanSurface);
            if (_darkSurface != null) Destroy(_darkSurface);
        }
    }
}
