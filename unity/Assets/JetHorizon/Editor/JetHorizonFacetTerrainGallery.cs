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
            "02 WATERLINE MONOLITH — isolated formation",
            "03 RIDGE — variable macro silhouette",
            "04 CURVED BANK — connected surface, no slab seams",
            "05 CONTINUOUS CANYON — paired curved land masses",
            "06 LOW SHELF — half-submerged terrain beat"
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

            Mesh monolith = FacetTerrainMeshFactory.BuildMass(
                Stations(0f, 72f, 9,
                    t => Mathf.Sin(t * Mathf.PI * 1.3f) * 3f,
                    t => Mathf.Lerp(30f, 58f, Mathf.SmoothStep(0f, 1f, Mathf.Sin(t * Mathf.PI))),
                    t => 55f + Mathf.Sin(t * Mathf.PI) * 18f,
                    t => Mathf.Lerp(.65f, 1.1f, t)), style, 11, "JH_WaterlineMonolith");
            Add(SpecimenNames[1], monolith, terrainMaterial, Vector3.zero);

            Mesh ridge = FacetTerrainMeshFactory.BuildMass(
                Stations(0f, 130f, 16,
                    t => Mathf.Sin(t * Mathf.PI * 2f) * 7f,
                    t => 24f + Mathf.Pow(Mathf.Sin(t * Mathf.PI), .65f) * 56f,
                    t => 48f + Mathf.Sin(t * Mathf.PI) * 38f,
                    t => .55f + Mathf.Sin(t * Mathf.PI) * .75f), style, 23, "JH_FacetRidge");
            Add(SpecimenNames[2], ridge, terrainMaterial, Vector3.zero);

            Mesh curvedBank = FacetTerrainMeshFactory.BuildMass(
                Stations(0f, 190f, 24,
                    t => Mathf.Sin(t * Mathf.PI * 1.7f) * 24f,
                    t => 48f + Mathf.Sin(t * Mathf.PI * 3f + .4f) * 9f,
                    t => 70f + Mathf.Sin(t * Mathf.PI) * 22f,
                    t => .85f + Mathf.Sin(t * Mathf.PI * 2f) * .22f), style, 41, "JH_CurvedFacetBank");
            Add(SpecimenNames[3], curvedBank, terrainMaterial, Vector3.zero);

            BuildCanyonSpecimen(style, terrainMaterial);

            Mesh lowShelf = FacetTerrainMeshFactory.BuildMass(
                Stations(0f, 118f, 14,
                    t => Mathf.Sin(t * Mathf.PI * 2.4f) * 12f,
                    t => 16f + Mathf.Sin(t * Mathf.PI) * 18f,
                    t => 80f,
                    t => .35f + Mathf.Sin(t * Mathf.PI) * .45f), style, 67, "JH_LowFacetShelf");
            Add(SpecimenNames[5], lowShelf, terrainMaterial, new Vector3(0f, -6f, 0f));

            EditorSceneManager.SaveScene(scene, ScenePath);
            FacetTerrainGalleryWindow.ShowWindow();
            SelectSpecimen(0);
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

            var root = new GameObject(SpecimenNames[4]);
            Mesh rightMesh = FacetTerrainMeshFactory.BuildMass(right, style, 53, "JH_CanyonRightMass");
            Mesh leftMesh = FacetTerrainMeshFactory.BuildMass(leftMirrored, style, 59, "JH_CanyonLeftMass");
            AddChild(root.transform, "Right continuous bank", rightMesh, material, Vector3.one);
            AddChild(root.transform, "Left continuous bank", leftMesh, material, new Vector3(-1f, 1f, 1f));
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
        {
            Mesh mesh = SaveMesh(source, Sanitize(name));
            GameObject child = new GameObject(name);
            child.transform.SetParent(parent, false);
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

        internal static void SelectSpecimen(int selectedIndex)
        {
            GameObject selected = null;
            GameObject[] all = Resources.FindObjectsOfTypeAll<GameObject>();
            for (int nameIndex = 0; nameIndex < SpecimenNames.Length; nameIndex++)
            {
                for (int objectIndex = 0; objectIndex < all.Length; objectIndex++)
                {
                    GameObject candidate = all[objectIndex];
                    if (candidate.name != SpecimenNames[nameIndex] || !candidate.scene.IsValid()) continue;
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

        internal static void ShowWindow()
        {
            FacetTerrainGalleryWindow window = GetWindow<FacetTerrainGalleryWindow>("Facet Terrain Review");
            window.minSize = new Vector2(390f, 300f);
            window.Show();
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
