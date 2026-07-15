using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Stitches core-owned corridor samples into one continuous vaulted membrane.
    /// It contains no path, collision, spawning, or progression rules.
    /// </summary>
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public sealed class PrismaticTunnelPresenter : MonoBehaviour, ISimSystem
    {
        const int ArcSegments = 20;
        const int MaximumSlices = 96;

        public Material TunnelMaterial;
        public float MinimumArchHeight = 11f;
        public float MaximumArchHeight = 22f;

        readonly CorridorSliceSnapshot[] _sorted = new CorridorSliceSnapshot[MaximumSlices];
        readonly Vector3[] _vertices = new Vector3[MaximumSlices * (ArcSegments + 1)];
        readonly Vector3[] _normals = new Vector3[MaximumSlices * (ArcSegments + 1)];
        readonly Vector2[] _uv = new Vector2[MaximumSlices * (ArcSegments + 1)];
        readonly int[] _triangles = new int[(MaximumSlices - 1) * ArcSegments * 6];

        Mesh _mesh;
        MeshRenderer _renderer;
        Material _runtimeMaterial;
        static readonly int TimeValueId = Shader.PropertyToID("_TimeValue");

        void Awake() => EnsureBuilt();

        void EnsureBuilt()
        {
            if (_mesh != null) return;
            _mesh = new Mesh { name = "JH_ContinuousPrismaticTunnel", indexFormat = IndexFormat.UInt32 };
            _mesh.MarkDynamic();
            var filter = GetComponent<MeshFilter>();
            if (filter == null) filter = gameObject.AddComponent<MeshFilter>();
            _renderer = GetComponent<MeshRenderer>();
            if (_renderer == null) _renderer = gameObject.AddComponent<MeshRenderer>();
            filter.sharedMesh = _mesh;
            _renderer.shadowCastingMode = ShadowCastingMode.Off;
            _renderer.receiveShadows = false;
            gameObject.layer = 8;

            if (TunnelMaterial != null) _runtimeMaterial = new Material(TunnelMaterial);
            else
            {
                Shader shader = Shader.Find("JH/PrismaticTunnel");
                if (shader != null) _runtimeMaterial = new Material(shader) { name = "JH_PrismaticTunnel_Runtime" };
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
            int count = CopyPrismaticSlices(snapshot);
            if (count < 2)
            {
                _renderer.enabled = false;
                return;
            }

            SortByZ(count);
            RebuildMesh(count);
            if (_runtimeMaterial != null)
                _runtimeMaterial.SetFloat(TimeValueId, snapshot.Elapsed);
            _renderer.enabled = true;
        }

        int CopyPrismaticSlices(SimulationSnapshot snapshot)
        {
            if (snapshot == null) return 0;
            int count = 0;
            for (int i = 0; i < snapshot.CorridorSliceCount && count < MaximumSlices; i++)
            {
                CorridorSliceSnapshot slice = snapshot.GetCorridorSlice(i);
                if (slice.Family == CorridorFamily.CrystallineCanyon) continue;
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
            int stride = ArcSegments + 1;
            int vertexCount = sliceCount * stride;
            for (int sliceIndex = 0; sliceIndex < sliceCount; sliceIndex++)
            {
                CorridorSliceSnapshot slice = _sorted[sliceIndex];
                float archHeight = Mathf.Clamp(9f + slice.HalfWidth * .20f, MinimumArchHeight, MaximumArchHeight);
                for (int arc = 0; arc <= ArcSegments; arc++)
                {
                    float u = arc / (float)ArcSegments;
                    float angle = Mathf.PI * (1f - u);
                    int vertex = sliceIndex * stride + arc;
                    _vertices[vertex] = new Vector3(
                        slice.CenterX + Mathf.Cos(angle) * slice.HalfWidth,
                        Mathf.Sin(angle) * archHeight,
                        slice.Z);
                    _normals[vertex] = new Vector3(-Mathf.Cos(angle), -Mathf.Sin(angle), 0f).normalized;
                    _uv[vertex] = new Vector2(u, slice.RowIndex * .20f);
                }
            }

            int triangleCount = 0;
            for (int slice = 0; slice < sliceCount - 1; slice++)
            {
                int row = slice * stride;
                int next = row + stride;
                for (int arc = 0; arc < ArcSegments; arc++)
                {
                    _triangles[triangleCount++] = row + arc;
                    _triangles[triangleCount++] = next + arc;
                    _triangles[triangleCount++] = row + arc + 1;
                    _triangles[triangleCount++] = row + arc + 1;
                    _triangles[triangleCount++] = next + arc;
                    _triangles[triangleCount++] = next + arc + 1;
                }
            }

            _mesh.Clear(false);
            _mesh.SetVertices(_vertices, 0, vertexCount);
            _mesh.SetNormals(_normals, 0, vertexCount);
            _mesh.SetUVs(0, _uv, 0, vertexCount);
            _mesh.SetTriangles(_triangles, 0, triangleCount, 0, false);
            _mesh.bounds = new Bounds(Vector3.zero, new Vector3(400f, 80f, 700f));
        }

        void OnDestroy()
        {
            if (_mesh != null) Destroy(_mesh);
            if (_runtimeMaterial != null) Destroy(_runtimeMaterial);
        }
    }
}
