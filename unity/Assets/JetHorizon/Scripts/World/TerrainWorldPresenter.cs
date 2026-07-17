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
            int routeSectionCount = queued
                ? snapshot.QueuedTerrainRouteSectionCount
                : snapshot.TerrainRouteSectionCount;
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

            if (routeSectionCount > 0)
            {
                var routeSections = new List<TerrainRouteSectionSnapshot>(routeSectionCount);
                for (int i = 0; i < routeSectionCount; i++)
                    routeSections.Add(queued
                        ? snapshot.GetQueuedTerrainRouteSection(i)
                        : snapshot.GetTerrainRouteSection(i));
                BuildRouteJunction(built, routeSections);
            }

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

        void BuildRouteJunction(BuiltWorld world, List<TerrainRouteSectionSnapshot> routeSections)
        {
            var safe = new List<TerrainRouteSectionSnapshot>();
            var knife = new List<TerrainRouteSectionSnapshot>();
            var cargo = new List<TerrainRouteSectionSnapshot>();
            for (int i = 0; i < routeSections.Count; i++)
            {
                TerrainRouteSectionSnapshot section = routeSections[i];
                if (section.Kind == TerrainRouteKind.SafeCanyon) safe.Add(section);
                else if (section.Kind == TerrainRouteKind.KnifeEdgeTunnel) knife.Add(section);
                else if (section.Kind == TerrainRouteKind.CargoChannel) cargo.Add(section);
            }
            if (safe.Count < 2 || knife.Count != safe.Count || cargo.Count != safe.Count) return;

            var ordered = new List<List<TerrainRouteSectionSnapshot>> { safe, knife, cargo };
            ordered.Sort((a, b) =>
            {
                float aCenter = (a[0].LeftX + a[0].RightX) * .5f;
                float bCenter = (b[0].LeftX + b[0].RightX) * .5f;
                return aCenter.CompareTo(bCenter);
            });

            // Two geological dividers fill the spaces between the three core-owned
            // passages. Both exposed sides receive the source faceted face, so this
            // reads as one monumental wall with holes rather than obstacle props.
            BuildDivider(world, ordered[0], ordered[1], "Route divider A", 1801);
            BuildDivider(world, ordered[1], ordered[2], "Route divider B", 1907);
            BuildJunctionPortalCrowns(world, ordered);
            BuildKnifeEdgeCrowns(world, knife);
        }

        void BuildJunctionPortalCrowns(
            BuiltWorld world,
            List<List<TerrainRouteSectionSnapshot>> orderedRoutes)
        {
            // At the third station the route mouths have separated enough to read
            // individually. These crowns complete the enormous front wall around
            // each opening; their height is presentation-only, while the route
            // graph remains the authority for the actual passage boundaries.
            const int mouthIndex = 2;
            FacetSurfaceStyle style = FacetSurfaceStyle.ThreeJsSource;
            for (int i = 0; i < orderedRoutes.Count; i++)
            {
                TerrainRouteSectionSnapshot mouth = orderedRoutes[i][mouthIndex];
                float span = mouth.RightX - mouth.LeftX + 9f;
                float center = (mouth.LeftX + mouth.RightX) * .5f;
                Mesh crown = FacetTerrainMeshFactory.BuildThreeJsParitySlab(style, 2011 + i * 41);
                AddMesh(
                    world,
                    "Junction portal crown " + mouth.Kind,
                    crown,
                    new Vector3(center - span * .5f, 56f, -mouth.Distance),
                    Quaternion.Euler(0f, 90f, 0f),
                    new Vector3(.62f, .40f, span / style.Length));
            }
        }

        void BuildDivider(
            BuiltWorld world,
            List<TerrainRouteSectionSnapshot> leftRoute,
            List<TerrainRouteSectionSnapshot> rightRoute,
            string label,
            int seed)
        {
            var leftFace = new List<FacetMassStation>(leftRoute.Count);
            var rightFaceMirrored = new List<FacetMassStation>(leftRoute.Count);
            for (int i = leftRoute.Count - 1; i >= 0; i--)
            {
                TerrainRouteSectionSnapshot left = leftRoute[i];
                TerrainRouteSectionSnapshot right = rightRoute[i];
                float innerLeft = left.RightX;
                float innerRight = right.LeftX;
                // Passage overlap at the entrance/exit becomes a tiny buried seam;
                // once the routes separate, this grows into one continuous terrain
                // mass. It avoids a visible hard pop at the first opening.
                float depth = Mathf.Max(2f, innerRight - innerLeft);
                float height = 84f;
                float z = -left.Distance;
                leftFace.Add(new FacetMassStation(z, innerLeft, height, depth));
                rightFaceMirrored.Add(new FacetMassStation(z, -innerRight, height, depth));
            }
            FacetSurfaceStyle style = FacetSurfaceStyle.ThreeJsSource;
            AddMesh(
                world,
                label + " left face",
                FacetTerrainMeshFactory.BuildMass(leftFace, style, seed, "JH_" + label + "Left"),
                new Vector3(0f, -5f, 0f),
                Quaternion.identity,
                Vector3.one);
            AddMesh(
                world,
                label + " right face",
                FacetTerrainMeshFactory.BuildMass(rightFaceMirrored, style, seed + 47, "JH_" + label + "Right"),
                new Vector3(0f, -5f, 0f),
                Quaternion.identity,
                new Vector3(-1f, 1f, 1f));
        }

        void BuildKnifeEdgeCrowns(BuiltWorld world, List<TerrainRouteSectionSnapshot> knife)
        {
            FacetSurfaceStyle style = FacetSurfaceStyle.ThreeJsSource;
            for (int i = 1; i < knife.Count - 1; i++)
            {
                TerrainRouteSectionSnapshot section = knife[i];
                if (section.CeilingHeight <= 0f || (i & 1) == 0) continue;
                float span = section.RightX - section.LeftX + 10f;
                Mesh crown = FacetTerrainMeshFactory.BuildThreeJsParitySlab(style, 2101 + i * 31);
                AddMesh(
                    world,
                    "Knife-edge tunnel crown " + i,
                    crown,
                    new Vector3(
                        (section.LeftX + section.RightX) * .5f - span * .5f,
                        section.CeilingHeight - 6f,
                        -section.Distance),
                    Quaternion.Euler(0f, 90f, 0f),
                    new Vector3(.52f, .30f, span / style.Length));
            }
        }

        void BuildWaterlineFormation(BuiltWorld world, TerrainWorldFeatureSnapshot feature)
        {
            if (feature.Kind == TerrainWorldFeatureKind.WaterlineSpire)
            {
                // Small grouped facets make open-water navigation feel dense and
                // fast without reverting to the old huge square boulders. Their
                // one core collision footprint remains the authority.
                AddWaterlineSlab(world, feature, "Spire core",
                    feature.CenterX - feature.HalfWidth * .12f, feature.HalfWidth * .54f,
                    feature.Height, feature.CollisionHalfDepth, feature.Seed);
                AddWaterlineSlab(world, feature, "Spire shard",
                    feature.CenterX + feature.HalfWidth * .38f, feature.HalfWidth * .32f,
                    feature.Height * .62f, feature.CollisionHalfDepth * .72f, feature.Seed + 29);
                return;
            }
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
            // Match the original canyon slab language: dark crystal body with a
            // substantial cyan edge contribution. This stays opaque and faceted,
            // but no longer collapses into near-black between sun highlights.
            _material.SetColor("_Body", new Color(.018f, .31f, .39f, 1f));
            _material.SetFloat("_Brightness", 1.08f);
            _material.SetFloat("_Emission", .48f);
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
