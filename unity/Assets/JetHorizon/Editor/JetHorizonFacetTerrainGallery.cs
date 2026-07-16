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
            GameObject canonical = Add("01 SOURCE PARITY — canonical Three.js slab", parity, terrainMaterial, new Vector3(-145f, 0f, 45f));

            Mesh monolith = FacetTerrainMeshFactory.BuildMass(
                Stations(0f, 72f, 9,
                    t => Mathf.Sin(t * Mathf.PI * 1.3f) * 3f,
                    t => Mathf.Lerp(30f, 58f, Mathf.SmoothStep(0f, 1f, Mathf.Sin(t * Mathf.PI))),
                    t => 55f + Mathf.Sin(t * Mathf.PI) * 18f,
                    t => Mathf.Lerp(.65f, 1.1f, t)), style, 11, "JH_WaterlineMonolith");
            Add("02 WATERLINE MONOLITH — isolated formation", monolith, terrainMaterial, new Vector3(-78f, 0f, 28f));

            Mesh ridge = FacetTerrainMeshFactory.BuildMass(
                Stations(0f, 130f, 16,
                    t => Mathf.Sin(t * Mathf.PI * 2f) * 7f,
                    t => 24f + Mathf.Pow(Mathf.Sin(t * Mathf.PI), .65f) * 56f,
                    t => 48f + Mathf.Sin(t * Mathf.PI) * 38f,
                    t => .55f + Mathf.Sin(t * Mathf.PI) * .75f), style, 23, "JH_FacetRidge");
            Add("03 RIDGE — variable macro silhouette", ridge, terrainMaterial, new Vector3(2f, 0f, 0f));

            Mesh curvedBank = FacetTerrainMeshFactory.BuildMass(
                Stations(0f, 190f, 24,
                    t => Mathf.Sin(t * Mathf.PI * 1.7f) * 24f,
                    t => 48f + Mathf.Sin(t * Mathf.PI * 3f + .4f) * 9f,
                    t => 70f + Mathf.Sin(t * Mathf.PI) * 22f,
                    t => .85f + Mathf.Sin(t * Mathf.PI * 2f) * .22f), style, 41, "JH_CurvedFacetBank");
            Add("04 CURVED BANK — connected surface, no slab seams", curvedBank, terrainMaterial, new Vector3(93f, 0f, -25f));

            BuildCanyonSpecimen(style, terrainMaterial);

            Mesh lowShelf = FacetTerrainMeshFactory.BuildMass(
                Stations(0f, 118f, 14,
                    t => Mathf.Sin(t * Mathf.PI * 2.4f) * 12f,
                    t => 16f + Mathf.Sin(t * Mathf.PI) * 18f,
                    t => 80f,
                    t => .35f + Mathf.Sin(t * Mathf.PI) * .45f), style, 67, "JH_LowFacetShelf");
            Add("06 LOW SHELF — half-submerged terrain beat", lowShelf, terrainMaterial, new Vector3(-112f, -6f, -112f));

            EditorSceneManager.SaveScene(scene, ScenePath);
            Selection.activeGameObject = canonical;
            SceneView.lastActiveSceneView?.FrameSelected();
            Debug.Log("[Jet Horizon] Facet Terrain Gallery created. Compare specimen 01 against the original slab, then judge whether 02–06 preserve the same planar angular DNA at terrain scale.");
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

            var root = new GameObject("05 CONTINUOUS CANYON — paired curved land masses");
            root.transform.position = new Vector3(-15f, 0f, -175f);
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
            Material material = AssetDatabase.LoadAssetAtPath<Material>(JetHorizonAuthoringProject.HybridCanyonMaterialPath);
            if (material != null) return material;
            HybridCanyonWorldProfile profile = JetHorizonAuthoringProject.LoadOrCreateHybridCanyonProfile(null);
            return profile != null ? profile.CanyonMaterial : null;
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
}
