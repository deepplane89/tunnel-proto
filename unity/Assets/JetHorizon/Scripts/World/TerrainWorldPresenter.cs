using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Builds the complete world as two continuous landmasses. Shoreline topology
    /// comes from the engine-neutral snapshot; Unity owns only mesh and material work.
    /// No terrain piece is spawned, pooled or revealed at an encounter boundary.
    /// </summary>
    public sealed class TerrainWorldPresenter : MonoBehaviour, ISimSystem
    {
        sealed class BuiltWorld
        {
            public string Id;
            public float StartDistance;
            public Transform Root;
            public readonly List<Mesh> Meshes = new List<Mesh>(4);
        }

        const int ReflectableLayer = 8;
        BuiltWorld _current;
        BuiltWorld _queued;
        Material _material;
        Texture2D _surface;

        public string BuiltWorldId => _current?.Id ?? string.Empty;
        public int BuiltMeshCount => _current?.Meshes.Count ?? 0;

        public void ResetSystem()
        {
            ClearWorld(ref _current);
            ClearWorld(ref _queued);
        }

        public void SimTick(float dt)
        {
            SimulationSnapshot snapshot = GameManager.I != null ? GameManager.I.CoreSnapshot : null;
            if (snapshot == null || !snapshot.TerrainWorldMode)
            {
                SetActive(_current, false);
                SetActive(_queued, false);
                return;
            }

            if (_current == null || _current.Id != snapshot.TerrainWorldId)
            {
                if (_queued != null && _queued.Id == snapshot.TerrainWorldId)
                {
                    ClearWorld(ref _current);
                    _current = _queued;
                    _queued = null;
                }
                else
                {
                    ClearWorld(ref _current);
                    _current = BuildWorld(snapshot, false);
                }
            }

            string queuedId = snapshot.QueuedTerrainWorldId ?? string.Empty;
            if (!string.IsNullOrEmpty(queuedId)
                && queuedId != snapshot.TerrainWorldId
                && (_queued == null || _queued.Id != queuedId))
            {
                ClearWorld(ref _queued);
                _queued = BuildWorld(snapshot, true);
            }

            PositionWorld(_current, snapshot);
            PositionWorld(_queued, snapshot);
        }

        BuiltWorld BuildWorld(SimulationSnapshot snapshot, bool queued)
        {
            EnsureMaterial();
            string id = queued ? snapshot.QueuedTerrainWorldId : snapshot.TerrainWorldId;
            int sectionCount = queued
                ? snapshot.QueuedTerrainWorldSectionCount
                : snapshot.TerrainWorldSectionCount;
            int featureCount = queued
                ? snapshot.QueuedTerrainWorldFeatureCount
                : snapshot.TerrainWorldFeatureCount;
            if (string.IsNullOrEmpty(id) || sectionCount < 2) return null;

            var built = new BuiltWorld
            {
                Id = id,
                StartDistance = queued
                    ? snapshot.QueuedTerrainWorldStartDistance
                    : snapshot.TerrainWorldStartDistance,
                Root = new GameObject("Persistent Terrain World " + id).transform
            };
            built.Root.gameObject.layer = ReflectableLayer;
            built.Root.SetParent(transform, false);

            var rightShore = new List<FacetMassStation>(sectionCount);
            var leftShoreMirrored = new List<FacetMassStation>(sectionCount);
            for (int i = sectionCount - 1; i >= 0; i--)
            {
                TerrainWorldSectionSnapshot section = queued
                    ? snapshot.GetQueuedTerrainWorldSection(i)
                    : snapshot.GetTerrainWorldSection(i);
                float localZ = -section.Distance;
                rightShore.Add(new FacetMassStation(
                    localZ,
                    section.RightShoreX,
                    section.RightHeight,
                    section.RightDepth,
                    1f));
                leftShoreMirrored.Add(new FacetMassStation(
                    localZ,
                    -section.LeftShoreX,
                    section.LeftHeight,
                    section.LeftDepth,
                    1f));
            }

            Mesh rightMesh = FacetTerrainMeshFactory.BuildMass(
                rightShore,
                FacetSurfaceStyle.ThreeJsSource,
                911,
                "JH_CompleteWorldRightShore");
            Mesh leftMesh = FacetTerrainMeshFactory.BuildMass(
                leftShoreMirrored,
                FacetSurfaceStyle.ThreeJsSource,
                977,
                "JH_CompleteWorldLeftShore");
            AddMesh(
                built,
                "Right continuous terrain",
                rightMesh,
                new Vector3(0f, -5f, 0f),
                Quaternion.identity,
                Vector3.one);
            AddMesh(
                built,
                "Left continuous terrain",
                leftMesh,
                new Vector3(0f, -5f, 0f),
                Quaternion.identity,
                new Vector3(-1f, 1f, 1f));

            for (int i = 0; i < featureCount; i++)
            {
                TerrainWorldFeatureSnapshot feature = queued
                    ? snapshot.GetQueuedTerrainWorldFeature(i)
                    : snapshot.GetTerrainWorldFeature(i);
                if (feature.Kind == TerrainWorldFeatureKind.NaturalArch)
                    BuildNaturalArch(built, feature);
                else if (TerrainWorldFeatureRules.IsWaterFormation(feature.Kind))
                    BuildWaterlineFormation(built, feature);
            }
            return built;
        }

        void BuildWaterlineFormation(BuiltWorld world, TerrainWorldFeatureSnapshot feature)
        {
            if (feature.Kind == TerrainWorldFeatureKind.WaterlineMonolith)
            {
                AddWaterlineSlab(
                    world, feature, "Monolith", feature.CenterX, feature.HalfWidth,
                    feature.Height, feature.CollisionHalfDepth, feature.Seed);
                return;
            }
            if (feature.Kind == TerrainWorldFeatureKind.WaterlineRidge)
            {
                float width = feature.HalfWidth * .58f;
                AddWaterlineSlab(world, feature, "Ridge left",
                    feature.CenterX - feature.HalfWidth * .42f, width,
                    feature.Height * .72f, feature.CollisionHalfDepth, feature.Seed);
                AddWaterlineSlab(world, feature, "Ridge crest",
                    feature.CenterX, width,
                    feature.Height, feature.CollisionHalfDepth, feature.Seed + 11);
                AddWaterlineSlab(world, feature, "Ridge right",
                    feature.CenterX + feature.HalfWidth * .42f, width,
                    feature.Height * .80f, feature.CollisionHalfDepth, feature.Seed + 23);
                return;
            }

            float clusterWidth = feature.HalfWidth * .72f;
            AddWaterlineSlab(world, feature, "Cluster primary",
                feature.CenterX - feature.HalfWidth * .28f, clusterWidth,
                feature.Height, feature.CollisionHalfDepth, feature.Seed);
            AddWaterlineSlab(world, feature, "Cluster shoulder",
                feature.CenterX + feature.HalfWidth * .30f, clusterWidth,
                feature.Height * .68f, feature.CollisionHalfDepth * .88f, feature.Seed + 17);
        }

        void AddWaterlineSlab(
            BuiltWorld world,
            TerrainWorldFeatureSnapshot feature,
            string label,
            float centerX,
            float halfWidth,
            float height,
            float halfDepth,
            int seed)
        {
            FacetSurfaceStyle style = FacetSurfaceStyle.ThreeJsSource;
            Mesh mass = FacetTerrainMeshFactory.BuildThreeJsParitySlab(style, seed);
            AddMesh(
                world,
                label + " " + feature.Id,
                mass,
                new Vector3(centerX - halfWidth, -7f, -feature.Distance + halfDepth),
                Quaternion.Euler(0f, 90f, 0f),
                new Vector3(
                    halfDepth * 2f / style.Depth,
                    height / style.Height,
                    halfWidth * 2f / style.Length));
        }

        void BuildNaturalArch(BuiltWorld world, TerrainWorldFeatureSnapshot feature)
        {
            // The supporting cliffs are the continuous shore meshes. This is only
            // their connecting crown, so the arch reads as one geological structure
            // instead of two pillars and a prop placed between them.
            Mesh crown = FacetTerrainMeshFactory.BuildThreeJsParitySlab(
                FacetSurfaceStyle.ThreeJsSource,
                feature.Seed);
            float span = feature.HalfWidth * 2f + 9f;
            AddMesh(
                world,
                "Natural arch crown",
                crown,
                new Vector3(
                    feature.CenterX - span * .5f,
                    feature.Height * .70f - 5f,
                    -feature.Distance),
                Quaternion.Euler(0f, 90f, 0f),
                new Vector3(.48f, .38f, span / FacetSurfaceStyle.ThreeJsSource.Length));
        }

        void EnsureMaterial()
        {
            if (_material != null) return;
            Shader shader = Shader.Find("JH/FacetTerrain");
            if (shader == null) return;
            _material = new Material(shader) { name = "JH_ContinuousTerrainWorld" };
            _surface = TextureFactory.CyanSlab();
            _surface.name = "JH_ContinuousTerrainSurface";
            _surface.wrapMode = TextureWrapMode.Repeat;
            _material.SetTexture("_Surface", _surface);
            _material.SetColor("_Body", new Color(.045f, .24f, .30f, 1f));
            _material.SetFloat("_Brightness", .80f);
            _material.SetFloat("_Emission", .14f);
        }

        void AddMesh(
            BuiltWorld world,
            string name,
            Mesh mesh,
            Vector3 position,
            Quaternion rotation,
            Vector3 scale)
        {
            world.Meshes.Add(mesh);
            var child = new GameObject(name);
            child.layer = ReflectableLayer;
            child.transform.SetParent(world.Root, false);
            child.transform.localPosition = position;
            child.transform.localRotation = rotation;
            child.transform.localScale = scale;
            child.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = child.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = _material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
        }

        static void SetActive(BuiltWorld world, bool active)
        {
            if (world?.Root != null) world.Root.gameObject.SetActive(active);
        }

        static void PositionWorld(BuiltWorld world, SimulationSnapshot snapshot)
        {
            if (world?.Root == null) return;
            world.Root.gameObject.SetActive(true);
            world.Root.position = new Vector3(
                0f,
                0f,
                snapshot.ShipZ + snapshot.Distance - world.StartDistance);
        }

        static void ClearWorld(ref BuiltWorld world)
        {
            if (world == null) return;
            if (world.Root != null)
            {
                if (UnityEngine.Application.isPlaying) Destroy(world.Root.gameObject);
                else DestroyImmediate(world.Root.gameObject);
            }
            for (int i = 0; i < world.Meshes.Count; i++)
            {
                if (world.Meshes[i] == null) continue;
                if (UnityEngine.Application.isPlaying) Destroy(world.Meshes[i]);
                else DestroyImmediate(world.Meshes[i]);
            }
            world.Meshes.Clear();
            world = null;
        }

        void OnDestroy()
        {
            ClearWorld(ref _current);
            ClearWorld(ref _queued);
            if (_material != null) Destroy(_material);
            if (_surface != null) Destroy(_surface);
        }
    }
}
