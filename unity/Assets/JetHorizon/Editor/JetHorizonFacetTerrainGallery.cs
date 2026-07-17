using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace JetHorizon.EditorTools
{
    /// <summary>
    /// An isolated visual acceptance gate for the terrain surface language. Nothing in
    /// this scene is used by gameplay until its shapes have been visually approved.
    /// </summary>
    public static class JetHorizonFacetTerrainGallery
    {
        const string RootFolder = "Assets/JetHorizon/Generated/FacetTerrainGallery";
        const string ScenePath = RootFolder + "/FacetTerrainGallery.unity";
        internal static readonly string[] SpecimenNames =
        {
            "01 SOURCE PARITY — canonical Three.js slab",
            "02 LOW BANK — mirrored-canyon candidate",
            "03 BOULDER SLALOM — closed waterline monoliths",
            "04 KNIFE RIDGE — long low-to-high formation",
            "05 NATURAL GATE — pillars and overhead bridge",
            "06 CONTINUOUS CANYON — paired curved land masses",
            "07 LOW SHELF — half-submerged terrain beat"
        };

        [MenuItem("Jet Horizon/Facet Terrain Gallery", priority = 1)]
        public static void Open()
        {
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            EnsureFolder(RootFolder);
            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            scene.name = "FacetTerrainGallery";

            FacetSurfaceStyle style = FacetSurfaceStyle.ThreeJsSource;
            Material terrainMaterial = LoadTerrainMaterial();
            BuildLightingAndWater();

            Mesh parity = FacetTerrainMeshFactory.BuildThreeJsParitySlab(style, 1);
            ValidateParity(style, parity);
            GameObject canonical = Add(SpecimenNames[0], parity, terrainMaterial, Vector3.zero);

            Mesh lowBank = FacetTerrainMeshFactory.BuildMass(
                Stations(0f, 56f, 7,
                    t => Mathf.Sin(t * Mathf.PI * 1.4f) * 2f,
                    t => 62f + Mathf.Pow(Mathf.Sin(t * Mathf.PI), .7f) * 42f,
                    t => 62f + Mathf.Sin(t * Mathf.PI) * 15f,
                    t => 1.05f + Mathf.Sin(t * Mathf.PI) * .32f), style, 11, "JH_LowFacetBank");
            Add(SpecimenNames[1], lowBank, terrainMaterial, Vector3.zero);

            BuildBoulderSlalomSpecimen(style, terrainMaterial);

            Mesh ridge = FacetTerrainMeshFactory.BuildMass(
                Stations(0f, 220f, 20,
                    t => Mathf.Sin(t * Mathf.PI * 1.25f) * 14f,
                    t => 14f + Mathf.Pow(Mathf.Sin(t * Mathf.PI), .55f) * 70f,
                    t => 34f + Mathf.Sin(t * Mathf.PI) * 36f,
                    t => .32f + Mathf.Sin(t * Mathf.PI) * .58f), style, 23, "JH_FacetKnifeRidge");
            Add(SpecimenNames[3], ridge, terrainMaterial, Vector3.zero);

            BuildNaturalGateSpecimen(style, terrainMaterial);

            BuildCanyonSpecimen(style, terrainMaterial);

            Mesh lowShelf = FacetTerrainMeshFactory.BuildMass(
                Stations(0f, 180f, 16,
                    t => Mathf.Sin(t * Mathf.PI * 2.1f) * 18f,
                    t => 10f + Mathf.Sin(t * Mathf.PI) * 15f,
                    t => 105f + Mathf.Sin(t * Mathf.PI) * 25f,
                    t => .18f + Mathf.Sin(t * Mathf.PI) * .20f), style, 67, "JH_LowFacetShelf");
            Add(SpecimenNames[6], lowShelf, terrainMaterial, new Vector3(0f, -8f, 0f));

            SelectSpecimen(0, false);
            EditorSceneManager.SaveScene(scene, ScenePath);
            FacetTerrainGalleryWindow.ShowWindow(0);
            Debug.Log("[Jet Horizon] Facet Terrain Gallery created. Use the Facet Terrain Review window to inspect one formation at a time.");
        }

        static void BuildCanyonSpecimen(FacetSurfaceStyle style, Material material)
        {
            const int segments = 28;
            const float length = 230f;
            var right = new List<FacetMassStation>(segments + 1);
            var leftMirrored = new List<FacetMassStation>(segments + 1);
            for (int i = 0; i <= segments; i++)
            {
                float t = i / (float)segments;
                float z = t * length;
                float center = Mathf.Sin(t * Mathf.PI * 2.35f) * 25f + Mathf.Sin(t * Mathf.PI * 4.1f) * 6f;
                float halfWidth = 32f + Mathf.Sin(t * Mathf.PI * 3f + .7f) * 5f;
                float height = 52f + Mathf.Sin(t * Mathf.PI * 2f) * 10f;
                right.Add(new FacetMassStation(z, center + halfWidth, height, 82f, 1f));
                // The left mesh is mirrored after generation. Negate its desired world X here.
                leftMirrored.Add(new FacetMassStation(z, -center + halfWidth, height * .96f, 82f, 1f));
            }

            var root = new GameObject(SpecimenNames[5]);
            Mesh rightMesh = FacetTerrainMeshFactory.BuildMass(right, style, 53, "JH_CanyonRightMass");
            Mesh leftMesh = FacetTerrainMeshFactory.BuildMass(leftMirrored, style, 59, "JH_CanyonLeftMass");
            AddChild(root.transform, "Right continuous bank", rightMesh, material, Vector3.one);
            AddChild(root.transform, "Left continuous bank", leftMesh, material, new Vector3(-1f, 1f, 1f));
        }

        static void BuildNaturalGateSpecimen(FacetSurfaceStyle style, Material material)
        {
            var root = new GameObject(SpecimenNames[4]);
            List<FacetMassStation> pillarStations = Stations(0f, 64f, 8,
                t => 30f + Mathf.Sin(t * Mathf.PI) * 2.5f,
                t => 66f + Mathf.Sin(t * Mathf.PI) * 10f,
                t => 86f,
                t => .9f + Mathf.Sin(t * Mathf.PI) * .16f);
            Mesh right = FacetTerrainMeshFactory.BuildMass(pillarStations, style, 41, "JH_NaturalGateRightPillar");
            Mesh left = FacetTerrainMeshFactory.BuildMass(pillarStations, style, 43, "JH_NaturalGateLeftPillar");
            AddChild(root.transform, "Right gate pillar", right, material, Vector3.one);
            AddChild(root.transform, "Left gate pillar", left, material, new Vector3(-1f, 1f, 1f));

            // The overhead bridge uses the same source face, rotated so its 20-unit
            // patch spans the opening rather than introducing a generic cube.
            Mesh bridge = FacetTerrainMeshFactory.BuildThreeJsParitySlab(style, 47);
            AddChild(root.transform, "Facet bridge", bridge, material,
                new Vector3(-32f, 58f, 60f), Quaternion.Euler(0f, 90f, 0f), new Vector3(.72f, .34f, 3.2f));
        }

        static void BuildBoulderSlalomSpecimen(FacetSurfaceStyle style, Material material)
        {
            var root = new GameObject(SpecimenNames[2]);
            var placements = new[]
            {
                (x: -38f, z:   0f, radius: 24f, height: 43f, seed: 101),
                (x:  35f, z:  82f, radius: 30f, height: 54f, seed: 107),
                (x: -31f, z: 178f, radius: 27f, height: 48f, seed: 113),
                (x:  41f, z: 286f, radius: 34f, height: 61f, seed: 127),
                (x: -34f, z: 405f, radius: 28f, height: 50f, seed: 131)
            };
            for (int i = 0; i < placements.Length; i++)
            {
                var p = placements[i];
                Mesh boulder = FacetTerrainMeshFactory.BuildBoulder(
                    style, p.seed, p.radius, p.height, 6, p.height * .17f, .38f,
                    $"JH_SlalomBoulder_{i + 1:00}");
                AddChild(root.transform, $"Boulder {i + 1:00}", boulder, material,
                    new Vector3(p.x, 0f, p.z), Quaternion.Euler(0f, p.seed % 37, 0f), Vector3.one);
            }
        }

        static List<FacetMassStation> Stations(
            float zStart,
            float length,
            int segments,
            Func<float, float> innerX,
            Func<float, float> height,
            Func<float, float> depth,
            Func<float, float> profileScale)
        {
            var result = new List<FacetMassStation>(segments + 1);
            for (int i = 0; i <= segments; i++)
            {
                float t = i / (float)segments;
                result.Add(new FacetMassStation(
                    zStart + length * t,
                    innerX(t),
                    Mathf.Max(6f, height(t)),
                    Mathf.Max(12f, depth(t)),
                    Mathf.Max(.15f, profileScale(t))));
            }
            return result;
        }

        static GameObject Add(string name, Mesh source, Material material, Vector3 position)
        {
            GameObject root = new GameObject(name);
            root.transform.position = position;
            AddChild(root.transform, "Opaque facet mass", source, material, Vector3.one);
            return root;
        }

        static void AddChild(Transform parent, string name, Mesh source, Material material, Vector3 scale)
            => AddChild(parent, name, source, material, Vector3.zero, Quaternion.identity, scale);

        static void AddChild(
            Transform parent,
            string name,
            Mesh source,
            Material material,
            Vector3 position,
            Quaternion rotation,
            Vector3 scale)
        {
            Mesh mesh = SaveMesh(source, Sanitize(name));
            GameObject child = new GameObject(name);
            child.transform.SetParent(parent, false);
            child.transform.localPosition = position;
            child.transform.localRotation = rotation;
            child.transform.localScale = scale;
            child.AddComponent<MeshFilter>().sharedMesh = mesh;
            child.AddComponent<MeshRenderer>().sharedMaterial = material;
        }

        static Mesh SaveMesh(Mesh source, string fileName)
        {
            string path = RootFolder + "/" + fileName + ".asset";
            Mesh existing = AssetDatabase.LoadAssetAtPath<Mesh>(path);
            if (existing == null)
            {
                AssetDatabase.CreateAsset(source, path);
                return source;
            }
            EditorUtility.CopySerialized(source, existing);
            UnityEngine.Object.DestroyImmediate(source);
            EditorUtility.SetDirty(existing);
            return existing;
        }

        static string Sanitize(string value)
        {
            foreach (char invalid in System.IO.Path.GetInvalidFileNameChars()) value = value.Replace(invalid, '_');
            return value.Replace(' ', '_');
        }

        static Material LoadTerrainMaterial()
        {
            const string materialPath = RootFolder + "/FacetTerrainSurface.mat";
            const string texturePath = "Assets/JetHorizon/Generated/HybridCanyon/HybridCanyonCyanSurface.asset";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(materialPath);
            Shader shader = Shader.Find("JH/FacetTerrain");
            if (shader == null) throw new InvalidOperationException("The JH/FacetTerrain shader has not imported yet.");
            if (material == null)
            {
                material = new Material(shader) { name = "Facet Terrain Surface" };
                AssetDatabase.CreateAsset(material, materialPath);
            }
            else if (material.shader != shader) material.shader = shader;

            Texture2D surface = AssetDatabase.LoadAssetAtPath<Texture2D>(texturePath);
            if (surface == null)
            {
                string localTexturePath = RootFolder + "/FacetTerrainCyanSurface.asset";
                surface = AssetDatabase.LoadAssetAtPath<Texture2D>(localTexturePath);
                if (surface == null)
                {
                    surface = TextureFactory.CyanSlab();
                    surface.name = "FacetTerrainCyanSurface";
                    surface.wrapMode = TextureWrapMode.Repeat;
                    AssetDatabase.CreateAsset(surface, localTexturePath);
                }
            }
            material.SetTexture("_Surface", surface);
            material.SetColor("_Body", new Color(.045f, .24f, .30f, 1f));
            material.SetFloat("_Brightness", .88f);
            material.SetFloat("_Emission", .20f);
            EditorUtility.SetDirty(material);
            AssetDatabase.SaveAssets();
            return material;
        }

        internal static void SelectSpecimen(int selectedIndex, bool saveScene = true)
        {
            selectedIndex = Mathf.Clamp(selectedIndex, 0, SpecimenNames.Length - 1);
            GameObject selected = null;
            GameObject[] all = Resources.FindObjectsOfTypeAll<GameObject>();
            Scene activeScene = SceneManager.GetActiveScene();
            for (int nameIndex = 0; nameIndex < SpecimenNames.Length; nameIndex++)
            {
                for (int objectIndex = 0; objectIndex < all.Length; objectIndex++)
                {
                    GameObject candidate = all[objectIndex];
                    if (candidate.name != SpecimenNames[nameIndex]
                        || candidate.scene != activeScene
                        || candidate.transform.parent != null) continue;
                    bool active = nameIndex == selectedIndex;
                    candidate.SetActive(active);
                    if (active) selected = candidate;
                }
            }
            if (selected == null) return;
            Selection.activeGameObject = selected;
            Renderer[] renderers = selected.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length > 0)
            {
                Bounds bounds = renderers[0].bounds;
                for (int i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
                SceneView.lastActiveSceneView?.Frame(bounds, false);
            }
            SessionState.SetInt("JH.FacetTerrainGallery.Selected", selectedIndex);
            EditorSceneManager.MarkSceneDirty(activeScene);
            if (saveScene && !string.IsNullOrEmpty(activeScene.path)) EditorSceneManager.SaveScene(activeScene);
            SceneView.RepaintAll();
        }

        static void BuildLightingAndWater()
        {
            var cameraObject = new GameObject("Main Camera") { tag = "MainCamera" };
            Camera camera = cameraObject.AddComponent<Camera>();
            camera.fieldOfView = 55f;
            camera.nearClipPlane = .3f;
            camera.farClipPlane = 1200f;
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(.012f, .025f, .055f);
            cameraObject.transform.position = new Vector3(0f, 105f, 270f);
            cameraObject.transform.LookAt(new Vector3(0f, 24f, -90f));
            cameraObject.AddComponent<AudioListener>();

            var key = new GameObject("Gallery Sun").AddComponent<Light>();
            key.type = LightType.Directional;
            key.intensity = 2.1f;
            key.color = new Color(1f, .78f, .58f);
            key.transform.rotation = Quaternion.Euler(28f, -38f, 0f);
            var rim = new GameObject("Gallery Cyan Rim").AddComponent<Light>();
            rim.type = LightType.Directional;
            rim.intensity = .85f;
            rim.color = new Color(.15f, .72f, 1f);
            rim.transform.rotation = Quaternion.Euler(18f, 145f, 0f);
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(.09f, .12f, .18f);
            RenderSettings.fog = false;

            GameObject water = GameObject.CreatePrimitive(PrimitiveType.Plane);
            water.name = "Reference Waterline (y = 0)";
            water.transform.position = new Vector3(0f, -.75f, -90f);
            water.transform.localScale = new Vector3(48f, 1f, 55f);
            UnityEngine.Object.DestroyImmediate(water.GetComponent<Collider>());
            Material waterMaterial = AssetDatabase.LoadAssetAtPath<Material>("Assets/JetHorizon/Generated/WaterMat.mat");
            if (waterMaterial == null)
            {
                Shader shader = Shader.Find("Universal Render Pipeline/Lit");
                waterMaterial = new Material(shader) { name = "Facet Gallery Water" };
                waterMaterial.color = new Color(.015f, .08f, .12f);
            }
            water.GetComponent<MeshRenderer>().sharedMaterial = waterMaterial;
        }

        static void ValidateParity(FacetSurfaceStyle style, Mesh mesh)
        {
            Mesh repeat = FacetTerrainMeshFactory.BuildThreeJsParitySlab(style, 1);
            bool deterministic = FacetTerrainMeshFactory.SameVertexData(mesh, repeat);
            UnityEngine.Object.DestroyImmediate(repeat);
            int expectedTriangles = style.Rows * style.Columns * 4 + style.Columns * 4 + style.Rows * 4;
            if (!deterministic || mesh.vertexCount != expectedTriangles * 3 || mesh.triangles.Length / 3 != expectedTriangles)
                throw new InvalidOperationException("The canonical facet parity mesh failed deterministic topology validation.");
            if (!Mathf.Approximately(mesh.bounds.min.z, 0f) || !Mathf.Approximately(mesh.bounds.max.z, style.Length))
                throw new InvalidOperationException("The parity slab no longer matches the source 0..Length local-Z convention.");
        }

        static void EnsureFolder(string path)
        {
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

    public sealed class FacetTerrainGalleryWindow : EditorWindow
    {
        int _selected;

        internal static void ShowWindow(int selected = -1)
        {
            FacetTerrainGalleryWindow window = GetWindow<FacetTerrainGalleryWindow>("Facet Terrain Review");
            window.minSize = new Vector2(390f, 340f);
            window._selected = selected >= 0
                ? selected
                : SessionState.GetInt("JH.FacetTerrainGallery.Selected", 0);
            window.Show();
        }

        void OnEnable()
        {
            _selected = SessionState.GetInt("JH.FacetTerrainGallery.Selected", 0);
        }

        void OnGUI()
        {
            EditorGUILayout.LabelField("FACET TERRAIN REVIEW", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "Only one specimen is shown at a time. Start with the exact source slab, then compare whether each larger formation keeps the same angular surface language.",
                MessageType.Info);
            EditorGUILayout.Space(6f);
            for (int i = 0; i < JetHorizonFacetTerrainGallery.SpecimenNames.Length; i++)
            {
                GUI.backgroundColor = i == _selected ? new Color(.35f, .9f, 1f) : Color.white;
                if (GUILayout.Button(JetHorizonFacetTerrainGallery.SpecimenNames[i], GUILayout.Height(30f)))
                {
                    _selected = i;
                    JetHorizonFacetTerrainGallery.SelectSpecimen(i);
                }
            }
            GUI.backgroundColor = Color.white;
            EditorGUILayout.Space(8f);
            EditorGUILayout.LabelField("This gallery does not change the live game canyon.", EditorStyles.miniLabel);
        }
    }
}
