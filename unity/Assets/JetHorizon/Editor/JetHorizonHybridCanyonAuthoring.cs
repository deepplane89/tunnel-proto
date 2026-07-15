using UnityEditor;
using UnityEngine;
using System.Collections.Generic;
using System.IO;

namespace JetHorizon.EditorTools
{
    /// <summary>Thin editor seam over the same runtime presenter used by gameplay.</summary>
    public static class JetHorizonHybridCanyonAuthoring
    {
        public const string PreviewName = "JH_HybridCanyonWorldPreview";

        public static GameObject BuildPreview(HybridCanyonWorldProfile profile)
        {
            ClearPreview();
            if (profile == null)
            {
                EditorUtility.DisplayDialog("Hybrid canyon", "Assign a hybrid canyon world profile first.", "OK");
                return null;
            }

            var root = new GameObject(PreviewName);
            Undo.RegisterCreatedObjectUndo(root, "Build hybrid canyon preview");
            var presenter = root.AddComponent<HybridCanyonWorldPresenter>();
            presenter.Profile = profile;
            presenter.RebuildForEditorPreview();
            Selection.activeGameObject = root;
            SceneView.lastActiveSceneView?.FrameSelected();
            return root;
        }

        public static void ClearPreview()
        {
            GameObject root = GameObject.Find(PreviewName);
            if (root != null) Undo.DestroyObjectImmediate(root);
        }

        public static bool BakePreviewForMobile(HybridCanyonWorldProfile profile)
        {
            if (profile == null) return false;
            GameObject preview = GameObject.Find(PreviewName);
            if (preview == null) preview = BuildPreview(profile);
            var presenter = preview != null ? preview.GetComponent<HybridCanyonWorldPresenter>() : null;
            Terrain sourceTerrain = presenter != null ? presenter.GeneratedTerrain : null;
            if (presenter == null || presenter.WorldContent == null || sourceTerrain == null)
            {
                EditorUtility.DisplayDialog("Hybrid canyon", "The editable Terrain preview could not be found. Click Create Editable Canyon and try again.", "OK");
                return false;
            }

            const string directory = "Assets/JetHorizon/Generated/HybridCanyon";
            EnsureFolder(directory);
            GameObject baked = Object.Instantiate(presenter.WorldContent.gameObject);
            baked.name = "Jet Horizon Hybrid Canyon (Baked)";
            baked.SetActive(true);
            Terrain clonedTerrain = baked.GetComponentInChildren<Terrain>(true);
            if (clonedTerrain == null)
            {
                Object.DestroyImmediate(baked);
                return false;
            }

            var transientMeshes = new List<Object>();
            HybridCanyonWorldPresenter.BuildTerrainMeshChunks(
                clonedTerrain.terrainData,
                clonedTerrain.transform.localPosition,
                baked.transform,
                profile.CanyonMaterial,
                profile.Settings ?? new HybridCanyonWorldSettings(),
                transientMeshes);
            Object.DestroyImmediate(clonedTerrain.gameObject);

            if (!ValidateContinuousTerrainChunks(baked, profile.Settings, out string continuityError))
            {
                Object.DestroyImmediate(baked);
                for (int i = 0; i < transientMeshes.Count; i++)
                    if (transientMeshes[i] != null) Object.DestroyImmediate(transientMeshes[i]);
                EditorUtility.DisplayDialog(
                    "Canyon bake stopped",
                    "The canyon did not pass its no-gaps check, so it was not assigned to gameplay.\n\n" + continuityError,
                    "OK");
                return false;
            }

            MeshFilter[] filters = baked.GetComponentsInChildren<MeshFilter>(true);
            for (int i = 0; i < filters.Length; i++)
            {
                Mesh source = filters[i].sharedMesh;
                if (source == null) continue;
                Mesh persistent = Object.Instantiate(source);
                persistent.name = $"HybridCanyon_{i:000}_{Sanitize(filters[i].gameObject.name)}";
                string path = $"{directory}/{persistent.name}.asset";
                if (AssetDatabase.LoadAssetAtPath<Mesh>(path) != null) AssetDatabase.DeleteAsset(path);
                AssetDatabase.CreateAsset(persistent, path);
                filters[i].sharedMesh = persistent;
            }

            string prefabPath = $"{directory}/JetHorizonHybridCanyon.prefab";
            PrefabUtility.SaveAsPrefabAsset(baked, prefabPath);
            Object.DestroyImmediate(baked);
            for (int i = 0; i < transientMeshes.Count; i++)
                if (transientMeshes[i] != null && !AssetDatabase.Contains(transientMeshes[i])) Object.DestroyImmediate(transientMeshes[i]);

            profile.BakedWorldPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            EditorUtility.SetDirty(profile);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Selection.activeObject = profile.BakedWorldPrefab;
            Debug.Log($"[JetHorizon] Hybrid canyon baked for mobile and assigned to {profile.name}: {prefabPath}");
            return profile.BakedWorldPrefab != null;
        }

        static bool ValidateContinuousTerrainChunks(
            GameObject baked,
            HybridCanyonWorldSettings settings,
            out string error)
        {
            error = string.Empty;
            if (baked == null || settings == null)
            {
                error = "Missing baked canyon or settings.";
                return false;
            }

            var chunks = new List<MeshFilter>();
            MeshFilter[] filters = baked.GetComponentsInChildren<MeshFilter>(true);
            for (int i = 0; i < filters.Length; i++)
                if (filters[i].gameObject.name.StartsWith("Terrain Chunk")) chunks.Add(filters[i]);
            chunks.Sort((a, b) => string.CompareOrdinal(a.gameObject.name, b.gameObject.name));
            if (chunks.Count < 2)
            {
                error = "Fewer than two terrain chunks were generated.";
                return false;
            }

            int columns = Mathf.Max(4, settings.MeshCrossSegments) + 1;
            const float tolerance = .002f;
            for (int chunk = 0; chunk < chunks.Count - 1; chunk++)
            {
                Vector3[] a = chunks[chunk].sharedMesh != null ? chunks[chunk].sharedMesh.vertices : null;
                Vector3[] b = chunks[chunk + 1].sharedMesh != null ? chunks[chunk + 1].sharedMesh.vertices : null;
                if (a == null || b == null || a.Length < columns || b.Length < columns)
                {
                    error = $"Chunk {chunk:00} has invalid mesh data.";
                    return false;
                }
                int lastRow = a.Length - columns;
                for (int x = 0; x < columns; x++)
                {
                    float gap = Vector3.Distance(a[lastRow + x], b[x]);
                    if (gap <= tolerance) continue;
                    error = $"Chunks {chunk:00} and {chunk + 1:00} separate by {gap:0.0000} units at edge sample {x}.";
                    return false;
                }
            }

            if (baked.GetComponentInChildren<Terrain>(true) != null
                || baked.GetComponentInChildren<TerrainCollider>(true) != null)
            {
                error = "A live Terrain or TerrainCollider remained in the mobile bake.";
                return false;
            }
            return true;
        }

        public static bool QuickBuildForMobile(HybridCanyonWorldProfile profile)
        {
            if (BuildPreview(profile) == null) return false;
            return BakePreviewForMobile(profile);
        }

        public static void SelectEditableTerrain()
        {
            GameObject preview = GameObject.Find(PreviewName);
            Terrain terrain = preview != null ? preview.GetComponentInChildren<Terrain>(true) : null;
            if (terrain == null)
            {
                EditorUtility.DisplayDialog("Hybrid canyon", "Create the editable canyon first.", "OK");
                return;
            }
            Selection.activeGameObject = terrain.gameObject;
            SceneView.lastActiveSceneView?.FrameSelected();
        }

        static string Sanitize(string value)
        {
            foreach (char invalid in Path.GetInvalidFileNameChars()) value = value.Replace(invalid, '_');
            return value.Replace(' ', '_');
        }

        static void EnsureFolder(string path)
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
}
