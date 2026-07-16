using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Builds the complete core-authored prismatic encounter once, then moves that
    /// immutable membrane as one world object. Gameplay collision remains core-owned;
    /// presentation no longer follows the core's short-lived streaming slice window.
    /// </summary>
    [RequireComponent(typeof(MeshFilter), typeof(MeshRenderer))]
    public sealed class PrismaticTunnelPresenter : MonoBehaviour, ISimSystem
    {
        const int ArcSegments = 20;
        const float RearExtension = 140f;

        public Material TunnelMaterial;
        public float MinimumArchHeight = 11f;
        public float MaximumArchHeight = 22f;

        Mesh _mesh;
        MeshRenderer _renderer;
        Material _runtimeMaterial;
        EncounterPlan _plan;
        static readonly int TimeValueId = Shader.PropertyToID("_TimeValue");

        public bool IsPresenting { get; private set; }
        public int BuiltCrossSectionCount { get; private set; }

        void Awake() => EnsureBuilt();

        void EnsureBuilt()
        {
            if (_mesh != null) return;
            _plan = FindPlan();
            if (_plan == null) return;

            _mesh = BuildCompleteMesh(_plan);
            var filter = GetComponent<MeshFilter>() ?? gameObject.AddComponent<MeshFilter>();
            _renderer = GetComponent<MeshRenderer>() ?? gameObject.AddComponent<MeshRenderer>();
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
            IsPresenting = false;
            if (_renderer != null) _renderer.enabled = false;
            transform.localPosition = Vector3.zero;
        }

        public void SimTick(float dt)
        {
            EnsureBuilt();
            SimulationSnapshot snapshot = GameManager.I != null ? GameManager.I.CoreSnapshot : null;
            if (_renderer == null || snapshot == null || !snapshot.CoreWorldDirectorEnabled)
            {
                SetVisible(false);
                return;
            }

            bool current = snapshot.EncounterKind == EncounterKind.PrismaticSineCorridor;
            bool upcoming = snapshot.UpcomingEncounterKind == EncounterKind.PrismaticSineCorridor;
            if (!current && !upcoming)
            {
                SetVisible(false);
                return;
            }

            float startZ = current ? snapshot.EncounterStartZ : snapshot.UpcomingEncounterStartZ;
            transform.localPosition = new Vector3(0f, 0f, startZ);
            if (_runtimeMaterial != null) _runtimeMaterial.SetFloat(TimeValueId, snapshot.Elapsed);
            SetVisible(true);
        }

        void SetVisible(bool visible)
        {
            IsPresenting = visible;
            if (_renderer != null) _renderer.enabled = visible;
        }

        EncounterPlan FindPlan()
        {
            EncounterPlan live = GameManager.I != null
                ? GameManager.I.GetProofEncounterPlan(EncounterKind.PrismaticSineCorridor)
                : null;
            if (live != null) return live;
            EncounterPlan[] fallback = EncounterPlanCatalog.CreateProofSequence();
            for (int i = 0; i < fallback.Length; i++)
                if (fallback[i].Kind == EncounterKind.PrismaticSineCorridor) return fallback[i];
            return null;
        }

        Mesh BuildCompleteMesh(EncounterPlan plan)
        {
            // One approach section plus every core opening plus a rear sleeve that
            // remains behind the camera after the gameplay boundary has passed.
            BuiltCrossSectionCount = plan.OpeningCount + 2;
            int stride = ArcSegments + 1;
            var vertices = new Vector3[BuiltCrossSectionCount * stride];
            var normals = new Vector3[vertices.Length];
            var uv = new Vector2[vertices.Length];
            var triangles = new int[(BuiltCrossSectionCount - 1) * ArcSegments * 6];

            EncounterOpening first = plan.GetOpening(0);
            EncounterOpening last = plan.GetOpening(plan.OpeningCount - 1);
            for (int section = 0; section < BuiltCrossSectionCount; section++)
            {
                float distance;
                float center;
                float halfWidth;
                if (section == 0)
                {
                    distance = 0f;
                    center = first.CenterX;
                    halfWidth = first.HalfWidth;
                }
                else if (section == BuiltCrossSectionCount - 1)
                {
                    distance = plan.Length + RearExtension;
                    center = last.CenterX;
                    halfWidth = last.HalfWidth;
                }
                else
                {
                    EncounterOpening opening = plan.GetOpening(section - 1);
                    distance = opening.Distance;
                    center = opening.CenterX;
                    halfWidth = opening.HalfWidth;
                }

                float archHeight = Mathf.Clamp(9f + halfWidth * .20f, MinimumArchHeight, MaximumArchHeight);
                for (int arc = 0; arc <= ArcSegments; arc++)
                {
                    float u = arc / (float)ArcSegments;
                    float angle = Mathf.PI * (1f - u);
                    int vertex = section * stride + arc;
                    vertices[vertex] = new Vector3(
                        center + Mathf.Cos(angle) * halfWidth,
                        Mathf.Sin(angle) * archHeight,
                        -distance);
                    normals[vertex] = new Vector3(-Mathf.Cos(angle), -Mathf.Sin(angle), 0f).normalized;
                    uv[vertex] = new Vector2(u, distance / 70f);
                }
            }

            int triangle = 0;
            for (int section = 0; section < BuiltCrossSectionCount - 1; section++)
            {
                int row = section * stride;
                int next = row + stride;
                for (int arc = 0; arc < ArcSegments; arc++)
                {
                    triangles[triangle++] = row + arc;
                    triangles[triangle++] = next + arc;
                    triangles[triangle++] = row + arc + 1;
                    triangles[triangle++] = row + arc + 1;
                    triangles[triangle++] = next + arc;
                    triangles[triangle++] = next + arc + 1;
                }
            }

            var mesh = new Mesh { name = "JH_PersistentPrismaticTunnel", indexFormat = IndexFormat.UInt32 };
            mesh.vertices = vertices;
            mesh.normals = normals;
            mesh.uv = uv;
            mesh.triangles = triangles;
            mesh.RecalculateBounds();
            return mesh;
        }

        void OnDestroy()
        {
            if (_mesh != null) Destroy(_mesh);
            if (_runtimeMaterial != null) Destroy(_runtimeMaterial);
        }
    }
}
