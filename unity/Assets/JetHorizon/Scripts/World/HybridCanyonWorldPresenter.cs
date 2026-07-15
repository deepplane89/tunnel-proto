using System;
using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    [Serializable]
    public sealed class HybridCanyonWorldSettings
    {
        [Header("Terrain world mass")]
        [Range(65, 513)] public int HeightmapResolution = 257;
        [Min(160f)] public float TerrainWidth = 440f;
        [Min(100f)] public float ApproachLength = 150f;
        [Min(40f)] public float RearLength = 100f;
        public float TerrainBaseY = -22f;
        [Min(20f)] public float TerrainHeight = 82f;
        [Min(5f)] public float BankHeight = 61f;
        [Min(2f)] public float BankRiseWidth = 34f;
        [Range(0f, 20f)] public float SurfaceNoise = 8f;
        [Min(5f)] public float NoiseScale = 38f;
        [Range(1f, 30f)] public float HeightmapPixelError = 8f;
        [Min(50f)] public float BasemapDistance = 260f;
        [Min(40f)] public float MeshChunkLength = 110f;
        [Range(12, 96)] public int MeshCrossSegments = 56;
        [Range(4, 40)] public int MeshSegmentsPerChunk = 18;
        public int Seed = 41073;

        [Header("Authored mesh landmarks")]
        [Min(8f)] public float ArchDepth = 18f;
        [Min(3f)] public float ArchPillarWidth = 13f;
        [Min(10f)] public float EntryClearance = 24f;
        [Min(2f)] public float ArchCrownThickness = 12f;
        [Range(0, 10)] public int SideMonolithCount = 6;
        public bool CastMeshShadows = true;
        public bool ReceiveMeshShadows = true;
    }

    /// <summary>
    /// Unity-facing authoring profile. Gameplay never reads this asset: it only controls
    /// how the core-owned crystalline route is projected into Terrain and hero meshes.
    /// </summary>
    [CreateAssetMenu(fileName = "HybridCanyonWorld", menuName = "Jet Horizon/Hybrid Canyon World")]
    public sealed class HybridCanyonWorldProfile : ScriptableObject
    {
        public HybridCanyonWorldSettings Settings = new HybridCanyonWorldSettings();
        public Material CanyonMaterial;
        [Tooltip("Editor-baked mobile runtime world. When absent, gameplay creates the same optimized chunks in memory as a safe fallback.")]
        public GameObject BakedWorldPrefab;
    }

    /// <summary>
    /// Builds the complete crystalline canyon once, then scrolls the entire construct
    /// against a core-owned route sample. Terrain supplies the broad world mass; opaque
    /// jagged meshes supply arches, bridges, and silhouettes Terrain cannot represent.
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
        GameObject _content;
        Material _meshMaterial;
        bool _terrainAuthoringPreview;

        void Awake()
        {
            if (Profile == null) Profile = Resources.Load<HybridCanyonWorldProfile>("HybridCanyonWorld");
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
            if (!TryFindAnchor(snapshot, out CorridorSliceSnapshot anchor))
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

            int openingIndex = Mathf.Clamp(anchor.RowIndex, 0, _plan.OpeningCount - 1);
            float authoredZ = -_plan.GetOpening(openingIndex).Distance;
            _content.transform.localPosition = new Vector3(0f, 0f, anchor.Z - authoredZ);
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

        static bool TryFindAnchor(SimulationSnapshot snapshot, out CorridorSliceSnapshot anchor)
        {
            anchor = default;
            if (snapshot == null) return false;
            bool found = false;
            int bestRow = int.MaxValue;
            for (int i = 0; i < snapshot.CorridorSliceCount; i++)
            {
                CorridorSliceSnapshot slice = snapshot.GetCorridorSlice(i);
                if (slice.Family != CorridorFamily.CrystallineCanyon || slice.RowIndex >= bestRow) continue;
                anchor = slice;
                bestRow = slice.RowIndex;
                found = true;
            }
            return found;
        }

        void EnsureBuilt()
        {
            if (_content != null) return;
            _plan = FindCanyonPlan();
            if (_plan == null) return;

            HybridCanyonWorldSettings settings = Profile != null && Profile.Settings != null
                ? Profile.Settings
                : new HybridCanyonWorldSettings();
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
                _content.SetActive(false);
                return;
            }
            BuildTerrain(settings);
            BuildHeroMeshes(settings);
            _content.SetActive(false);
        }

        static EncounterPlan FindCanyonPlan()
        {
            EncounterPlan[] plans = EncounterPlanCatalog.CreateProofSequence();
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
            for (int z = 0; z < resolution; z++)
            {
                float z01 = z / (float)(resolution - 1);
                float localZ = originZ + depth * z01;
                float distance = -localZ;
                SampleRoute(_plan, distance, out float center, out float halfWidth);

                for (int x = 0; x < resolution; x++)
                {
                    float x01 = x / (float)(resolution - 1);
                    float localX = Mathf.Lerp(-halfTerrain, halfTerrain, x01);
                    float outside = Mathf.Abs(localX - center) - halfWidth;
                    float bank = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(outside / settings.BankRiseWidth));
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
            BuildArch("Entry Arch", Mathf.Min(45f, length * .08f), settings.EntryClearance, settings, 0);
            BuildArch("Canyon Bridge", length * .53f, settings.EntryClearance - 3f, settings, 101);
            BuildArch("Exit Arch", Mathf.Max(60f, length - 48f), settings.EntryClearance + 2f, settings, 211);

            int count = Mathf.Max(0, settings.SideMonolithCount);
            for (int i = 0; i < count; i++)
            {
                float t = (i + 1f) / (count + 1f);
                float distance = Mathf.Lerp(95f, length - 75f, t);
                SampleRoute(_plan, distance, out float center, out float halfWidth);
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

        void BuildArch(string name, float distance, float clearance, HybridCanyonWorldSettings settings, int seedOffset)
        {
            SampleRoute(_plan, distance, out float center, out float halfWidth);
            float tangentYaw = RouteYaw(_plan, distance);
            var root = new GameObject(name);
            root.layer = 8;
            root.transform.SetParent(_content.transform, false);
            root.transform.localPosition = new Vector3(center, 0f, -distance);
            root.transform.localRotation = Quaternion.Euler(0f, tangentYaw, 0f);

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
            return material;
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
            _terrainAuthoringPreview = false;
        }
    }
}
