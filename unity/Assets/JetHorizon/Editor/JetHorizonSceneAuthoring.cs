using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace JetHorizon.EditorTools
{
    public static class JetHorizonSceneAuthoring
    {
        const string CanyonKey = "JetHorizon.ControlRoom.CanyonHandles";
        const string ThrusterKey = "JetHorizon.ControlRoom.ThrusterHandles";

        public static bool CanyonHandlesEnabled
        {
            get => SessionState.GetBool(CanyonKey, false);
            set { SessionState.SetBool(CanyonKey, value); SceneView.RepaintAll(); }
        }

        public static bool ThrusterHandlesEnabled
        {
            get => SessionState.GetBool(ThrusterKey, false);
            set { SessionState.SetBool(ThrusterKey, value); SceneView.RepaintAll(); }
        }

        public static void DrawCanyonHandles(JetHorizonCanyonAuthoring canyon)
        {
            if (canyon == null || canyon.Points == null || canyon.Points.Count == 0) return;
            Handles.zTest = CompareFunction.LessEqual;
            var center = canyon.Points.Select(point => point.Position).ToArray();
            var left = canyon.Points.Select(point => point.Position + Vector3.left * point.HalfWidth).ToArray();
            var right = canyon.Points.Select(point => point.Position + Vector3.right * point.HalfWidth).ToArray();
            Handles.color = new Color(0f, .95f, 1f, .95f); Handles.DrawAAPolyLine(4f, center);
            Handles.color = new Color(1f, .1f, .65f, .8f); Handles.DrawAAPolyLine(2f, left); Handles.DrawAAPolyLine(2f, right);

            for (int i = 0; i < canyon.Points.Count; i++)
            {
                CanyonAuthoringPoint point = canyon.Points[i];
                Handles.color = Color.white;
                Handles.Label(point.Position + Vector3.up * 3f, $"P{i}  width {point.HalfWidth * 2f:0}");
                EditorGUI.BeginChangeCheck();
                Vector3 moved = Handles.PositionHandle(point.Position, Quaternion.identity);
                Handles.color = new Color(1f, .75f, .15f, 1f);
                float width = Handles.ScaleSlider(point.HalfWidth, moved, Vector3.right, Quaternion.identity, HandleUtility.GetHandleSize(moved), 1f);
                if (!EditorGUI.EndChangeCheck()) continue;
                Undo.RecordObject(canyon, "Edit canyon path");
                point.Position = moved;
                point.HalfWidth = Mathf.Max(5f, width);
                canyon.Points[i] = point;
                EditorUtility.SetDirty(canyon);
            }
        }

        public static void DrawThrusterHandles(ThrusterFX thruster)
        {
            if (thruster == null) return;
            Transform root = thruster.transform;
            DrawNozzle(thruster, root, "MAIN L", new Color(.1f, .75f, 1f), thruster.NozzleL, value => thruster.NozzleL = value);
            DrawNozzle(thruster, root, "MAIN R", new Color(.1f, .75f, 1f), thruster.NozzleR, value => thruster.NozzleR = value);
            DrawNozzle(thruster, root, "MINI L", new Color(1f, .25f, .75f), thruster.MiniNozzleL, value => thruster.MiniNozzleL = value);
            DrawNozzle(thruster, root, "MINI R", new Color(1f, .25f, .75f), thruster.MiniNozzleR, value => thruster.MiniNozzleR = value);
        }

        static void DrawNozzle(ThrusterFX thruster, Transform root, string label, Color color, Vector3 local, Action<Vector3> apply)
        {
            Vector3 world = root.TransformPoint(local);
            Handles.color = color;
            Handles.SphereHandleCap(0, world, Quaternion.identity, HandleUtility.GetHandleSize(world) * .08f, EventType.Repaint);
            Handles.Label(world + Vector3.up * .16f, label);
            EditorGUI.BeginChangeCheck();
            Vector3 moved = Handles.PositionHandle(world, root.rotation);
            if (!EditorGUI.EndChangeCheck()) return;
            Undo.RecordObject(thruster, "Move thruster nozzle");
            apply(root.InverseTransformPoint(moved));
            thruster.AutoAnchorToModel = false;
            EditorUtility.SetDirty(thruster);
            EditorSceneManager.MarkSceneDirty(thruster.gameObject.scene);
        }
    }

    public static class JetHorizonCanyonBaker
    {
        public const string PreviewName = "JH_CanyonAuthoringPreview";

        readonly struct Sample
        {
            public readonly Vector3 Position;
            public readonly Vector3 Tangent;
            public readonly float HalfWidth;
            public Sample(Vector3 position, Vector3 tangent, float halfWidth) { Position = position; Tangent = tangent; HalfWidth = halfWidth; }
        }

        public static GameObject BuildPreview(JetHorizonCanyonAuthoring canyon)
        {
            ClearPreview();
            if (canyon == null || canyon.Points == null || canyon.Points.Count < 2)
            {
                EditorUtility.DisplayDialog("Canyon path", "At least two path points are required.", "OK");
                return null;
            }

            var root = new GameObject(PreviewName);
            Undo.RegisterCreatedObjectUndo(root, "Build canyon preview");
            var samples = SamplePath(canyon);
            int samplesPerChunk = Mathf.Max(1, Mathf.RoundToInt(canyon.ChunkLength / canyon.SampleSpacing));
            int chunkIndex = 0;
            for (int first = 0; first < samples.Count; first += samplesPerChunk)
            {
                int count = Mathf.Min(samplesPerChunk, samples.Count - first);
                BuildChunk(root.transform, canyon, samples, first, count, chunkIndex++);
            }
            Selection.activeGameObject = root;
            SceneView.lastActiveSceneView?.FrameSelected();
            return root;
        }

        public static void ClearPreview()
        {
            var root = GameObject.Find(PreviewName);
            if (root != null) Undo.DestroyObjectImmediate(root);
        }

        public static void BakePrefab(JetHorizonCanyonAuthoring canyon)
        {
            GameObject root = BuildPreview(canyon);
            if (root == null) return;
            string prefabPath = EditorUtility.SaveFilePanelInProject("Bake optimized canyon prefab", "JetHorizonCanyon", "prefab", "The meshes will be stored beside this prefab.", "Assets/JetHorizon/Generated/Canyons");
            if (string.IsNullOrEmpty(prefabPath)) return;
            string directory = Path.GetDirectoryName(prefabPath)?.Replace('\\', '/');
            if (string.IsNullOrEmpty(directory)) return;
            EnsureAssetFolder(directory);

            string baseName = Path.GetFileNameWithoutExtension(prefabPath);
            var filters = root.GetComponentsInChildren<MeshFilter>();
            for (int i = 0; i < filters.Length; i++)
            {
                Mesh copy = UnityEngine.Object.Instantiate(filters[i].sharedMesh);
                copy.name = $"{baseName}_Chunk_{i:000}";
                string meshPath = AssetDatabase.GenerateUniqueAssetPath($"{directory}/{copy.name}.asset");
                AssetDatabase.CreateAsset(copy, meshPath);
                filters[i].sharedMesh = copy;
            }
            PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Selection.activeObject = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            Debug.Log($"[JetHorizon] Baked {filters.Length} combined canyon chunks to {prefabPath}. Runtime slab construction is not required for this prefab.");
        }

        static void BuildChunk(Transform root, JetHorizonCanyonAuthoring canyon, List<Sample> samples, int first, int count, int chunkIndex)
        {
            var combines = new List<CombineInstance>(count * 2);
            var sourceMeshes = new List<Mesh>(count * 2);
            for (int i = first; i < first + count; i++)
            {
                Sample sample = samples[i];
                float yaw = Mathf.Atan2(sample.Tangent.x, sample.Tangent.z) * Mathf.Rad2Deg;
                for (int side = -1; side <= 1; side += 2)
                {
                    Mesh slab = MeshFactory.CanyonSlab(
                        canyon.SlabHeight, canyon.SampleSpacing * 1.08f, canyon.SlabDepth,
                        canyon.Columns, canyon.Rows, canyon.Displacement, canyon.Snap,
                        canyon.Foot, canyon.Sweep, canyon.Mid, canyon.Crest,
                        canyon.Seed + i * 17 + (side > 0 ? 1 : 0));
                    sourceMeshes.Add(slab);
                    Vector3 normal = Vector3.Cross(Vector3.up, sample.Tangent).normalized;
                    Vector3 inner = sample.Position + normal * (sample.HalfWidth * side);
                    Quaternion rotation = Quaternion.Euler(0f, yaw + (side < 0 ? 180f : 0f), 0f);
                    combines.Add(new CombineInstance { mesh = slab, transform = Matrix4x4.TRS(inner, rotation, Vector3.one) });
                }
            }

            var chunk = new GameObject($"CanyonChunk_{chunkIndex:000}");
            chunk.transform.SetParent(root, false);
            var mesh = new Mesh { name = chunk.name + "_Combined", indexFormat = IndexFormat.UInt32 };
            mesh.CombineMeshes(combines.ToArray(), true, true, false);
            mesh.RecalculateBounds();
            foreach (Mesh source in sourceMeshes) UnityEngine.Object.DestroyImmediate(source);
            chunk.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = chunk.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = canyon.CanyonMaterial;
            renderer.shadowCastingMode = canyon.CastShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            renderer.receiveShadows = canyon.ReceiveShadows;
            if (canyon.AddMeshColliders) chunk.AddComponent<MeshCollider>().sharedMesh = mesh;

            int triangles = mesh.triangles.Length / 3;
            if (triangles > canyon.TriangleBudgetPerChunk)
                Debug.LogWarning($"[JetHorizon] {chunk.name} has {triangles:N0} triangles; budget is {canyon.TriangleBudgetPerChunk:N0}. Increase sample spacing or lower rows/columns.", chunk);
        }

        static List<Sample> SamplePath(JetHorizonCanyonAuthoring canyon)
        {
            var result = new List<Sample>();
            for (int segment = 0; segment < canyon.Points.Count - 1; segment++)
            {
                CanyonAuthoringPoint a = canyon.Points[segment];
                CanyonAuthoringPoint b = canyon.Points[segment + 1];
                Vector3 delta = b.Position - a.Position;
                float length = delta.magnitude;
                if (length < .01f) continue;
                int steps = Mathf.Max(1, Mathf.CeilToInt(length / canyon.SampleSpacing));
                Vector3 tangent = delta / length;
                for (int step = 0; step < steps; step++)
                {
                    float t = step / (float)steps;
                    result.Add(new Sample(Vector3.Lerp(a.Position, b.Position, t), tangent, Mathf.Lerp(a.HalfWidth, b.HalfWidth, t)));
                }
            }
            CanyonAuthoringPoint last = canyon.Points[canyon.Points.Count - 1];
            Vector3 lastTangent = (last.Position - canyon.Points[canyon.Points.Count - 2].Position).normalized;
            result.Add(new Sample(last.Position, lastTangent, last.HalfWidth));
            return result;
        }

        static void EnsureAssetFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            string[] parts = path.Split('/');
            string current = parts[0];
            for (int i = 1; i < parts.Length; i++)
            {
                string next = current + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(current, parts[i]);
                current = next;
            }
        }
    }

    public static class JetHorizonWorkbench
    {
        public enum Kind { Sun, Ship, Powerup }

        public static void Create(Kind kind, JetHorizonAuthoringProfile profile)
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = $"{kind}VisualLab";
            BuildCameraAndLights();
            switch (kind)
            {
                case Kind.Sun: BuildSun(profile); break;
                case Kind.Ship: BuildShip(profile); break;
                case Kind.Powerup: BuildPowerups(profile); break;
            }
            string directory = "Assets/JetHorizon/Generated/Workbenches";
            if (!AssetDatabase.IsValidFolder(directory))
            {
                if (!AssetDatabase.IsValidFolder("Assets/JetHorizon/Generated")) AssetDatabase.CreateFolder("Assets/JetHorizon", "Generated");
                AssetDatabase.CreateFolder("Assets/JetHorizon/Generated", "Workbenches");
            }
            EditorSceneManager.SaveScene(scene, $"{directory}/{kind}VisualLab.unity");
        }

        static void BuildCameraAndLights()
        {
            var cameraObject = new GameObject("Main Camera"); cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>(); camera.clearFlags = CameraClearFlags.Skybox; camera.fieldOfView = 50f;
            cameraObject.transform.position = new Vector3(0f, 2.2f, 8f); cameraObject.transform.LookAt(Vector3.zero);
            cameraObject.AddComponent<AudioListener>();
            var key = new GameObject("Workbench Key").AddComponent<Light>(); key.type = LightType.Directional; key.intensity = 3f; key.transform.rotation = Quaternion.Euler(35f, -25f, 0f);
            var rim = new GameObject("Workbench Rim").AddComponent<Light>(); rim.type = LightType.Directional; rim.intensity = .7f; rim.color = new Color(.25f, .55f, 1f); rim.transform.rotation = Quaternion.Euler(15f, 145f, 0f);
            RenderSettings.ambientMode = AmbientMode.Flat; RenderSettings.ambientLight = new Color(.08f, .09f, .13f);
        }

        static void BuildSun(JetHorizonAuthoringProfile profile)
        {
            GameObject sun = GameObject.CreatePrimitive(PrimitiveType.Sphere); sun.name = "Sun Preview"; sun.transform.localScale = Vector3.one * 4f;
            sun.GetComponent<MeshRenderer>().sharedMaterial = profile.SunMaterial; UnityEngine.Object.DestroyImmediate(sun.GetComponent<Collider>());
            Camera.main.transform.position = new Vector3(0f, 0f, 8f); Camera.main.transform.LookAt(Vector3.zero);
        }

        static void BuildShip(JetHorizonAuthoringProfile profile)
        {
            GameObject imported = profile.ShipModelAsset != null
                ? profile.ShipModelAsset
                : AssetDatabase.LoadAssetAtPath<GameObject>("Assets/JetHorizon/Models/Ships/default_ship.glb");
            GameObject ship = imported != null ? (GameObject)PrefabUtility.InstantiatePrefab(imported) : GameObject.CreatePrimitive(PrimitiveType.Cube);
            ship.name = "ShipRoot"; ship.transform.position = Vector3.zero;
            var thruster = ship.GetComponent<ThrusterFX>() ?? ship.AddComponent<ThrusterFX>();
            thruster.Preset = ThrusterFX.Style.Light; thruster.ExhaustMaterial = profile.ThrusterMaterial; thruster.AdditiveMaterial = profile.AdditiveMaterial;
        }

        static void BuildPowerups(JetHorizonAuthoringProfile profile)
        {
            Material material = AssetDatabase.LoadAssetAtPath<Material>("Assets/JetHorizon/Generated/CoinMat.mat");
            string[] names = { "Shield", "Magnet", "Laser", "Overdrive" };
            Color[] colors = { new Color(.1f, .8f, 1f), new Color(1f, .2f, .8f), new Color(1f, .15f, .1f), new Color(1f, .8f, .1f) };
            for (int i = 0; i < names.Length; i++)
            {
                GameObject sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere); sphere.name = names[i] + " Preview"; sphere.transform.position = new Vector3((i - 1.5f) * 2.2f, 0f, 0f);
                if (material != null)
                {
                    var instance = new Material(material) { name = names[i] + " Preview Material", color = colors[i] };
                    sphere.GetComponent<MeshRenderer>().sharedMaterial = instance;
                }
            }
        }
    }

    public readonly struct JetHorizonAuditReport
    {
        public readonly bool Passed;
        public readonly string Summary;
        public JetHorizonAuditReport(bool passed, string summary) { Passed = passed; Summary = summary; }
    }

    public static class JetHorizonPerformanceAudit
    {
        public static JetHorizonAuditReport Analyze(JetHorizonAuthoringProfile profile)
        {
            if (profile == null) return new JetHorizonAuditReport(false, "No authoring profile assigned.");
            Renderer[] renderers = UnityEngine.Object.FindObjectsByType<Renderer>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            Light[] lights = UnityEngine.Object.FindObjectsByType<Light>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            ParticleSystem[] particles = UnityEngine.Object.FindObjectsByType<ParticleSystem>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            MeshFilter[] filters = UnityEngine.Object.FindObjectsByType<MeshFilter>(FindObjectsInactive.Include, FindObjectsSortMode.None);
            var materials = new HashSet<Material>();
            int transparent = 0;
            foreach (Renderer renderer in renderers)
            foreach (Material material in renderer.sharedMaterials)
            {
                if (material == null) continue; materials.Add(material);
                if (material.renderQueue >= (int)RenderQueue.Transparent) transparent++;
            }
            long triangles = 0;
            foreach (MeshFilter filter in filters) if (filter.sharedMesh != null) triangles += filter.sharedMesh.triangles.LongLength / 3L;
            int particleCapacity = 0;
            foreach (ParticleSystem particle in particles) particleCapacity += particle.main.maxParticles;
            int shadowLights = lights.Count(light => light.enabled && light.shadows != LightShadows.None);
            int realtimeLights = lights.Count(light => light.enabled && light.lightmapBakeType == LightmapBakeType.Realtime);
            var reflection = UnityEngine.Object.FindFirstObjectByType<PlanarReflection>(FindObjectsInactive.Include);
            int reflectionSize = reflection != null ? reflection.TextureSize : 0;

            bool pass = renderers.Length <= profile.MaxRenderers && materials.Count <= profile.MaxMaterials && realtimeLights <= profile.MaxRealtimeLights
                && shadowLights <= profile.MaxShadowedLights && particleCapacity <= profile.MaxParticleCapacity && triangles <= profile.MaxVisibleTriangles
                && transparent <= profile.MaxTransparentRenderers && reflectionSize <= profile.MaxReflectionTextureSize;
            string Mark(bool okay) => okay ? "OK" : "OVER";
            var text = new StringBuilder();
            text.AppendLine($"Renderers          {renderers.Length,8:N0} / {profile.MaxRenderers,8:N0}  {Mark(renderers.Length <= profile.MaxRenderers)}");
            text.AppendLine($"Unique materials    {materials.Count,8:N0} / {profile.MaxMaterials,8:N0}  {Mark(materials.Count <= profile.MaxMaterials)}");
            text.AppendLine($"Realtime lights     {realtimeLights,8:N0} / {profile.MaxRealtimeLights,8:N0}  {Mark(realtimeLights <= profile.MaxRealtimeLights)}");
            text.AppendLine($"Shadowed lights     {shadowLights,8:N0} / {profile.MaxShadowedLights,8:N0}  {Mark(shadowLights <= profile.MaxShadowedLights)}");
            text.AppendLine($"Particle capacity   {particleCapacity,8:N0} / {profile.MaxParticleCapacity,8:N0}  {Mark(particleCapacity <= profile.MaxParticleCapacity)}");
            text.AppendLine($"Loaded triangles    {triangles,8:N0} / {profile.MaxVisibleTriangles,8:N0}  {Mark(triangles <= profile.MaxVisibleTriangles)}");
            text.AppendLine($"Transparent slots   {transparent,8:N0} / {profile.MaxTransparentRenderers,8:N0}  {Mark(transparent <= profile.MaxTransparentRenderers)}");
            text.AppendLine($"Reflection pixels   {reflectionSize,8:N0} / {profile.MaxReflectionTextureSize,8:N0}  {Mark(reflectionSize <= profile.MaxReflectionTextureSize)}");
            text.Append(pass ? "\nWithin authoring budgets." : "\nOne or more authoring budgets are exceeded. Profile before reducing quality blindly.");
            return new JetHorizonAuditReport(pass, text.ToString());
        }
    }

    public static class JetHorizonProjectValidator
    {
        public static string Validate(JetHorizonAuthoringProfile profile)
        {
            var messages = new List<string>();
            void Require(bool condition, string success, string failure) => messages.Add(condition ? "OK     " + success : "ERROR  " + failure);
            Require(profile != null, "Authoring profile exists", "Authoring profile is missing");
            if (profile == null) return string.Join("\n", messages);
            Require(AssetDatabase.LoadAssetAtPath<SceneAsset>(profile.GameScenePath) != null, "Game scene resolves", "Game scene path is invalid");
            Require(profile.SunMaterial != null, "Sun material assigned", "Sun material missing");
            Require(profile.StarMaterial != null, "Star material assigned", "Star material missing");
            Require(profile.WaterMaterial != null, "Water material assigned", "Water material missing");
            Require(profile.PostProfile != null, "Post profile assigned", "Post profile missing");
            Require(profile.Canyon != null && profile.Canyon.Points.Count >= 2, "Canyon path has at least two points", "Canyon path requires two points");
            if (profile.Canyon != null)
            {
                Require(profile.Canyon.Points.All(point => point.HalfWidth >= 5f), "Canyon widths are valid", "A canyon point is narrower than the safety minimum");
                Require(profile.Canyon.SampleSpacing <= profile.Canyon.ChunkLength, "Canyon sampling fits its chunks", "Sample spacing exceeds chunk length");
            }
            if (SceneManager.GetActiveScene().IsValid() && SceneManager.GetActiveScene().isLoaded)
            {
                Require(UnityEngine.Object.FindFirstObjectByType<GameManager>(FindObjectsInactive.Include) != null, "GameManager loaded", "Loaded scene has no GameManager");
                Require(UnityEngine.Object.FindFirstObjectByType<ThrusterFX>(FindObjectsInactive.Include) != null, "ThrusterFX loaded", "Loaded scene has no ThrusterFX");
                Require(UnityEngine.Object.FindFirstObjectByType<PlanarReflection>(FindObjectsInactive.Include) != null, "Planar reflection loaded", "Loaded scene has no PlanarReflection");
                Require(Camera.main != null, "Main camera tagged", "No Main Camera is tagged");
            }
            return string.Join("\n", messages);
        }
    }
}
