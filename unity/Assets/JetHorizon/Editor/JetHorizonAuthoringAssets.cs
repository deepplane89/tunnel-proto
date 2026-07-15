using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace JetHorizon.EditorTools
{
    [Serializable]
    public struct CanyonAuthoringPoint
    {
        public Vector3 Position;
        [Min(5f)] public float HalfWidth;

        public CanyonAuthoringPoint(Vector3 position, float halfWidth)
        {
            Position = position;
            HalfWidth = halfWidth;
        }
    }

    /// <summary>Editor-owned canyon path. It is baked into ordinary meshes/prefabs and is not loaded by a player build.</summary>
    public sealed class JetHorizonCanyonAuthoring : ScriptableObject
    {
        public List<CanyonAuthoringPoint> Points = new List<CanyonAuthoringPoint>
        {
            new CanyonAuthoringPoint(new Vector3(0f, 0f, -35f), 42f),
            new CanyonAuthoringPoint(new Vector3(0f, 0f, -120f), 38f),
            new CanyonAuthoringPoint(new Vector3(18f, 0f, -220f), 34f),
            new CanyonAuthoringPoint(new Vector3(-12f, 0f, -330f), 30f),
            new CanyonAuthoringPoint(new Vector3(8f, 0f, -460f), 34f),
        };

        [Header("Chunking")]
        [Min(20f)] public float ChunkLength = 90f;
        [Range(4f, 40f)] public float SampleSpacing = 18f;
        [Range(10f, 250f)] public float FadeDistance = 120f;
        [Range(1, 32)] public int PrewarmChunkCount = 8;

        [Header("Jagged slab skin")]
        [Min(5f)] public float SlabHeight = 70f;
        [Min(4f)] public float SlabDepth = 55f;
        [Range(2, 12)] public int Columns = 5;
        [Range(2, 12)] public int Rows = 6;
        [Range(0f, 16f)] public float Displacement = 4f;
        [Range(0.05f, 3f)] public float Snap = 0.7f;
        [Range(0f, 40f)] public float Foot = 9f;
        [Range(0f, 40f)] public float Sweep = 4f;
        [Range(0f, 40f)] public float Mid = 17f;
        [Range(0f, 40f)] public float Crest = 20f;
        public int Seed = 41073;
        public Material CanyonMaterial;

        [Header("Bake policy")]
        public bool AddMeshColliders;
        public bool CastShadows;
        public bool ReceiveShadows = true;
        [Min(1)] public int TriangleBudgetPerChunk = 30000;
    }

    /// <summary>Project-specific references and performance policy used only by the Unity Editor.</summary>
    public sealed class JetHorizonAuthoringProfile : ScriptableObject
    {
        public string GameScenePath = "Assets/JetHorizon/Scenes/JetHorizon.unity";

        [Header("Generated presentation assets")]
        public Material SunMaterial;
        public Material CoronaMaterial;
        public Material StarMaterial;
        public Material SkyboxMaterial;
        public Material WaterMaterial;
        public Material ThrusterMaterial;
        public Material AdditiveMaterial;
        public Material CanyonMaterial;
        public VolumeProfile PostProfile;
        public GameObject ShipModelAsset;
        public JetHorizonFeelProfile FeelProfile;
        public JetHorizonCanyonAuthoring Canyon;
        public HybridCanyonWorldProfile HybridCanyonWorld;

        [Header("Scene object names")]
        public string ShipRootName = "ShipRoot";
        public string SunGroupName = "SunGroup";
        public string WaterName = "Water";
        public string EnvironmentName = "Environment";

        [Header("Performance budgets")]
        [Min(1)] public int MaxRenderers = 600;
        [Min(1)] public int MaxMaterials = 80;
        [Min(1)] public int MaxRealtimeLights = 12;
        [Min(1)] public int MaxShadowedLights = 2;
        [Min(1)] public int MaxParticleCapacity = 3000;
        [Min(1)] public int MaxVisibleTriangles = 450000;
        [Min(128)] public int MaxReflectionTextureSize = 512;
        [Min(1)] public int MaxTransparentRenderers = 180;
    }

    /// <summary>A reversible snapshot of the presentation values most often tuned by the project owner.</summary>
    public sealed class JetHorizonLookPreset : ScriptableObject
    {
        public Color SunColor = new Color(1f, 0.584f, 0f, 1f);
        [Range(0f, 1f)] public float SunWarp = 1f;
        [Range(0f, 4f)] public float SunEmission = 1f;
        [Range(0f, 4f)] public float SunMode;
        public Color SunDeep = new Color(0.25f, 0.04f, 0.02f, 1f);
        public Color SunMid = new Color(0.85f, 0.15f, 0.04f, 1f);
        public Color SunHot = new Color(1f, 0.45f, 0.08f, 1f);

        public Color StarColor = new Color(0.40f, 0.56f, 0.78f, 1f);
        [Range(0f, 10f)] public float StarBrightness = 3.7f;
        [Range(0f, 2f)] public float TwinkleMinimum = 0.64f;
        [Range(0f, 2f)] public float TwinkleRange = 0.67f;
        [Range(0.1f, 4f)] public float StarSize = 1.3f;

        public Color SkyTop = new Color(0.002f, 0.004f, 0.015f, 1f);
        public Color SkyBottom = new Color(0.02f, 0.015f, 0.06f, 1f);
        [Range(0f, 4f)] public float PanoramaBrightness;

        [Range(-5f, 5f)] public float Exposure = 0.9f;
        [Range(0f, 10f)] public float Bloom = 0.58f;
        [Range(0f, 1f)] public float BloomThreshold = 0.85f;
        [Range(0f, 1f)] public float BloomScatter = 0.30f;
        [Range(0f, 1f)] public float Vignette = 0.16f;

        public Vector3 SunPosition = new Vector3(0f, -2f, -340f);
        public Vector3 SunScale = Vector3.one;
        [Range(128, 2048)] public int ReflectionTextureSize = 512;

        public bool AutoAnchorThrusters = true;
        public Vector3 MainNozzleLeft = new Vector3(-1.6f, -0.766667f, 2f);
        public Vector3 MainNozzleRight = new Vector3(1.6f, -0.766667f, 2f);
        public Vector3 MiniNozzleLeft = new Vector3(-0.733333f, -0.666667f, 2f);
        public Vector3 MiniNozzleRight = new Vector3(0.733333f, -0.666667f, 2f);
    }

    public static class JetHorizonAuthoringProject
    {
        public const string AuthoringDirectory = "Assets/JetHorizon/Generated/Authoring";
        public const string ProfilePath = AuthoringDirectory + "/JetHorizonAuthoringProfile.asset";
        public const string CanyonPath = AuthoringDirectory + "/DefaultCanyonPath.asset";
        public const string HybridCanyonPath = "Assets/JetHorizon/Resources/HybridCanyonWorld.asset";
        public const string HybridCanyonMaterialPath = "Assets/JetHorizon/Generated/HybridCanyon/HybridCanyonSurface.mat";

        public static JetHorizonAuthoringProfile LoadOrCreate()
        {
            var profile = AssetDatabase.LoadAssetAtPath<JetHorizonAuthoringProfile>(ProfilePath);
            if (profile != null)
            {
                EnsureHybridCanyonProfile(profile);
                return profile;
            }

            EnsureFolders();
            var canyon = ScriptableObject.CreateInstance<JetHorizonCanyonAuthoring>();
            canyon.CanyonMaterial = AssetDatabase.LoadAssetAtPath<Material>("Assets/JetHorizon/Generated/ConeMat.mat");
            AssetDatabase.CreateAsset(canyon, CanyonPath);

            profile = ScriptableObject.CreateInstance<JetHorizonAuthoringProfile>();
            profile.SunMaterial = LoadMaterial("SunMat");
            profile.CoronaMaterial = LoadMaterial("CoronaMat");
            profile.StarMaterial = LoadMaterial("StarMat");
            profile.SkyboxMaterial = LoadMaterial("SkyboxMat");
            profile.WaterMaterial = LoadMaterial("WaterMat");
            profile.ThrusterMaterial = LoadMaterial("ExhaustMat");
            profile.AdditiveMaterial = LoadMaterial("FlashMat");
            profile.CanyonMaterial = LoadMaterial("ConeMat");
            profile.PostProfile = AssetDatabase.LoadAssetAtPath<VolumeProfile>("Assets/JetHorizon/Generated/JH_PostProfile.asset");
            profile.ShipModelAsset = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/JetHorizon/Models/Ships/default_ship.glb");
            profile.FeelProfile = LoadOrCreateFeelProfile();
            profile.Canyon = canyon;
            profile.HybridCanyonWorld = LoadOrCreateHybridCanyonProfile(profile.CanyonMaterial);
            AssetDatabase.CreateAsset(profile, ProfilePath);
            AssetDatabase.SaveAssets();
            return profile;
        }

        public static Material LoadMaterial(string fileName) =>
            AssetDatabase.LoadAssetAtPath<Material>($"Assets/JetHorizon/Generated/{fileName}.mat");

        public static JetHorizonFeelProfile LoadOrCreateFeelProfile()
        {
            const string path = "Assets/JetHorizon/Resources/JetHorizonFeel.asset";
            var feel = AssetDatabase.LoadAssetAtPath<JetHorizonFeelProfile>(path);
            if (feel != null) return feel;
            feel = ScriptableObject.CreateInstance<JetHorizonFeelProfile>();
            AssetDatabase.CreateAsset(feel, path);
            AssetDatabase.SaveAssets();
            return feel;
        }

        public static HybridCanyonWorldProfile LoadOrCreateHybridCanyonProfile(Material canyonMaterial)
        {
            var world = AssetDatabase.LoadAssetAtPath<HybridCanyonWorldProfile>(HybridCanyonPath);
            if (world != null)
            {
                if (world.CanyonMaterial == null)
                {
                    world.CanyonMaterial = LoadOrCreateHybridCanyonMaterial();
                    EditorUtility.SetDirty(world);
                    AssetDatabase.SaveAssets();
                }
                return world;
            }

            if (!AssetDatabase.IsValidFolder("Assets/JetHorizon/Resources"))
                AssetDatabase.CreateFolder("Assets/JetHorizon", "Resources");
            world = ScriptableObject.CreateInstance<HybridCanyonWorldProfile>();
            world.CanyonMaterial = LoadOrCreateHybridCanyonMaterial();
            AssetDatabase.CreateAsset(world, HybridCanyonPath);
            AssetDatabase.SaveAssets();
            return world;
        }

        static Material LoadOrCreateHybridCanyonMaterial()
        {
            var existing = AssetDatabase.LoadAssetAtPath<Material>(HybridCanyonMaterialPath);
            if (existing != null) return existing;
            EnsureAssetFolder("Assets/JetHorizon/Generated/HybridCanyon");
            Shader shader = Shader.Find("JH/StableCanyon");
            if (shader == null) return LoadMaterial("ConeMat");

            Texture2D cyan = TextureFactory.CyanSlab();
            cyan.name = "HybridCanyonCyanSurface";
            cyan.wrapMode = TextureWrapMode.Repeat;
            Texture2D dark = TextureFactory.DarkSlab();
            dark.name = "HybridCanyonDarkSurface";
            dark.wrapMode = TextureWrapMode.Repeat;
            AssetDatabase.CreateAsset(cyan, "Assets/JetHorizon/Generated/HybridCanyon/HybridCanyonCyanSurface.asset");
            AssetDatabase.CreateAsset(dark, "Assets/JetHorizon/Generated/HybridCanyon/HybridCanyonDarkSurface.asset");

            var material = new Material(shader) { name = "HybridCanyonSurface" };
            material.SetTexture("_CyanSurface", cyan);
            material.SetTexture("_DarkSurface", dark);
            material.SetColor("_CyanBody", new Color(.055f, .27f, .32f, 1f));
            material.SetColor("_DarkBody", new Color(.10f, .055f, .15f, 1f));
            material.SetFloat("_Brightness", .66f);
            material.SetFloat("_Emission", .20f);
            material.SetFloat("_FadeStart", -430f);
            material.SetFloat("_FadeEnd", -330f);
            AssetDatabase.CreateAsset(material, HybridCanyonMaterialPath);
            AssetDatabase.SaveAssets();
            return material;
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

        static void EnsureHybridCanyonProfile(JetHorizonAuthoringProfile profile)
        {
            if (profile.HybridCanyonWorld != null) return;
            profile.HybridCanyonWorld = LoadOrCreateHybridCanyonProfile(profile.CanyonMaterial);
            EditorUtility.SetDirty(profile);
            AssetDatabase.SaveAssets();
        }

        static void EnsureFolders()
        {
            if (!AssetDatabase.IsValidFolder("Assets/JetHorizon/Generated"))
                AssetDatabase.CreateFolder("Assets/JetHorizon", "Generated");
            if (!AssetDatabase.IsValidFolder(AuthoringDirectory))
                AssetDatabase.CreateFolder("Assets/JetHorizon/Generated", "Authoring");
        }

        public static JetHorizonLookPreset Capture(string assetPath, JetHorizonAuthoringProfile profile)
        {
            var preset = ScriptableObject.CreateInstance<JetHorizonLookPreset>();
            CaptureInto(preset, profile);
            AssetDatabase.CreateAsset(preset, AssetDatabase.GenerateUniqueAssetPath(assetPath));
            AssetDatabase.SaveAssets();
            return preset;
        }

        public static void CaptureInto(JetHorizonLookPreset preset, JetHorizonAuthoringProfile profile)
        {
            if (preset == null || profile == null) return;
            ReadColor(profile.SunMaterial, "_SunColor", ref preset.SunColor);
            ReadFloat(profile.SunMaterial, "_Warp", ref preset.SunWarp);
            ReadFloat(profile.SunMaterial, "_Emission", ref preset.SunEmission);
            ReadFloat(profile.SunMaterial, "_Mode", ref preset.SunMode);
            ReadColor(profile.SunMaterial, "_WarpCol1", ref preset.SunDeep);
            ReadColor(profile.SunMaterial, "_WarpCol2", ref preset.SunMid);
            ReadColor(profile.SunMaterial, "_WarpCol3", ref preset.SunHot);
            ReadColor(profile.StarMaterial, "_StarColor", ref preset.StarColor);
            ReadFloat(profile.StarMaterial, "_Brightness", ref preset.StarBrightness);
            ReadFloat(profile.StarMaterial, "_TwinkleMin", ref preset.TwinkleMinimum);
            ReadFloat(profile.StarMaterial, "_TwinkleRange", ref preset.TwinkleRange);
            ReadFloat(profile.StarMaterial, "_SizeMult", ref preset.StarSize);
            ReadColor(profile.SkyboxMaterial, "_TopColor", ref preset.SkyTop);
            ReadColor(profile.SkyboxMaterial, "_BotColor", ref preset.SkyBottom);
            ReadFloat(profile.SkyboxMaterial, "_PanoBrightness", ref preset.PanoramaBrightness);

            if (profile.PostProfile != null)
            {
                if (profile.PostProfile.TryGet(out ColorAdjustments color)) preset.Exposure = color.postExposure.value;
                if (profile.PostProfile.TryGet(out Bloom bloom))
                {
                    preset.Bloom = bloom.intensity.value;
                    preset.BloomThreshold = bloom.threshold.value;
                    preset.BloomScatter = bloom.scatter.value;
                }
                if (profile.PostProfile.TryGet(out Vignette vignette)) preset.Vignette = vignette.intensity.value;
            }

            var sun = GameObject.Find(profile.SunGroupName);
            if (sun != null) { preset.SunPosition = sun.transform.position; preset.SunScale = sun.transform.localScale; }
            var reflection = UnityEngine.Object.FindFirstObjectByType<PlanarReflection>(FindObjectsInactive.Include);
            if (reflection != null) preset.ReflectionTextureSize = reflection.TextureSize;
            var thruster = UnityEngine.Object.FindFirstObjectByType<ThrusterFX>(FindObjectsInactive.Include);
            if (thruster != null)
            {
                preset.AutoAnchorThrusters = thruster.AutoAnchorToModel;
                preset.MainNozzleLeft = thruster.NozzleL;
                preset.MainNozzleRight = thruster.NozzleR;
                preset.MiniNozzleLeft = thruster.MiniNozzleL;
                preset.MiniNozzleRight = thruster.MiniNozzleR;
            }
            EditorUtility.SetDirty(preset);
        }

        public static void Apply(JetHorizonLookPreset preset, JetHorizonAuthoringProfile profile)
        {
            if (preset == null || profile == null) return;
            ApplyMaterial(profile.SunMaterial, m =>
            {
                Set(m, "_SunColor", preset.SunColor); Set(m, "_Warp", preset.SunWarp);
                Set(m, "_Emission", preset.SunEmission); Set(m, "_Mode", preset.SunMode);
                Set(m, "_WarpCol1", preset.SunDeep); Set(m, "_WarpCol2", preset.SunMid); Set(m, "_WarpCol3", preset.SunHot);
            });
            ApplyMaterial(profile.StarMaterial, m =>
            {
                Set(m, "_StarColor", preset.StarColor); Set(m, "_Brightness", preset.StarBrightness);
                Set(m, "_TwinkleMin", preset.TwinkleMinimum); Set(m, "_TwinkleRange", preset.TwinkleRange); Set(m, "_SizeMult", preset.StarSize);
            });
            ApplyMaterial(profile.SkyboxMaterial, m =>
            {
                Set(m, "_TopColor", preset.SkyTop); Set(m, "_BotColor", preset.SkyBottom); Set(m, "_PanoBrightness", preset.PanoramaBrightness);
            });

            if (profile.PostProfile != null)
            {
                Undo.RecordObject(profile.PostProfile, "Apply Jet Horizon look preset");
                if (profile.PostProfile.TryGet(out ColorAdjustments color)) color.postExposure.value = preset.Exposure;
                if (profile.PostProfile.TryGet(out Bloom bloom))
                {
                    bloom.intensity.value = preset.Bloom; bloom.threshold.value = preset.BloomThreshold; bloom.scatter.value = preset.BloomScatter;
                }
                if (profile.PostProfile.TryGet(out Vignette vignette)) vignette.intensity.value = preset.Vignette;
                EditorUtility.SetDirty(profile.PostProfile);
            }

            var sun = GameObject.Find(profile.SunGroupName);
            if (sun != null)
            {
                Undo.RecordObject(sun.transform, "Apply sun transform");
                sun.transform.position = preset.SunPosition; sun.transform.localScale = preset.SunScale;
            }
            var reflection = UnityEngine.Object.FindFirstObjectByType<PlanarReflection>(FindObjectsInactive.Include);
            if (reflection != null)
            {
                Undo.RecordObject(reflection, "Apply reflection preset"); reflection.TextureSize = preset.ReflectionTextureSize; EditorUtility.SetDirty(reflection);
            }
            var thruster = UnityEngine.Object.FindFirstObjectByType<ThrusterFX>(FindObjectsInactive.Include);
            if (thruster != null)
            {
                Undo.RecordObject(thruster, "Apply thruster sockets");
                thruster.AutoAnchorToModel = preset.AutoAnchorThrusters;
                thruster.NozzleL = preset.MainNozzleLeft; thruster.NozzleR = preset.MainNozzleRight;
                thruster.MiniNozzleL = preset.MiniNozzleLeft; thruster.MiniNozzleR = preset.MiniNozzleRight;
                EditorUtility.SetDirty(thruster);
            }
            AssetDatabase.SaveAssets();
        }

        static void ReadFloat(Material material, string name, ref float value) { if (material != null && material.HasProperty(name)) value = material.GetFloat(name); }
        static void ReadColor(Material material, string name, ref Color value) { if (material != null && material.HasProperty(name)) value = material.GetColor(name); }
        static void Set(Material material, string name, float value) { if (material.HasProperty(name)) material.SetFloat(name, value); }
        static void Set(Material material, string name, Color value) { if (material.HasProperty(name)) material.SetColor(name, value); }
        static void ApplyMaterial(Material material, Action<Material> apply)
        {
            if (material == null) return;
            Undo.RecordObject(material, "Apply Jet Horizon look preset");
            apply(material); EditorUtility.SetDirty(material);
        }
    }
}
