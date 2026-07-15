using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Builds the complete crystalline canyon once, then scrolls the entire construct
    /// against a core-owned route sample. Opaque curved shells supply the complete
    /// corridor; optional Terrain can later add broad world mass behind those shells.
    /// No TerrainCollider is active: the engine-neutral corridor remains the only lethal
    /// boundary, so presentation can never create an unvalidated or invisible collision.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class HybridCanyonWorldPresenter : MonoBehaviour, ISimSystem
    {
        public HybridCanyonWorldProfile Profile;
        public Material CanyonMaterial;

        public bool IsPresenting { get; private set; }
        public Terrain GeneratedTerrain { get; private set; }
        public Transform WorldContent => _content != null ? _content.transform : null;

        readonly List<UnityEngine.Object> _ownedAssets = new List<UnityEngine.Object>();
        EncounterPlan _plan;
        CanyonRouteSampler _route;
        GameObject _content;
        Material _meshMaterial;
        bool _terrainAuthoringPreview;

        void Awake()
        {
            if (Profile == null) Profile = Resources.Load<HybridCanyonWorldProfile>("HybridCanyonWorld");
        }

        void OnDrawGizmosSelected()
        {
            if (_route == null || Profile == null || Profile.Settings == null || !Profile.Settings.ShowSafeRouteGizmo) return;
            Transform origin = _content != null ? _content.transform : transform;
            Gizmos.color = new Color(.05f, 1f, 1f, .9f);
            CanyonRouteFrame previous = _route.Sample(0f);
            for (float distance = 8f; distance <= _route.Length; distance += 8f)
            {
                CanyonRouteFrame current = _route.Sample(distance);
                Gizmos.DrawLine(origin.TransformPoint(previous.Center), origin.TransformPoint(current.Center));
                Gizmos.DrawLine(
                    origin.TransformPoint(current.Center - current.Right * current.HalfWidth),
                    origin.TransformPoint(current.Center + current.Right * current.HalfWidth));
                previous = current;
            }
        }

        void OnDestroy() => ReleaseWorld(!UnityEngine.Application.isPlaying);

        public void ResetSystem()
        {
            IsPresenting = false;
            if (_content != null) _content.SetActive(false);
        }

        public void SimTick(float dt)
        {
            SimulationSnapshot snapshot = GameManager.I != null ? GameManager.I.CoreSnapshot : null;
            if (snapshot == null || !snapshot.ProofEncounterMode)
            {
                SetVisible(false);
                return;
            }

            bool currentCanyon = snapshot.EncounterKind == EncounterKind.CrystallineCanyon;
            bool upcomingCanyon = snapshot.UpcomingEncounterKind == EncounterKind.CrystallineCanyon;
            if (!currentCanyon && !upcomingCanyon)
            {
                SetVisible(false);
                return;
            }

            EnsureBuilt();
            if (_content == null || _plan == null)
            {
                SetVisible(false);
                return;
            }

            // Drive the complete landform from the plan's stable world origin. The old
            // row-derived anchor changed whenever the nearest streamed row changed,
            // making a stationary canyon visibly jump even though its route was valid.
            float startZ = currentCanyon ? snapshot.EncounterStartZ : snapshot.UpcomingEncounterStartZ;
            _content.transform.localPosition = new Vector3(0f, 0f, startZ);
            SetVisible(true);
        }

        /// <summary>Editor preview seam; it does not alter scene gameplay wiring.</summary>
        public void RebuildForEditorPreview()
        {
            ReleaseWorld(true);
            _terrainAuthoringPreview = true;
            EnsureBuilt();
            if (_content != null)
            {
                _content.transform.localPosition = Vector3.zero;
                _content.SetActive(true);
                IsPresenting = true;
            }
        }

        void SetVisible(bool visible)
        {
            IsPresenting = visible;
            if (_content != null && _content.activeSelf != visible) _content.SetActive(visible);
        }

        void EnsureBuilt()
        {
            if (_content != null) return;
            _plan = FindCanyonPlan(Profile);
            if (_plan == null) return;

            HybridCanyonWorldSettings settings = Profile != null && Profile.Settings != null
                ? Profile.Settings
                : new HybridCanyonWorldSettings();
            _route = new CanyonRouteSampler(_plan, settings);
            Material requested = Profile != null && Profile.CanyonMaterial != null
                ? Profile.CanyonMaterial
                : CanyonMaterial;

            _content = new GameObject("Hybrid Canyon World Content");
            _content.transform.SetParent(transform, false);
            _meshMaterial = requested != null ? requested : CreateFallbackCanyonMaterial();
            if (!_terrainAuthoringPreview && Profile != null && Profile.BakedWorldPrefab != null)
            {
                GameObject baked = Instantiate(Profile.BakedWorldPrefab, _content.transform);
                baked.name = Profile.BakedWorldPrefab.name;
                if (!settings.BuildTerrainBacking)
                {
                    Transform terrainChunks = FindDescendantByName(baked.transform, "Baked Terrain Mesh Chunks");
                    if (terrainChunks != null) terrainChunks.gameObject.SetActive(false);
                    Terrain bakedTerrain = baked.GetComponentInChildren<Terrain>(true);
                    if (bakedTerrain != null) bakedTerrain.gameObject.SetActive(false);
                }
                _content.SetActive(false);
                return;
            }
            if (settings.BuildTerrainBacking) BuildTerrain(settings);
            BuildHeroMeshes(settings);
            _content.SetActive(false);
        }

        static Transform FindDescendantByName(Transform root, string targetName)
        {
            if (root == null) return null;
            if (root.name == targetName) return root;
            for (int i = 0; i < root.childCount; i++)
            {
                Transform found = FindDescendantByName(root.GetChild(i), targetName);
                if (found != null) return found;
            }
            return null;
        }

        static EncounterPlan FindCanyonPlan(HybridCanyonWorldProfile profile)
        {
            EncounterPlan livePlan = GameManager.I != null
                ? GameManager.I.GetProofEncounterPlan(EncounterKind.CrystallineCanyon)
                : null;
            if (livePlan != null) return livePlan;
            EncounterPlan[] plans = EncounterPlanCatalog.CreateProofSequence(
                1f,
                profile != null ? profile.BuildCorePathDefinition() : null);
            for (int i = 0; i < plans.Length; i++)
                if (plans[i].Kind == EncounterKind.CrystallineCanyon) return plans[i];
            return null;
        }

        void BuildTerrain(HybridCanyonWorldSettings settings)
        {
            int resolution = ValidHeightmapResolution(settings.HeightmapResolution);
            float routeLength = _plan.Length;
            float depth = settings.ApproachLength + routeLength + settings.RearLength;
            float originZ = -routeLength - settings.RearLength;

            var data = new TerrainData
            {
                name = "JH_HybridCanyonTerrainData",
                heightmapResolution = resolution,
                baseMapResolution = 128,
                size = new Vector3(settings.TerrainWidth, settings.TerrainHeight, depth)
            };
            _ownedAssets.Add(data);

            var heights = new float[resolution, resolution];
            float halfTerrain = settings.TerrainWidth * .5f;
            FindPhaseDistances(_plan, out float convergenceStart, out float threshold, out float breakupStart, out float routeEnd);
            for (int z = 0; z < resolution; z++)
            {
                float z01 = z / (float)(resolution - 1);
                float localZ = originZ + depth * z01;
                float distance = -localZ;
                CanyonRouteFrame routeFrame = _route.Sample(distance);
                float center = routeFrame.Center.x;
                float halfWidth = routeFrame.HalfWidth;

                for (int x = 0; x < resolution; x++)
                {
                    float x01 = x / (float)(resolution - 1);
                    float localX = Mathf.Lerp(-halfTerrain, halfTerrain, x01);
                    float outside = Mathf.Abs(localX - center) - halfWidth;
                    float enclosure = EnclosureAtDistance(localZ * -1f, convergenceStart, threshold, breakupStart, routeEnd);
                    float shoulder = Mathf.Max(.1f, CanyonRouteSampler.Evaluate(
                        settings.TerrainShoulderByProgress,
                        Mathf.Clamp01(distance / Mathf.Max(1f, routeLength)),
                        1f));
                    float bank = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(outside / (settings.BankRiseWidth * shoulder))) * enclosure;
                    float noise = FractalNoise(localX, localZ, settings) * settings.SurfaceNoise * bank;
                    float worldHeight = settings.TerrainBaseY + bank * settings.BankHeight + noise;
                    heights[z, x] = Mathf.Clamp01((worldHeight - settings.TerrainBaseY) / settings.TerrainHeight);
                }
            }
            data.SetHeights(0, 0, heights);

            Texture2D surfaceTexture = ResolveSurfaceTexture(_meshMaterial);
            var layer = new TerrainLayer
            {
                name = "JH_HybridCanyonSurface",
                diffuseTexture = surfaceTexture,
                tileSize = new Vector2(28f, 28f),
                metallic = 0f,
                smoothness = .45f
            };
            _ownedAssets.Add(layer);
            data.terrainLayers = new[] { layer };

            Vector3 terrainOrigin = new Vector3(-halfTerrain, settings.TerrainBaseY, originZ);
            if (_terrainAuthoringPreview)
            {
                GameObject terrainObject = Terrain.CreateTerrainGameObject(data);
                terrainObject.name = "Terrain Authoring Surface (non-lethal)";
                terrainObject.layer = 8;
                terrainObject.transform.SetParent(_content.transform, false);
                terrainObject.transform.localPosition = terrainOrigin;
                GeneratedTerrain = terrainObject.GetComponent<Terrain>();
                GeneratedTerrain.drawInstanced = true;
                GeneratedTerrain.heightmapPixelError = settings.HeightmapPixelError;
                GeneratedTerrain.basemapDistance = settings.BasemapDistance;
                GeneratedTerrain.shadowCastingMode = ShadowCastingMode.On;
                GeneratedTerrain.reflectionProbeUsage = ReflectionProbeUsage.BlendProbes;

                var collider = terrainObject.GetComponent<TerrainCollider>();
                if (collider != null) collider.enabled = false;

                Shader terrainShader = Shader.Find("Universal Render Pipeline/Terrain/Lit");
                if (terrainShader != null)
                {
                    var terrainMaterial = new Material(terrainShader) { name = "JH_HybridCanyonTerrainMaterial" };
                    _ownedAssets.Add(terrainMaterial);
                    GeneratedTerrain.materialTemplate = terrainMaterial;
                }
                GeneratedTerrain.Flush();
            }
            else
            {
                BuildTerrainMeshChunks(data, terrainOrigin, _content.transform, _meshMaterial, settings, _ownedAssets);
            }
        }

        public static GameObject BuildTerrainMeshChunks(
            TerrainData data,
            Vector3 terrainOrigin,
            Transform parent,
            Material material,
            HybridCanyonWorldSettings settings,
            IList<UnityEngine.Object> ownedMeshes = null)
        {
            if (data == null || parent == null) return null;
            var root = new GameObject("Baked Terrain Mesh Chunks");
            root.layer = 8;
            root.transform.SetParent(parent, false);
            int chunkCount = Mathf.Max(1, Mathf.CeilToInt(data.size.z / Mathf.Max(40f, settings.MeshChunkLength)));
            int xSegments = Mathf.Max(4, settings.MeshCrossSegments);
            int zSegments = Mathf.Max(2, settings.MeshSegmentsPerChunk);

            for (int chunkIndex = 0; chunkIndex < chunkCount; chunkIndex++)
            {
                float chunkStart = chunkIndex / (float)chunkCount;
                float chunkEnd = (chunkIndex + 1f) / chunkCount;
                int columns = xSegments + 1;
                int rows = zSegments + 1;
                var vertices = new Vector3[columns * rows];
                var normals = new Vector3[vertices.Length];
                var uv = new Vector2[vertices.Length];
                var triangles = new int[xSegments * zSegments * 6];

                for (int z = 0; z < rows; z++)
                {
                    float rowT = z / (float)zSegments;
                    float z01 = Mathf.Lerp(chunkStart, chunkEnd, rowT);
                    for (int x = 0; x < columns; x++)
                    {
                        float x01 = x / (float)xSegments;
                        int index = z * columns + x;
                        vertices[index] = terrainOrigin + new Vector3(
                            x01 * data.size.x,
                            data.GetInterpolatedHeight(x01, z01),
                            z01 * data.size.z);
                        normals[index] = data.GetInterpolatedNormal(x01, z01);
                        uv[index] = new Vector2(x01 * data.size.x / 28f, z01 * data.size.z / 28f);
                    }
                }

                int triangle = 0;
                for (int z = 0; z < zSegments; z++)
                {
                    for (int x = 0; x < xSegments; x++)
                    {
                        int a = z * columns + x;
                        int b = a + columns;
                        triangles[triangle++] = a;
                        triangles[triangle++] = b;
                        triangles[triangle++] = a + 1;
                        triangles[triangle++] = a + 1;
                        triangles[triangle++] = b;
                        triangles[triangle++] = b + 1;
                    }
                }

                var mesh = new Mesh { name = $"JH_HybridTerrainChunk_{chunkIndex:00}", indexFormat = IndexFormat.UInt32 };
                mesh.vertices = vertices;
                mesh.normals = normals;
                mesh.uv = uv;
                mesh.triangles = triangles;
                mesh.RecalculateBounds();
                ownedMeshes?.Add(mesh);

                var chunk = new GameObject($"Terrain Chunk {chunkIndex:00}");
                chunk.layer = 8;
                chunk.transform.SetParent(root.transform, false);
                chunk.AddComponent<MeshFilter>().sharedMesh = mesh;
                var renderer = chunk.AddComponent<MeshRenderer>();
                renderer.sharedMaterial = material;
                renderer.shadowCastingMode = settings.CastMeshShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
                renderer.receiveShadows = settings.ReceiveMeshShadows;
            }
            return root;
        }

        void BuildHeroMeshes(HybridCanyonWorldSettings settings)
        {
            float length = _plan.Length;
            int thresholdIndex = FindFirstPhase(_plan, CanyonEnvironmentPhase.Threshold);
            int breakupIndex = FindFirstPhase(_plan, CanyonEnvironmentPhase.Breakup);
            float thresholdDistance = thresholdIndex >= 0 ? _plan.GetOpening(thresholdIndex).Distance : length * .25f;
            float breakupDistance = breakupIndex >= 0 ? _plan.GetOpening(breakupIndex).Distance : length * .82f;

            BuildWaterOutcrops(settings, thresholdDistance, breakupDistance);
            BuildArch("Monumental Canyon Threshold", thresholdDistance, settings.EntryClearance, settings, 0);
            BuildArch("Natural Canyon Bridge", Mathf.Lerp(thresholdDistance, breakupDistance, .52f), settings.EntryClearance - 3f, settings, 101);
            CanyonCurvedWallBuilder.Build(
                _route,
                settings,
                Mathf.Max(0f, thresholdDistance - settings.SlabLength),
                Mathf.Min(_plan.Length, breakupDistance + settings.SlabLength * 2f),
                _content.transform,
                _meshMaterial,
                _ownedAssets);
            BuildTraversalGates(settings);

            int count = Mathf.Max(0, settings.SideMonolithCount);
            for (int i = 0; i < count; i++)
            {
                float t = (i + 1f) / (count + 1f);
                float distance = Mathf.Lerp(95f, length - 75f, t);
                CanyonRouteFrame frame = _route.Sample(distance);
                float center = frame.Center.x;
                float halfWidth = frame.HalfWidth;
                int side = (i & 1) == 0 ? -1 : 1;
                float height = 29f + (i % 3) * 9f;
                Vector3 size = new Vector3(10f + (i % 2) * 4f, height, 15f + (i % 3) * 5f);
                Vector3 position = new Vector3(
                    center + side * (halfWidth + 18f + (i % 2) * 8f),
                    height * .5f - 2f,
                    -distance);
                CreateHeroBlock($"Monolith {i + 1:00}", position, size, settings.Seed + 700 + i * 31, settings,
                    Quaternion.Euler(0f, side * (8f + i * 3f), side * (3f + i)));
            }
        }

        void BuildWaterOutcrops(HybridCanyonWorldSettings settings, float thresholdDistance, float breakupDistance)
        {
            int seed = settings.Seed + 1200;
            for (int i = 0; i < 10; i++)
            {
                float distance = Mathf.Lerp(32f, thresholdDistance - 24f, i / 9f);
                CanyonRouteFrame frame = _route.Sample(distance);
                float center = frame.Center.x;
                float halfWidth = frame.HalfWidth;
                int side = (i & 1) == 0 ? -1 : 1;
                float convergence = i / 9f;
                float lateral = Mathf.Lerp(74f, halfWidth + 8f, convergence);
                CreateSlabFormation($"Approach Outcrop {i + 1:00}", distance, center + side * lateral, side,
                    18f + (i % 4) * 8f, 14f + (i % 3) * 6f, seed + i * 29, settings);
            }

            for (int i = 0; i < 8; i++)
            {
                float distance = Mathf.Lerp(breakupDistance + 12f, _plan.Length - 12f, i / 7f);
                CanyonRouteFrame frame = _route.Sample(distance);
                float center = frame.Center.x;
                float halfWidth = frame.HalfWidth;
                int side = (i & 1) == 0 ? 1 : -1;
                float breakup = i / 7f;
                float lateral = Mathf.Lerp(halfWidth + 7f, 82f, breakup);
                CreateSlabFormation($"Exit Outcrop {i + 1:00}", distance, center + side * lateral, side,
                    22f + (i % 3) * 9f, 16f + (i % 4) * 5f, seed + 500 + i * 31, settings);
            }
        }

        void BuildFaithfulSlabCorridor(
            HybridCanyonWorldSettings settings,
            float thresholdDistance,
            float breakupDistance)
        {
            float slabLength = Mathf.Max(4f, settings.SlabLength);
            float start = Mathf.Max(0f, thresholdDistance - slabLength);
            float end = Mathf.Min(_plan.Length, breakupDistance + slabLength * 2f);
            int slabCount = Mathf.Max(1, Mathf.CeilToInt((end - start) / slabLength));

            var root = new GameObject("Faithful Source-Slab Canyon Corridor");
            root.layer = 8;
            root.transform.SetParent(_content.transform, false);

            for (int slabIndex = 0; slabIndex < slabCount; slabIndex++)
            {
                float nearDistance = start + slabIndex * slabLength;
                float farDistance = Mathf.Min(end, nearDistance + slabLength);
                for (int side = -1; side <= 1; side += 2)
                {
                    Vector3 nearFoot = SlabFootPoint(_plan, nearDistance, side, settings);
                    Vector3 farFoot = SlabFootPoint(_plan, farDistance, side, settings);
                    Vector3 towardCamera = nearFoot - farFoot;
                    towardCamera.y = 0f;
                    if (towardCamera.sqrMagnitude < .001f) towardCamera = Vector3.forward;
                    Quaternion rotation = Quaternion.LookRotation(towardCamera.normalized, Vector3.up);
                    Vector3 position = (nearFoot + farFoot) * .5f;

                    var slab = new GameObject($"Slab {slabIndex + 1:00} {(side < 0 ? "Left" : "Right")}");
                    slab.layer = 8;
                    slab.transform.SetParent(root.transform, false);
                    slab.transform.localPosition = position;
                    slab.transform.localRotation = rotation;

                    Mesh mesh = CreateFaithfulSlabMesh(
                        nearDistance,
                        farDistance,
                        side,
                        slabIndex,
                        slabIndex == 0,
                        slabIndex == slabCount - 1,
                        position,
                        rotation,
                        settings);
                    _ownedAssets.Add(mesh);
                    slab.AddComponent<MeshFilter>().sharedMesh = mesh;
                    var renderer = slab.AddComponent<MeshRenderer>();
                    renderer.sharedMaterial = _meshMaterial;
                    renderer.shadowCastingMode = settings.CastMeshShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
                    renderer.receiveShadows = settings.ReceiveMeshShadows;
                }
            }
        }

        Mesh CreateFaithfulSlabMesh(
            float nearDistance,
            float farDistance,
            int side,
            int slabIndex,
            bool capNear,
            bool capFar,
            Vector3 pivot,
            Quaternion rotation,
            HybridCanyonWorldSettings settings)
        {
            int columns = Mathf.Max(2, settings.SlabColumns);
            int rows = Mathf.Max(2, settings.SlabRows);
            var inner = new Vector3[columns + 1, rows + 1];
            var outer = new Vector3[columns + 1, rows + 1];
            Quaternion inverseRotation = Quaternion.Inverse(rotation);

            for (int column = 0; column <= columns; column++)
            {
                float u = column / (float)columns;
                float distance = Mathf.Lerp(nearDistance, farDistance, u);
                Vector3 outward = RouteOutwardNormal(_plan, distance) * side;
                Vector3 foot = SlabFootPoint(_plan, distance, side, settings);
                int globalColumn = slabIndex * columns + column;

                for (int row = 0; row <= rows; row++)
                {
                    float v = row / (float)rows;
                    float profile = SourceSlabProfile(v, settings);
                    float jitter = SignedHash(settings.Seed, globalColumn, row, side) * settings.SlabDisplacement;
                    float faceX = profile + jitter;
                    if (settings.SlabSnap > .01f)
                        faceX = Mathf.Round(faceX * settings.SlabSnap) / settings.SlabSnap;

                    float y = v * settings.SlabHeight;
                    if (v > .85f)
                    {
                        float crestNoise = Hash01(settings.Seed + 307, globalColumn, row, side);
                        y += (crestNoise - .4f) * settings.SlabHeight * .18f;
                    }
                    y = Mathf.Round(y * 1.5f) / 1.5f;

                    Vector3 innerWorld = foot
                        + outward * (faceX - settings.SlabFootX)
                        + Vector3.up * (settings.SlabBaseY + y);
                    Vector3 outerWorld = foot
                        + outward * (settings.SlabThickness - settings.SlabFootX)
                        + Vector3.up * (settings.SlabBaseY + v * settings.SlabHeight);
                    inner[column, row] = inverseRotation * (innerWorld - pivot);
                    outer[column, row] = inverseRotation * (outerWorld - pivot);
                }
            }

            var vertices = new List<Vector3>(columns * rows * 36);
            var uv = new List<Vector2>(columns * rows * 36);
            var colors = new List<Color>(columns * rows * 36);
            var triangles = new List<int>(columns * rows * 36);

            void AddTriangle(Vector3 a, Vector3 b, Vector3 c, Vector2 uvA, Vector2 uvB, Vector2 uvC, float shade)
            {
                int first = vertices.Count;
                vertices.Add(a); vertices.Add(b); vertices.Add(c);
                uv.Add(uvA); uv.Add(uvB); uv.Add(uvC);
                Color color = new Color(shade, shade, shade, 1f);
                colors.Add(color); colors.Add(color); colors.Add(color);
                triangles.Add(first); triangles.Add(first + 1); triangles.Add(first + 2);
            }

            void AddQuad(Vector3 a, Vector3 b, Vector3 c, Vector3 d,
                Vector2 uvA, Vector2 uvB, Vector2 uvC, Vector2 uvD, float shade)
            {
                AddTriangle(a, b, c, uvA, uvB, uvC, shade);
                AddTriangle(c, b, d, uvC, uvB, uvD, shade);
            }

            for (int column = 0; column < columns; column++)
            {
                float u0 = slabIndex + column / (float)columns;
                float u1 = slabIndex + (column + 1f) / columns;
                for (int row = 0; row < rows; row++)
                {
                    float v0 = row / (float)rows;
                    float v1 = (row + 1f) / rows;
                    AddQuad(
                        inner[column, row], inner[column, row + 1],
                        inner[column + 1, row], inner[column + 1, row + 1],
                        new Vector2(u0, v0), new Vector2(u0, v1),
                        new Vector2(u1, v0), new Vector2(u1, v1), 1f);
                    AddQuad(
                        outer[column + 1, row], outer[column + 1, row + 1],
                        outer[column, row], outer[column, row + 1],
                        new Vector2(u1, v0), new Vector2(u1, v1),
                        new Vector2(u0, v0), new Vector2(u0, v1), .70f);
                }

                AddQuad(
                    inner[column, 0], outer[column, 0],
                    inner[column + 1, 0], outer[column + 1, 0],
                    new Vector2(u0, 0f), new Vector2(u0, 1f),
                    new Vector2(u1, 0f), new Vector2(u1, 1f), .78f);
                AddQuad(
                    inner[column + 1, rows], outer[column + 1, rows],
                    inner[column, rows], outer[column, rows],
                    new Vector2(u1, 0f), new Vector2(u1, 1f),
                    new Vector2(u0, 0f), new Vector2(u0, 1f), .82f);
            }

            if (capNear || capFar)
            {
                for (int row = 0; row < rows; row++)
                {
                    float v0 = row / (float)rows;
                    float v1 = (row + 1f) / rows;
                    if (capNear)
                        AddQuad(
                            inner[0, row], inner[0, row + 1], outer[0, row], outer[0, row + 1],
                            new Vector2(slabIndex, v0), new Vector2(slabIndex, v1),
                            new Vector2(slabIndex + 1f, v0), new Vector2(slabIndex + 1f, v1), .80f);
                    if (capFar)
                        AddQuad(
                            outer[columns, row], outer[columns, row + 1], inner[columns, row], inner[columns, row + 1],
                            new Vector2(slabIndex + 1f, v0), new Vector2(slabIndex + 1f, v1),
                            new Vector2(slabIndex, v0), new Vector2(slabIndex, v1), .80f);
                }
            }

            var mesh = new Mesh
            {
                name = $"JH_FaithfulCanyonSlab_{slabIndex:00}_{(side < 0 ? "L" : "R")}",
                indexFormat = IndexFormat.UInt32
            };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetColors(colors);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static float SourceSlabProfile(float v, HybridCanyonWorldSettings settings)
        {
            if (v < .15f) return Mathf.Lerp(settings.SlabFootX, settings.SlabSweepX, v / .15f);
            if (v < .45f) return Mathf.Lerp(settings.SlabSweepX, settings.SlabMidX, (v - .15f) / .30f);
            if (v < .85f) return Mathf.Lerp(settings.SlabMidX, settings.SlabCrestX, (v - .45f) / .40f);
            return settings.SlabCrestX;
        }

        static Vector3 SlabFootPoint(
            EncounterPlan plan,
            float distance,
            int side,
            HybridCanyonWorldSettings settings)
        {
            SampleRoute(plan, distance, out float center, out float halfWidth);
            Vector3 outward = RouteOutwardNormal(plan, distance) * side;
            // Faithful source placement: the slab's local foot is exactly on the
            // authored half-gap. The 9→4→17→20 cross-section then creates the same
            // low inward sweep and outward crest seen in the Three.js slab.
            return new Vector3(center, 0f, -distance) + outward * halfWidth;
        }

        static Vector3 RouteOutwardNormal(EncounterPlan plan, float distance)
        {
            SampleRoute(plan, distance - 2f, out float before, out _);
            SampleRoute(plan, distance + 2f, out float after, out _);
            Vector3 tangent = new Vector3(after - before, 0f, -4f).normalized;
            Vector3 right = Vector3.Cross(tangent, Vector3.up).normalized;
            return right.sqrMagnitude > .5f ? right : Vector3.right;
        }

        static float SignedHash(int seed, int longitudinal, int vertical, int side)
        {
            unchecked
            {
                uint value = (uint)seed;
                value ^= (uint)(longitudinal * 374761393);
                value ^= (uint)(vertical * 668265263);
                value ^= side < 0 ? 0x9E3779B9u : 0x85EBCA6Bu;
                value = (value ^ (value >> 13)) * 1274126177u;
                value ^= value >> 16;
                return value / (float)uint.MaxValue * 2f - 1f;
            }
        }

        static float Hash01(int seed, int longitudinal, int vertical, int side)
            => SignedHash(seed, longitudinal, vertical, side) * .5f + .5f;

        void BuildTraversalGates(HybridCanyonWorldSettings settings)
        {
            for (int i = 0; i < _plan.OpeningCount; i++)
            {
                EncounterOpening opening = _plan.GetOpening(i);
                if (opening.TraversalRequirement != TraversalRequirement.KnifeEdge) continue;
                var root = new GameObject($"Knife-Edge Rock Gate {i:00}");
                root.layer = 8;
                root.transform.SetParent(_content.transform, false);
                CanyonRouteFrame frame = _route.Sample(opening.Distance);
                root.transform.localPosition = frame.Center;
                root.transform.localRotation = Quaternion.LookRotation(frame.Forward, frame.Up);

                const float gapHalfWidth = 1.15f;
                float span = opening.HalfWidth + 6f;
                float sideWidth = Mathf.Max(4f, span - gapHalfWidth);
                CreateHeroBlock("Left Rock Fin", new Vector3(-(gapHalfWidth + sideWidth * .5f), 5.5f, 0f),
                    new Vector3(sideWidth, 11f, 7f), settings.Seed + 3100 + i * 7, settings,
                    Quaternion.Euler(0f, 0f, -4f), root.transform);
                CreateHeroBlock("Right Rock Fin", new Vector3(gapHalfWidth + sideWidth * .5f, 5.5f, 0f),
                    new Vector3(sideWidth, 11f, 7f), settings.Seed + 3101 + i * 7, settings,
                    Quaternion.Euler(0f, 0f, 4f), root.transform);
            }
        }

        void CreateSlabFormation(
            string name,
            float distance,
            float innerX,
            int side,
            float height,
            float depth,
            int seed,
            HybridCanyonWorldSettings settings,
            float baseY = -4f)
        {
            var go = new GameObject(name);
            go.layer = 8;
            go.transform.SetParent(_content.transform, false);
            go.transform.localPosition = new Vector3(innerX, baseY, -distance);
            CanyonRouteFrame frame = _route.Sample(distance);
            go.transform.localRotation = Quaternion.LookRotation(frame.Forward, frame.Up);
            go.transform.localScale = new Vector3(side, 1f, 1f);
            Mesh mesh = MeshFactory.CanyonSlab(
                height,
                depth,
                18f + height * .35f,
                5,
                6,
                4f,
                .7f,
                6f,
                3f,
                11f,
                15f,
                seed);
            _ownedAssets.Add(mesh);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = _meshMaterial;
            renderer.shadowCastingMode = settings.CastMeshShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            renderer.receiveShadows = settings.ReceiveMeshShadows;
        }

        void BuildArch(string name, float distance, float clearance, HybridCanyonWorldSettings settings, int seedOffset)
        {
            CanyonRouteFrame frame = _route.Sample(distance);
            float center = frame.Center.x;
            float halfWidth = frame.HalfWidth;
            var root = new GameObject(name);
            root.layer = 8;
            root.transform.SetParent(_content.transform, false);
            root.transform.localPosition = new Vector3(center, 0f, -distance);
            root.transform.localRotation = Quaternion.LookRotation(frame.Forward, frame.Up);

            float pillarWidth = settings.ArchPillarWidth;
            float pillarHeight = clearance + settings.ArchCrownThickness + 16f;
            float span = halfWidth * 2f + pillarWidth * 2f;
            CreateHeroBlock("Left Pillar", new Vector3(-halfWidth - pillarWidth * .5f, pillarHeight * .5f - 2f, 0f),
                new Vector3(pillarWidth, pillarHeight, settings.ArchDepth), settings.Seed + seedOffset + 1, settings, Quaternion.identity, root.transform);
            CreateHeroBlock("Right Pillar", new Vector3(halfWidth + pillarWidth * .5f, pillarHeight * .5f - 2f, 0f),
                new Vector3(pillarWidth, pillarHeight, settings.ArchDepth), settings.Seed + seedOffset + 2, settings, Quaternion.identity, root.transform);
            CreateHeroBlock("Crown", new Vector3(0f, clearance + settings.ArchCrownThickness * .5f, 0f),
                new Vector3(span, settings.ArchCrownThickness, settings.ArchDepth), settings.Seed + seedOffset + 3, settings,
                Quaternion.Euler(0f, 0f, 1.5f), root.transform);
        }

        GameObject CreateHeroBlock(
            string name,
            Vector3 position,
            Vector3 size,
            int seed,
            HybridCanyonWorldSettings settings,
            Quaternion rotation,
            Transform parent = null)
        {
            var go = new GameObject(name);
            go.layer = 8;
            go.transform.SetParent(parent != null ? parent : _content.transform, false);
            go.transform.localPosition = position;
            go.transform.localRotation = rotation;
            Mesh mesh = CreateJaggedBox(size, seed);
            _ownedAssets.Add(mesh);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = _meshMaterial;
            renderer.shadowCastingMode = settings.CastMeshShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            renderer.receiveShadows = settings.ReceiveMeshShadows;
            return go;
        }

        Material CreateFallbackCanyonMaterial()
        {
            Shader shader = Shader.Find("JH/StableCanyon");
            if (shader == null) shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) return null;
            var material = new Material(shader) { name = "JH_HybridCanyonFallback" };
            _ownedAssets.Add(material);
            Texture2D cyan = TextureFactory.CyanSlab();
            Texture2D dark = TextureFactory.DarkSlab();
            _ownedAssets.Add(cyan);
            _ownedAssets.Add(dark);
            if (material.HasProperty("_CyanSurface")) material.SetTexture("_CyanSurface", cyan);
            if (material.HasProperty("_DarkSurface")) material.SetTexture("_DarkSurface", dark);
            if (material.HasProperty("_BaseMap")) material.SetTexture("_BaseMap", cyan);
            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", TextureFactory.Hex(0x174f5c));
            if (material.HasProperty("_Brightness")) material.SetFloat("_Brightness", .62f);
            if (material.HasProperty("_Emission")) material.SetFloat("_Emission", .18f);
            if (material.HasProperty("_FadeStart")) material.SetFloat("_FadeStart", -1600f);
            if (material.HasProperty("_FadeEnd")) material.SetFloat("_FadeEnd", -1400f);
            return material;
        }

        static int FindFirstPhase(EncounterPlan plan, CanyonEnvironmentPhase phase)
        {
            for (int i = 0; i < plan.OpeningCount; i++)
                if (plan.GetOpening(i).EnvironmentPhase == phase) return i;
            return -1;
        }

        static void FindPhaseDistances(
            EncounterPlan plan,
            out float convergenceStart,
            out float threshold,
            out float breakupStart,
            out float routeEnd)
        {
            int convergence = FindFirstPhase(plan, CanyonEnvironmentPhase.Convergence);
            int thresholdIndex = FindFirstPhase(plan, CanyonEnvironmentPhase.Threshold);
            int breakup = FindFirstPhase(plan, CanyonEnvironmentPhase.Breakup);
            convergenceStart = convergence >= 0 ? plan.GetOpening(convergence).Distance : plan.Length * .12f;
            threshold = thresholdIndex >= 0 ? plan.GetOpening(thresholdIndex).Distance : plan.Length * .25f;
            breakupStart = breakup >= 0 ? plan.GetOpening(breakup).Distance : plan.Length * .82f;
            routeEnd = plan.Length;
        }

        static float EnclosureAtDistance(
            float distance,
            float convergenceStart,
            float threshold,
            float breakupStart,
            float routeEnd)
        {
            if (distance <= convergenceStart) return 0f;
            if (distance < threshold) return Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(convergenceStart, threshold, distance));
            if (distance <= breakupStart) return 1f;
            return 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(breakupStart, routeEnd, distance));
        }

        Texture2D ResolveSurfaceTexture(Material material)
        {
            string[] names = { "_CyanSurface", "_BaseMap", "_MainTex" };
            if (material != null)
            {
                for (int i = 0; i < names.Length; i++)
                {
                    if (!material.HasProperty(names[i])) continue;
                    if (material.GetTexture(names[i]) is Texture2D texture) return texture;
                }
            }
            Texture2D generated = TextureFactory.CyanSlab();
            generated.wrapMode = TextureWrapMode.Repeat;
            _ownedAssets.Add(generated);
            return generated;
        }

        static void SampleRoute(EncounterPlan plan, float distance, out float center, out float halfWidth)
        {
            EncounterOpening first = plan.GetOpening(0);
            if (distance <= first.Distance)
            {
                float approach = Mathf.Clamp01(distance / Mathf.Max(1f, first.Distance));
                center = Mathf.Lerp(0f, first.CenterX, approach);
                halfWidth = Mathf.Lerp(first.HalfWidth + 24f, first.HalfWidth, approach);
                return;
            }

            for (int i = 1; i < plan.OpeningCount; i++)
            {
                EncounterOpening b = plan.GetOpening(i);
                if (distance > b.Distance) continue;
                EncounterOpening a = plan.GetOpening(i - 1);
                float t = Mathf.InverseLerp(a.Distance, b.Distance, distance);
                t = Mathf.SmoothStep(0f, 1f, t);
                center = Mathf.Lerp(a.CenterX, b.CenterX, t);
                halfWidth = Mathf.Lerp(a.HalfWidth, b.HalfWidth, t);
                return;
            }

            EncounterOpening last = plan.GetOpening(plan.OpeningCount - 1);
            center = last.CenterX;
            halfWidth = last.HalfWidth + Mathf.Clamp01((distance - last.Distance) / 80f) * 28f;
        }

        static float RouteYaw(EncounterPlan plan, float distance)
        {
            SampleRoute(plan, distance - 4f, out float before, out _);
            SampleRoute(plan, distance + 4f, out float after, out _);
            return Mathf.Atan2(after - before, -8f) * Mathf.Rad2Deg;
        }

        static float FractalNoise(float x, float z, HybridCanyonWorldSettings settings)
        {
            float scale = Mathf.Max(1f, settings.NoiseScale);
            float offset = settings.Seed * .0173f;
            float broad = Mathf.PerlinNoise(x / scale + offset, z / scale - offset) * 2f - 1f;
            float detail = Mathf.PerlinNoise(x / (scale * .37f) - offset, z / (scale * .37f) + offset) * 2f - 1f;
            return broad * .72f + detail * .28f;
        }

        static int ValidHeightmapResolution(int requested)
        {
            int[] valid = { 65, 129, 257, 513 };
            int best = valid[0];
            int difference = Mathf.Abs(requested - best);
            for (int i = 1; i < valid.Length; i++)
            {
                int candidate = Mathf.Abs(requested - valid[i]);
                if (candidate >= difference) continue;
                difference = candidate;
                best = valid[i];
            }
            return best;
        }

        static Mesh CreateJaggedBox(Vector3 size, int seed)
        {
            var random = new System.Random(seed);
            float Jitter(float magnitude) => ((float)random.NextDouble() * 2f - 1f) * magnitude;
            Vector3 half = size * .5f;
            float jitter = Mathf.Min(size.x, Mathf.Min(size.y, size.z)) * .08f;
            var corners = new[]
            {
                new Vector3(-half.x + Jitter(jitter), -half.y, -half.z + Jitter(jitter)),
                new Vector3( half.x + Jitter(jitter), -half.y, -half.z + Jitter(jitter)),
                new Vector3( half.x + Jitter(jitter),  half.y + Jitter(jitter), -half.z + Jitter(jitter)),
                new Vector3(-half.x + Jitter(jitter),  half.y + Jitter(jitter), -half.z + Jitter(jitter)),
                new Vector3(-half.x + Jitter(jitter), -half.y,  half.z + Jitter(jitter)),
                new Vector3( half.x + Jitter(jitter), -half.y,  half.z + Jitter(jitter)),
                new Vector3( half.x + Jitter(jitter),  half.y + Jitter(jitter),  half.z + Jitter(jitter)),
                new Vector3(-half.x + Jitter(jitter),  half.y + Jitter(jitter),  half.z + Jitter(jitter))
            };
            var vertices = new List<Vector3>(24);
            var triangles = new List<int>(36);
            var uv = new List<Vector2>(24);
            void Face(int a, int b, int c, int d)
            {
                int start = vertices.Count;
                vertices.Add(corners[a]); vertices.Add(corners[b]); vertices.Add(corners[c]); vertices.Add(corners[d]);
                uv.Add(Vector2.zero); uv.Add(Vector2.up); uv.Add(Vector2.one); uv.Add(Vector2.right);
                triangles.Add(start); triangles.Add(start + 1); triangles.Add(start + 2);
                triangles.Add(start); triangles.Add(start + 2); triangles.Add(start + 3);
            }
            Face(0, 3, 2, 1); Face(5, 6, 7, 4); Face(4, 7, 3, 0);
            Face(1, 2, 6, 5); Face(3, 7, 6, 2); Face(4, 0, 1, 5);
            var mesh = new Mesh { name = "JH_JaggedHeroBlock" };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        void ReleaseWorld(bool immediate)
        {
            GeneratedTerrain = null;
            IsPresenting = false;
            if (_content != null)
            {
                if (immediate) DestroyImmediate(_content);
                else Destroy(_content);
                _content = null;
            }
            for (int i = _ownedAssets.Count - 1; i >= 0; i--)
            {
                UnityEngine.Object asset = _ownedAssets[i];
                if (asset == null) continue;
                if (immediate) DestroyImmediate(asset);
                else Destroy(asset);
            }
            _ownedAssets.Clear();
            _meshMaterial = null;
            _plan = null;
            _route = null;
            _terrainAuthoringPreview = false;
        }
    }
}
