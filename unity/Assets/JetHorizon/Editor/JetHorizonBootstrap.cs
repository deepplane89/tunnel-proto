using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace JetHorizon.EditorTools
{
    /// <summary>
    /// One-click scene builder: Jet Horizon ▸ Build Game Scene.
    /// Creates materials, volume profile, lights, water, sun, ship, all gameplay
    /// systems and the UI — fully wired. Run it once, press Play.
    /// </summary>
    public static class JetHorizonBootstrap
    {
        const string GenDir = "Assets/JetHorizon/Generated";
        const string SceneDir = "Assets/JetHorizon/Scenes";

        [MenuItem("Jet Horizon/Build Game Scene")]
        public static void BuildScene()
        {
            System.IO.Directory.CreateDirectory(GenDir);

            if (GraphicsSettings.currentRenderPipeline == null)
            {
                // Project wasn't made from the URP template — create and assign a URP asset.
                var rendererData = ScriptableObject.CreateInstance<UniversalRendererData>();
                AssetDatabase.CreateAsset(rendererData, $"{GenDir}/JH_URP_Renderer.asset");
                var rpAsset = UniversalRenderPipelineAsset.Create(rendererData);
                AssetDatabase.CreateAsset(rpAsset, $"{GenDir}/JH_URP_Asset.asset");
                GraphicsSettings.defaultRenderPipeline = rpAsset;
                QualitySettings.renderPipeline = rpAsset;
                Debug.Log("[JetHorizon] Created and assigned a URP pipeline asset (project was not URP).");
            }

            // Match the web build's crispness: MSAA 4x, HDR, full-res rendering
            // (three.js ran at devicePixelRatio ≤ 3 with 2-4x MSAA).
            if (GraphicsSettings.currentRenderPipeline is UniversalRenderPipelineAsset urp)
            {
                urp.msaaSampleCount = 4;
                urp.renderScale = 1.0f;
                urp.supportsHDR = true;
                EditorUtility.SetDirty(urp);
            }
            System.IO.Directory.CreateDirectory(SceneDir);

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            // ── Materials ────────────────────────────────────────────────
            var coneMat  = SaveMat(NewMat("JH/NeonCone", "ConeMat", m => {
                m.SetFloat("_BandAmount", 0f); m.SetFloat("_EdgeStrength", 0.12f); }));
            var ringMat  = SaveMat(NewMat("JH/NeonCone", "RingMat", m => {
                m.SetColor("_Tint", TextureFactory.Hex(0xff1a1a));
                m.SetColor("_BodyColor", TextureFactory.Hex(0x0a0a0f));
                m.SetFloat("_GlowStrength", 2.2f); m.SetFloat("_EdgeStrength", 0.75f); }));
            var coinMat  = SaveMat(NewMat("JH/NeonCone", "CoinMat", m => {
                m.SetColor("_Tint", TextureFactory.Hex(0xffd700));
                m.SetColor("_BodyColor", TextureFactory.Hex(0x332200));
                m.SetFloat("_GlowStrength", 2.5f); m.SetFloat("_EdgeStrength", 0.55f); m.SetFloat("_Fade", 1f); }));
            var addMat   = SaveMat(NewMat("JH/Additive", "AdditiveMat"));
            var radialTex = TextureFactory.RadialSprite(); radialTex.name = "RadialSprite";
            AssetDatabase.CreateAsset(radialTex, $"{GenDir}/RadialSprite.asset");
            var starMat  = SaveMat(NewMat("JH/Additive", "StarMat", m => {
                m.SetTexture("_MainTex", radialTex);
                m.SetColor("_Tint", new Color(0.55f, 0.65f, 1f, 0.85f)); }));
            var streakMat = SaveMat(NewMat("JH/Additive", "StreakMat", m =>
                m.SetColor("_Tint", new Color(0.51f, 0.45f, 0.63f, 0.5f))));
            var flashMat = SaveMat(NewMat("JH/Additive", "FlashMat", m => m.SetTexture("_MainTex", radialTex)));
            var panoTex = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/JetHorizon/Textures/milkyway-pano.jpg");
            var skyMat   = SaveMat(NewMat("JH/SkyboxGradient", "SkyboxMat", m => {
                if (panoTex != null) m.SetTexture("_PanoTex", panoTex); }));
            var sunMat   = SaveMat(NewMat("JH/Sun", "SunMat"));
            var exhaustMat = SaveMat(NewMat("JH/ConeExhaust", "ExhaustMat"));
            var wakeMat  = SaveMat(NewMat("JH/BankWake", "BankWakeMat"));
            var holoMat  = SaveMat(NewMat("JH/Holographic", "GhostHoloMat", m => {
                m.SetColor("_HologramColor", TextureFactory.Hex(0x00e0ff));
                m.SetFloat("_FresnelAmount", 0.70f); m.SetFloat("_FresnelOpacity", 0.82f);
                m.SetFloat("_ScanlineSize", 5.5f); m.SetFloat("_HologramBrightness", 1.94f);
                m.SetFloat("_SignalSpeed", 0f); m.SetFloat("_HologramOpacity", 0.31f);
                m.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                m.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                m.SetFloat("_ZWrite", 1f); }));

            var waterNormals = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/JetHorizon/Textures/waternormals.jpg");
            var waterMat = SaveMat(NewMat("JH/Water", "WaterMat", m => {
                if (waterNormals != null) m.SetTexture("_NormalMap", waterNormals); }));
            if (waterNormals != null)
            {
                var imp = (TextureImporter)AssetImporter.GetAtPath("Assets/JetHorizon/Textures/waternormals.jpg");
                if (imp != null && imp.textureType != TextureImporterType.NormalMap)
                {
                    imp.textureType = TextureImporterType.NormalMap;
                    imp.wrapMode = TextureWrapMode.Repeat;
                    imp.SaveAndReimport();
                }
            }

            RenderSettings.skybox = skyMat;

            // ── Volume (post) ────────────────────────────────────────────
            var profile = ScriptableObject.CreateInstance<VolumeProfile>();
            AssetDatabase.CreateAsset(profile, $"{GenDir}/JH_PostProfile.asset");
            var tonemap = profile.Add<Tonemapping>(true); tonemap.mode.Override(TonemappingMode.ACES);
            var exposure = profile.Add<ColorAdjustments>(true); exposure.postExposure.Override(0.28f);
            var bloom = profile.Add<Bloom>(true);
            // tight halo like UnrealBloom(strength .35, radius .25) — high scatter reads as haze
            bloom.intensity.Override(0.58f); bloom.threshold.Override(0.85f); bloom.scatter.Override(0.30f);
            bloom.highQualityFiltering.Override(true);
            var vignette = profile.Add<Vignette>(true);
            vignette.intensity.Override(0.28f); vignette.smoothness.Override(0.45f);
            var ca = profile.Add<ChromaticAberration>(true); ca.intensity.Override(0.015f);
            // Volume components must be persisted as sub-assets or they become null refs
            // after the next domain reload.
            foreach (var comp in profile.components)
                AssetDatabase.AddObjectToAsset(comp, profile);
            EditorUtility.SetDirty(profile);

            var volumeGo = new GameObject("Global Volume");
            var volume = volumeGo.AddComponent<Volume>();
            volume.isGlobal = true; volume.profile = profile;

            // ── Camera rig ───────────────────────────────────────────────
            var pivot = new GameObject("CameraPivot");
            pivot.transform.position = new Vector3(0f, Tuning.CamBaseY + Tuning.CamPivotYOffset, Tuning.CamPivotZ);
            var camGo = new GameObject("Main Camera");
            camGo.tag = "MainCamera";
            camGo.transform.SetParent(pivot.transform, false);
            var cam = camGo.AddComponent<UnityEngine.Camera>();
            cam.fieldOfView = Tuning.CamBaseFovDesktop;
            cam.nearClipPlane = 0.1f; cam.farClipPlane = 700f;
            cam.clearFlags = CameraClearFlags.Skybox;
            camGo.AddComponent<AudioListener>();
            var camData = camGo.AddComponent<UniversalAdditionalCameraData>();
            camData.renderPostProcessing = true;
            var rig = pivot.AddComponent<CameraRig>();
            rig.Cam = cam;

            // ── Lights ───────────────────────────────────────────────────
            var lightRoot = new GameObject("Lighting").transform;
            EnvironmentController.BuildLightRig(lightRoot);

            // ── Water floor ──────────────────────────────────────────────
            var water = GameObject.CreatePrimitive(PrimitiveType.Plane);   // 10×10 base
            Object.DestroyImmediate(water.GetComponent<Collider>());
            water.name = "Water";
            water.transform.position = new Vector3(0f, 0f, -100f);
            water.transform.localScale = new Vector3(140f, 1f, 70f);      // → 1400 × 700
            water.layer = 4;   // built-in Water layer — excluded from its own reflection
            water.GetComponent<MeshRenderer>().sharedMaterial = waterMat;
            var waterCtl = water.AddComponent<WaterController>();
            waterCtl.WaterMaterial = waterMat;
            var planar = water.AddComponent<PlanarReflection>();
            planar.WaterMaterial = waterMat;

            // ── Sun group ────────────────────────────────────────────────
            var sunGroup = new GameObject("SunGroup");
            sunGroup.transform.position = new Vector3(0f, -2f, -340f);

            var sun = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            Object.DestroyImmediate(sun.GetComponent<Collider>());
            sun.name = "Sun";
            sun.transform.SetParent(sunGroup.transform, false);
            sun.transform.localScale = Vector3.one * (112f * 0.95f * 2f);
            sun.GetComponent<MeshRenderer>().sharedMaterial = sunMat;

            var corona = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Object.DestroyImmediate(corona.GetComponent<Collider>());
            corona.name = "Corona";
            corona.transform.SetParent(sunGroup.transform, false);
            corona.transform.localPosition = new Vector3(0f, 0f, 1f);
            corona.transform.localScale = new Vector3(112f * 3.2f, 112f * 3.2f, 1f);
            var coronaTex = TextureFactory.SunCorona(1024); coronaTex.name = "SunCorona";
            AssetDatabase.CreateAsset(coronaTex, $"{GenDir}/SunCorona.asset");
            var coronaMat = SaveMat(NewMat("JH/Additive", "CoronaMat", m => m.SetTexture("_MainTex", coronaTex)));
            corona.GetComponent<MeshRenderer>().sharedMaterial = coronaMat;

            var seam = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Object.DestroyImmediate(seam.GetComponent<Collider>());
            seam.name = "HorizonSeam";
            seam.transform.SetParent(sunGroup.transform, false);
            seam.transform.localPosition = new Vector3(0f, 2f, 2f);
            seam.transform.localScale = new Vector3(112f * 2.5f, 2.8f, 1f);
            var seamTex = TextureFactory.HorizonSeam(TextureFactory.Hex(0xff9500)); seamTex.name = "HorizonSeam";
            AssetDatabase.CreateAsset(seamTex, $"{GenDir}/HorizonSeam.asset");
            var seamMat = SaveMat(NewMat("JH/Additive", "SeamMat", m => m.SetTexture("_MainTex", seamTex)));
            var seamR = seam.GetComponent<MeshRenderer>();
            seamR.sharedMaterial = seamMat;

            // ── Ship ─────────────────────────────────────────────────────
            var shipRoot = new GameObject("ShipRoot");
            shipRoot.transform.position = new Vector3(0f, Tuning.ShipPreLaunchY, Tuning.ShipZ);
            shipRoot.transform.localScale = Vector3.one * Tuning.ShipScale;
            ShipFactory.Build(shipRoot.transform, ShipFactory.Skin.Runner, holoMat);
            var thruster = shipRoot.AddComponent<ThrusterFX>();
            thruster.Preset = ThrusterFX.Style.Light;   // shipping default preset
            thruster.ExhaustMaterial = exhaustMat;
            thruster.AdditiveMaterial = flashMat;

            // ── Systems / managers ───────────────────────────────────────
            var managers = new GameObject("GameSystems");
            var gm       = managers.AddComponent<GameManager>();
            var input    = managers.AddComponent<ShipInput>();
            var ship     = managers.AddComponent<ShipController>();
            var waves    = managers.AddComponent<WaveDirector>();
            var canyon   = managers.AddComponent<CanyonSystem>();
            var sine     = managers.AddComponent<SineCorridorSystem>();
            var zipper   = managers.AddComponent<ZipperSystem>();
            var slalom   = managers.AddComponent<SlalomSystem>();
            var walls    = managers.AddComponent<AngledWallSystem>();
            var lightning= managers.AddComponent<LightningSystem>();
            var obstacles= managers.AddComponent<ObstacleSpawner>();
            var pickups  = managers.AddComponent<PickupSystem>();

            ship.Input = input; ship.ShipRoot = shipRoot.transform;

            waves.Canyon = canyon; waves.SineCorridor = sine; waves.Zipper = zipper;
            waves.Slalom = slalom; waves.AngledWalls = walls; waves.Obstacles = obstacles;

            canyon.Lightning = lightning; canyon.Pickups = pickups;
            lightning.Camera = rig; lightning.BoltMaterial = flashMat;
            obstacles.Waves = waves; obstacles.Ship = ship; obstacles.AngledWalls = walls;
            obstacles.Pickups = pickups; obstacles.ConeMaterial = coneMat; obstacles.RingMaterial = ringMat;
            walls.WallMaterial = coneMat;
            zipper.Obstacles = obstacles; slalom.Obstacles = obstacles; slalom.Pickups = pickups;
            sine.Obstacles = obstacles;
            pickups.CoinMaterial = coinMat;

            gm.Ship = ship; gm.Camera = rig; gm.Waves = waves; gm.Canyon = canyon;
            gm.SineCorridor = sine; gm.Zipper = zipper; gm.Slalom = slalom;
            gm.AngledWalls = walls; gm.Lightning = lightning; gm.Obstacles = obstacles;
            gm.Pickups = pickups;

            // ── Environment controller ───────────────────────────────────
            var envGo = new GameObject("Environment");
            var env = envGo.AddComponent<EnvironmentController>();
            env.SkyboxMaterial = skyMat; env.SunMaterial = sunMat; env.WaterMaterial = waterMat;
            env.HorizonSeam = seamR; env.SunGroup = sunGroup.transform;
            var starfield = envGo.AddComponent<StarfieldController>();
            starfield.StarMaterial = starMat; starfield.StreakMaterial = streakMat;

            // ── FX ───────────────────────────────────────────────────────
            var fxGo = new GameObject("FX");
            var explosion = fxGo.AddComponent<ExplosionFX>();
            explosion.FlashMaterial = flashMat; explosion.ShipRoot = shipRoot.transform;
            var wake = fxGo.AddComponent<BankWakeFX>();
            wake.WakeMaterial = wakeMat; wake.ShipRoot = shipRoot.transform;

            var ringTex = TextureFactory.RingSprite(); ringTex.name = "WakeRingSprite";
            AssetDatabase.CreateAsset(ringTex, $"{GenDir}/WakeRingSprite.asset");
            var wakeRingMat = SaveMat(NewMat("JH/Additive", "WakeRingMat", m => m.SetTexture("_MainTex", ringTex)));
            var shipWake = fxGo.AddComponent<ShipWakeFX>();
            shipWake.RingMaterial = wakeRingMat;
            shipWake.WakeMaterial = SaveMat(NewMat("JH/Additive", "VWakeMat"));

            // ── UI ───────────────────────────────────────────────────────
            BuildUI(managers, input);

            EditorSceneManager.SaveScene(scene, $"{SceneDir}/JetHorizon.unity");
            AssetDatabase.SaveAssets();
            Debug.Log("[JetHorizon] Scene built → Assets/JetHorizon/Scenes/JetHorizon.unity — press Play.");
        }

        static void BuildUI(GameObject managers, ShipInput input)
        {
            var canvasGo = new GameObject("UI Canvas");
            var canvas = canvasGo.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.AddComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1920, 1080);
            canvasGo.AddComponent<GraphicRaycaster>();

            var ui = canvasGo.AddComponent<UIManager>();
            ui.Input = input;

            Color cyan = TextureFactory.Hex(0x00eeff);
            Color pink = TextureFactory.Hex(0xff1a8c);

            CanvasGroup Screen(string name)
            {
                var go = new GameObject(name);
                go.transform.SetParent(canvasGo.transform, false);
                var rt = go.AddComponent<RectTransform>();
                rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
                rt.offsetMin = rt.offsetMax = Vector2.zero;
                return go.AddComponent<CanvasGroup>();
            }

            Text Label(Transform parent, string name, string text, int size, Color color,
                       Vector2 anchor, Vector2 pos, TextAnchor align = TextAnchor.MiddleCenter)
            {
                var go = new GameObject(name);
                go.transform.SetParent(parent, false);
                var rt = go.AddComponent<RectTransform>();
                rt.anchorMin = rt.anchorMax = anchor;
                rt.anchoredPosition = pos;
                rt.sizeDelta = new Vector2(900, size * 1.5f);
                var t = go.AddComponent<Text>();
                t.text = text; t.fontSize = size; t.color = color; t.alignment = align;
                t.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                t.horizontalOverflow = HorizontalWrapMode.Overflow;
                t.verticalOverflow = VerticalWrapMode.Overflow;
                return t;
            }

            // Title
            var title = Screen("TitleScreen");
            Label(title.transform, "Logo", "JET HORIZON", 110, cyan, new Vector2(0.5f, 0.62f), Vector2.zero);
            Label(title.transform, "Tap", "TAP / SPACE TO PLAY", 34, Color.white, new Vector2(0.5f, 0.30f), Vector2.zero);

            // HUD
            var hud = Screen("HUD");
            ui.ScoreText = Label(hud.transform, "Score", "0", 52, Color.white, new Vector2(0.5f, 0.94f), Vector2.zero);
            ui.SpeedText = Label(hud.transform, "Speed", "1.0x", 30, cyan, new Vector2(0.08f, 0.94f), Vector2.zero);
            ui.StageText = Label(hud.transform, "Stage", "", 22, new Color(1,1,1,0.4f), new Vector2(0.92f, 0.94f), Vector2.zero);
            ui.KlaxonText = Label(hud.transform, "Klaxon", "▲ SPEED ▲", 40, pink, new Vector2(0.5f, 0.78f), Vector2.zero);
            ui.KlaxonText.enabled = false;

            // Pause
            var pause = Screen("PauseScreen");
            Label(pause.transform, "Paused", "PAUSED", 80, cyan, new Vector2(0.5f, 0.55f), Vector2.zero);
            Label(pause.transform, "Hint", "TAP / ESC TO RESUME", 28, Color.white, new Vector2(0.5f, 0.40f), Vector2.zero);

            // Game over
            var over = Screen("GameOverScreen");
            Label(over.transform, "Dead", "SIGNAL LOST", 90, pink, new Vector2(0.5f, 0.60f), Vector2.zero);
            ui.FinalScoreText = Label(over.transform, "Final", "", 40, Color.white, new Vector2(0.5f, 0.44f), Vector2.zero);
            Label(over.transform, "Retry", "TAP TO FLY AGAIN", 30, cyan, new Vector2(0.5f, 0.28f), Vector2.zero);

            ui.TitleScreen = title; ui.HudScreen = hud; ui.PauseScreen = pause; ui.GameOverScreen = over;
        }

        static Material NewMat(string shaderName, string assetName, System.Action<Material> setup = null)
        {
            var shader = Shader.Find(shaderName);
            if (shader == null) { Debug.LogError($"Shader {shaderName} not found"); shader = Shader.Find("Universal Render Pipeline/Unlit"); }
            var m = new Material(shader) { name = assetName };
            setup?.Invoke(m);
            return m;
        }

        static Material SaveMat(Material m)
        {
            AssetDatabase.CreateAsset(m, $"{GenDir}/{m.name}.mat");
            return m;
        }
    }
}
