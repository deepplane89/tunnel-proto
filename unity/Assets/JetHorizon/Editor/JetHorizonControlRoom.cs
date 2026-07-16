using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace JetHorizon.EditorTools
{
    /// <summary>
    /// Project-owner-facing Unity workspace. It edits real serialized scene objects and
    /// assets, uses Unity Undo, and is stripped completely from player builds.
    /// </summary>
    public sealed class JetHorizonControlRoom : EditorWindow
    {
        static readonly string[] Tabs = { "Home", "Feel", "Camera", "Audio", "Lighting", "Sun + Sky", "Ship + Thrusters", "Water", "Canyon", "Powerups", "Performance", "Gameplay" };
        JetHorizonAuthoringProfile _profile;
        JetHorizonLookPreset _preset;
        Vector2 _scroll;
        int _tab;
        bool _showAdvanced;
        string _lastReport = "Not analyzed yet.";
        MessageType _lastReportType = MessageType.Info;
        string _shipHierarchyReport = "";

        [MenuItem("Jet Horizon/Control Room %#j", priority = 0)]
        public static void Open()
        {
            var window = GetWindow<JetHorizonControlRoom>("Jet Horizon Control Room");
            window.minSize = new Vector2(540f, 620f);
            window.Show();
        }

        void OnEnable()
        {
            _profile = JetHorizonAuthoringProject.LoadOrCreate();
            SceneView.duringSceneGui += DuringSceneGui;
        }

        void OnDisable() => SceneView.duringSceneGui -= DuringSceneGui;

        void OnGUI()
        {
            if (_profile == null) _profile = JetHorizonAuthoringProject.LoadOrCreate();
            DrawHeader();
            _tab = GUILayout.Toolbar(_tab, Tabs, GUILayout.Height(25f));
            _scroll = EditorGUILayout.BeginScrollView(_scroll);
            EditorGUILayout.Space(8f);
            switch (_tab)
            {
                case 0: DrawHome(); break;
                case 1: DrawFeel(); break;
                case 2: DrawCamera(); break;
                case 3: DrawAudio(); break;
                case 4: DrawLighting(); break;
                case 5: DrawSunAndSky(); break;
                case 6: DrawShipAndThrusters(); break;
                case 7: DrawWater(); break;
                case 8: DrawCanyon(); break;
                case 9: DrawPowerups(); break;
                case 10: DrawPerformance(); break;
                case 11: DrawGameplay(); break;
            }
            EditorGUILayout.EndScrollView();
        }

        void DrawHeader()
        {
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                using (new EditorGUILayout.HorizontalScope())
                {
                    GUILayout.Label("JET HORIZON", EditorStyles.boldLabel, GUILayout.Width(105f));
                    _profile = (JetHorizonAuthoringProfile)EditorGUILayout.ObjectField(_profile, typeof(JetHorizonAuthoringProfile), false);
                    if (GUILayout.Button("Open Game Scene", GUILayout.Width(120f))) OpenGameScene();
                    GUI.backgroundColor = EditorApplication.isPlaying ? new Color(1f, .45f, .45f) : new Color(.45f, 1f, .65f);
                    if (GUILayout.Button(EditorApplication.isPlaying ? "Stop" : "Play", GUILayout.Width(58f))) EditorApplication.isPlaying = !EditorApplication.isPlaying;
                    GUI.backgroundColor = Color.white;
                }
                using (new EditorGUILayout.HorizontalScope())
                {
                    GUILayout.Label("Look preset", GUILayout.Width(76f));
                    _preset = (JetHorizonLookPreset)EditorGUILayout.ObjectField(_preset, typeof(JetHorizonLookPreset), false);
                    GUI.enabled = _preset != null;
                    if (GUILayout.Button("Apply", GUILayout.Width(62f)))
                    {
                        JetHorizonAuthoringProject.Apply(_preset, _profile);
                        MarkSceneDirty(); SceneView.RepaintAll();
                    }
                    if (GUILayout.Button("Update", GUILayout.Width(66f)))
                    {
                        Undo.RecordObject(_preset, "Update Jet Horizon preset");
                        JetHorizonAuthoringProject.CaptureInto(_preset, _profile); AssetDatabase.SaveAssets();
                    }
                    GUI.enabled = true;
                    if (GUILayout.Button("Capture New", GUILayout.Width(92f))) CapturePreset();
                    if (GUILayout.Button("Save", GUILayout.Width(55f))) { AssetDatabase.SaveAssets(); MarkSceneDirty(); }
                }
            }
        }

        void DrawHome()
        {
            Title("Owner workflow");
            EditorGUILayout.HelpBox(
                "This window changes the real Unity scene, materials, post-processing profile, and authoring assets. " +
                "Use Play for motion; use the Scene view for spatial edits. Every supported edit participates in Unity Undo.", MessageType.Info);

            using (new EditorGUILayout.HorizontalScope())
            {
                if (BigButton("1  Open Game", 40f)) OpenGameScene();
                if (BigButton("2  Frame Ship", 40f)) SelectAndFrame(FindNamed(_profile.ShipRootName));
                if (BigButton("3  Play", 40f)) EditorApplication.isPlaying = true;
            }
            using (new EditorGUILayout.HorizontalScope())
            {
                if (BigButton("Sun Workbench", 32f)) JetHorizonWorkbench.Create(JetHorizonWorkbench.Kind.Sun, _profile);
                if (BigButton("Ship Workbench", 32f)) JetHorizonWorkbench.Create(JetHorizonWorkbench.Kind.Ship, _profile);
                if (BigButton("Powerup Workbench", 32f)) JetHorizonWorkbench.Create(JetHorizonWorkbench.Kind.Powerup, _profile);
            }

            Title("Project health");
            DrawQuickStatus("Game scene", AssetDatabase.LoadAssetAtPath<SceneAsset>(_profile.GameScenePath) != null, _profile.GameScenePath);
            DrawQuickStatus("Engine-neutral core", Type.GetType("JetHorizon.Simulation.JetHorizonSimulation, JetHorizon.Simulation.Core") != null, "Deterministic simulation assembly");
            DrawQuickStatus("URP", GraphicsSettings.currentRenderPipeline is UniversalRenderPipelineAsset, "Universal Render Pipeline");
            DrawQuickStatus("Post profile", _profile.PostProfile != null, "Generated/JH_PostProfile.asset");
            DrawQuickStatus("Canyon authoring path", _profile.Canyon != null && _profile.Canyon.Points.Count >= 2, "Editable Scene-view corridor");
            if (GUILayout.Button("Run Full Validation", GUILayout.Height(30f))) RunValidation();
            EditorGUILayout.HelpBox(_lastReport, _lastReportType);

            Title("Unity-native leverage");
            EditorGUILayout.LabelField("• Scene handles edit corridor and nozzle placement directly in 3D.", Wrap());
            EditorGUILayout.LabelField("• Presets are versionable Unity assets rather than loose runtime globals.", Wrap());
            EditorGUILayout.LabelField("• Canyon baking creates combined mesh chunks before the game runs.", Wrap());
            EditorGUILayout.LabelField("• Budgets inspect renderers, materials, lights, particles, triangles, and reflections.", Wrap());
            EditorGUILayout.LabelField("• Workbenches isolate effects from the full playthrough.", Wrap());
        }

        void DrawGameplay()
        {
            Title("Production run");
            EditorGUILayout.HelpBox(
                "The engine-neutral core owns gates, speed, sectors, Heat, cargo routes, hazards, collision, extraction and score. " +
                "This page only shows those facts and provides safe playtest shortcuts.", MessageType.Info);
            var manager = UnityEngine.Object.FindFirstObjectByType<GameManager>(FindObjectsInactive.Include);
            if (manager == null)
            {
                Missing("Open the game scene to inspect the production loop.");
                if (GUILayout.Button("Open Game Scene", GUILayout.Height(30f))) OpenGameScene();
                return;
            }

            var snapshot = manager.CoreSnapshot;
            if (snapshot == null)
            {
                Missing("The core simulation has not been created yet.");
                return;
            }

            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                EditorGUILayout.LabelField("Mode", snapshot.GateRunMode ? "Gate-led production run" : snapshot.ProofEncounterMode ? "Legacy proof run" : "Legacy stage run");
                EditorGUILayout.LabelField("Sector / Heat", $"{snapshot.SectorIndex} / {snapshot.HeatLevel}");
                EditorGUILayout.LabelField("Speed", $"{snapshot.Speed:0.0}  (gate-earned +{snapshot.GateEarnedSpeed:0.0}, cap {snapshot.SpeedSoftCap:0.0})");
                EditorGUILayout.LabelField("Gates", $"{snapshot.GatesCrossed} hit, {snapshot.GatesMissed} missed, streak {snapshot.GateStreak}");
                EditorGUILayout.LabelField("Cargo", $"{snapshot.CargoWeight}/{snapshot.CargoCapacityWeight} weight, projected {snapshot.CargoProjectedCreditValue} credits");
                EditorGUILayout.LabelField("Environment", $"{snapshot.RunEnvironment} — {snapshot.EnvironmentLifecycle}");
                EditorGUILayout.LabelField("Clock", $"{snapshot.EligibleRunElapsed:0.0}s eligible / {snapshot.Elapsed:0.0}s simulation");
            }

            using (new EditorGUILayout.HorizontalScope())
            {
                GUI.enabled = EditorApplication.isPlaying && manager.Phase != GamePhase.Playing;
                if (GUILayout.Button("Start Run", GUILayout.Height(30f))) manager.StartRun(skipIntro: true);
                GUI.enabled = EditorApplication.isPlaying;
                if (GUILayout.Button(manager.GodMode ? "Disable God Mode" : "Enable God Mode", GUILayout.Height(30f)))
                    manager.ToggleGodMode();
                GUI.enabled = true;
            }
            EditorGUILayout.HelpBox(
                "Common green gates add small speed. Cyan gates surge. The off-line cyan/white structure extracts. " +
                "Miss extraction to enter the next Heat sector; canyon and prismatic environments are activated only by their transition gates.",
                MessageType.None);
            Repaint();
        }

        void DrawLighting()
        {
            Title("Scene lighting");
            EditorGUILayout.HelpBox("These are the actual Unity lights. Changes are serialized into the scene and visible in Scene/Game views.", MessageType.None);
            var lights = UnityEngine.Object.FindObjectsByType<Light>(FindObjectsInactive.Include, FindObjectsSortMode.None)
                .Where(l => !l.name.Contains("ReflectionCam", StringComparison.OrdinalIgnoreCase)).OrderBy(l => l.name).ToArray();
            if (lights.Length == 0) Missing("No lights are loaded. Open the game scene.");
            foreach (var light in lights)
            {
                using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                {
                    using (new EditorGUILayout.HorizontalScope())
                    {
                        light.enabled = EditorGUILayout.Toggle(light.enabled, GUILayout.Width(18f));
                        EditorGUILayout.LabelField(light.name, EditorStyles.boldLabel);
                        if (GUILayout.Button("Select", GUILayout.Width(58f))) SelectAndFrame(light.gameObject);
                    }
                    EditLight(light);
                }
            }

            Title("Ambient + fog");
            EditRenderSetting("Ambient", RenderSettings.ambientLight, c => RenderSettings.ambientLight = c);
            EditRenderSetting("Fog color", RenderSettings.fogColor, c => RenderSettings.fogColor = c);
            float density = EditorGUILayout.Slider("Fog density", RenderSettings.fogDensity, 0f, 0.03f);
            if (!Mathf.Approximately(density, RenderSettings.fogDensity)) { Undo.RecordObject(RenderSettings.skybox, "Edit fog density"); RenderSettings.fogDensity = density; MarkSceneDirty(); }

            DrawPostProcessing();
        }

        void DrawFeel()
        {
            Title("Organic ship feel");
            if (_profile.FeelProfile == null) _profile.FeelProfile = JetHorizonAuthoringProject.LoadOrCreateFeelProfile();
            _profile.FeelProfile = (JetHorizonFeelProfile)EditorGUILayout.ObjectField("Feel profile", _profile.FeelProfile, typeof(JetHorizonFeelProfile), false);
            EditorUtility.SetDirty(_profile);
            DrawDefaultInspector(_profile.FeelProfile);
            if (EditorApplication.isPlaying && ShipFeelPresenter.I != null)
            {
                ShipFeelSignals signals = ShipFeelPresenter.I.Signals;
                using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
                {
                    EditorGUILayout.LabelField("Live speed presentation", signals.SpeedPresentation.ToString("0.000"));
                    EditorGUILayout.LabelField("Live gate kick", signals.GateKick01.ToString("0.000"));
                    EditorGUILayout.LabelField("Live lateral", signals.Lateral01.ToString("0.000"));
                }
            }
            var manager = UnityEngine.Object.FindFirstObjectByType<GameManager>(FindObjectsInactive.Include);
            if (manager != null && manager.FeelProfile != _profile.FeelProfile)
            {
                if (GUILayout.Button("Apply profile to loaded game scene"))
                {
                    Undo.RecordObject(manager, "Assign Jet Horizon feel profile"); manager.FeelProfile = _profile.FeelProfile;
                    EditorUtility.SetDirty(manager); MarkSceneDirty();
                }
            }
            EditorGUILayout.HelpBox(
                "Handling fields feed the deterministic core on run creation. Everything under Layered Camera, Shared Speed Perception, " +
                "Gate Crossing Feedback, and Impact Feedback is presentation-only and can be tuned safely while playing.",
                MessageType.Info);
        }

        void DrawAudio()
        {
            Title("Three.js SFX imported into Unity");
            string[] guids = AssetDatabase.FindAssets("t:AudioClip", new[] { "Assets/JetHorizon/Resources/Audio" });
            foreach (string guid in guids)
            {
                string path = AssetDatabase.GUIDToAssetPath(guid);
                AudioClip clip = AssetDatabase.LoadAssetAtPath<AudioClip>(path);
                EditorGUILayout.ObjectField(clip != null ? clip.name : System.IO.Path.GetFileNameWithoutExtension(path), clip, typeof(AudioClip), false);
            }
            EditorGUILayout.HelpBox("Short SFX are preloaded/decompressed by their importer. Engine layers are looped and dynamically pitch/volume-driven by the shared speed signal. MP3 source files are valid; Unity transcodes them for each build target.", MessageType.Info);
        }

        void DrawSunAndSky()
        {
            Title("Hero sun");
            Material sun = _profile.SunMaterial;
            MaterialObjectRow("Sun material", ref sun, value => _profile.SunMaterial = value);
            EditorUtility.SetDirty(_profile);
            DrawMaterialColor(sun, "Color", "_SunColor");
            DrawMaterialFloat(sun, "Quilez warp", "_Warp", 0f, 1f);
            DrawMaterialFloat(sun, "Emission", "_Emission", 0f, 4f);
            DrawMaterialFloat(sun, "Surface mode", "_Mode", 0f, 4f);
            DrawMaterialColor(sun, "Warp deep", "_WarpCol1");
            DrawMaterialColor(sun, "Warp mid", "_WarpCol2");
            DrawMaterialColor(sun, "Warp hot", "_WarpCol3");
            DrawTransform("Sun group", FindNamed(_profile.SunGroupName)?.transform);

            Title("Starfield");
            Material stars = _profile.StarMaterial;
            MaterialObjectRow("Star material", ref stars, value => _profile.StarMaterial = value);
            DrawMaterialColor(stars, "Star color", "_StarColor");
            DrawMaterialFloat(stars, "Brightness", "_Brightness", 0f, 10f);
            DrawMaterialFloat(stars, "Twinkle minimum", "_TwinkleMin", 0f, 2f);
            DrawMaterialFloat(stars, "Twinkle range", "_TwinkleRange", 0f, 2f);
            DrawMaterialFloat(stars, "Star size", "_SizeMult", .1f, 4f);
            SelectRow("Starfield controller", UnityEngine.Object.FindFirstObjectByType<StarfieldController>(FindObjectsInactive.Include));

            Title("Sky");
            Material sky = _profile.SkyboxMaterial;
            MaterialObjectRow("Skybox material", ref sky, value => _profile.SkyboxMaterial = value);
            DrawMaterialColor(sky, "Top color", "_TopColor");
            DrawMaterialColor(sky, "Horizon color", "_BotColor");
            DrawMaterialFloat(sky, "Panorama brightness", "_PanoBrightness", 0f, 4f);
            if (GUILayout.Button("Open Sun Workbench", GUILayout.Height(28f))) JetHorizonWorkbench.Create(JetHorizonWorkbench.Kind.Sun, _profile);
        }

        void DrawShipAndThrusters()
        {
            var ship = FindNamed(_profile.ShipRootName);
            Title("Ship prefab contract");
            _profile.ShipModelAsset = (GameObject)EditorGUILayout.ObjectField("Imported GLB", _profile.ShipModelAsset, typeof(GameObject), false);
            EditorUtility.SetDirty(_profile);
            SelectRow("Ship root", ship);
            SelectRow("Imported model", ship != null ? ship.transform.Find("ShipModel") : null);
            SelectRow("Socket rig", ship != null ? ship.GetComponent<ShipSocketRig>() : null);
            DrawTransform("Ship root transform", ship != null ? ship.transform : null);
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Scan GLB hierarchy")) _shipHierarchyReport = ScanShipHierarchy(ship, _profile.ShipModelAsset);
                GUI.enabled = !string.IsNullOrEmpty(_shipHierarchyReport);
                if (GUILayout.Button("Copy scan", GUILayout.Width(85f))) EditorGUIUtility.systemCopyBuffer = _shipHierarchyReport;
                GUI.enabled = true;
            }
            if (!string.IsNullOrEmpty(_shipHierarchyReport))
                EditorGUILayout.TextArea(_shipHierarchyReport, GUILayout.MinHeight(90f), GUILayout.MaxHeight(220f));

            Title("Thruster attachment");
            var thruster = UnityEngine.Object.FindFirstObjectByType<ThrusterFX>(FindObjectsInactive.Include);
            if (thruster == null) { Missing("No ThrusterFX is loaded. Open the game scene."); return; }
            var serialized = new SerializedObject(thruster);
            serialized.Update();
            EditorGUILayout.PropertyField(serialized.FindProperty("Preset"));
            EditorGUILayout.PropertyField(serialized.FindProperty("AutoAnchorToModel"), new GUIContent("Use imported-model sockets"));
            EditorGUILayout.PropertyField(serialized.FindProperty("NozzleL"), new GUIContent("Main nozzle left"));
            EditorGUILayout.PropertyField(serialized.FindProperty("NozzleR"), new GUIContent("Main nozzle right"));
            EditorGUILayout.PropertyField(serialized.FindProperty("MiniNozzleL"), new GUIContent("Mini nozzle left"));
            EditorGUILayout.PropertyField(serialized.FindProperty("MiniNozzleR"), new GUIContent("Mini nozzle right"));
            serialized.ApplyModifiedProperties();
            using (new EditorGUILayout.HorizontalScope())
            {
                bool handles = JetHorizonSceneAuthoring.ThrusterHandlesEnabled;
                if (GUILayout.Toggle(handles, "Edit Nozzles in Scene", "Button") != handles)
                {
                    JetHorizonSceneAuthoring.ThrusterHandlesEnabled = !handles;
                    Selection.activeObject = thruster.gameObject; SceneView.lastActiveSceneView?.FrameSelected();
                }
                if (GUILayout.Button("Select Thruster")) SelectAndFrame(thruster.gameObject);
                if (GUILayout.Button("Ship Workbench")) JetHorizonWorkbench.Create(JetHorizonWorkbench.Kind.Ship, _profile);
            }
            EditorGUILayout.HelpBox("When imported-model sockets are enabled, the engine-neutral Runner socket definition remains authoritative. Disable it to use the four Scene-edited fallback anchors.", MessageType.Info);

            Title("Laser attachment");
            var socketRig = ship != null ? ship.GetComponent<ShipSocketRig>() : null;
            SelectRow("Left muzzle", socketRig != null ? socketRig.LaserMuzzleLeft : null);
            SelectRow("Right muzzle", socketRig != null ? socketRig.LaserMuzzleRight : null);
            EditorGUILayout.HelpBox(
                "These model-child sockets use the exact GitHub Runner tuning: two lanes at ±0.35 world X, +0.45 Y, -2.50 Z, with 10-unit cores and 7.5-unit glows.",
                MessageType.Info);
        }

        void DrawWater()
        {
            Title("Water material + real planar reflection");
            Material water = _profile.WaterMaterial;
            MaterialObjectRow("Water material", ref water, value => _profile.WaterMaterial = value);
            EditorUtility.SetDirty(_profile);
            DrawAllMaterialProperties(water);
            var reflection = UnityEngine.Object.FindFirstObjectByType<PlanarReflection>(FindObjectsInactive.Include);
            if (reflection == null) { Missing("No PlanarReflection is loaded."); return; }
            var serialized = new SerializedObject(reflection);
            serialized.Update();
            EditorGUILayout.PropertyField(serialized.FindProperty("TextureSize"), new GUIContent("Reflection resolution"));
            EditorGUILayout.PropertyField(serialized.FindProperty("ReflectLayer"));
            EditorGUILayout.PropertyField(serialized.FindProperty("PlaneY"));
            serialized.ApplyModifiedProperties();
            if (reflection.TextureSize > _profile.MaxReflectionTextureSize)
                EditorGUILayout.HelpBox($"Reflection is {reflection.TextureSize}px; project budget is {_profile.MaxReflectionTextureSize}px. This camera renders an additional scene pass every frame.", MessageType.Warning);
            SelectRow("Water object", FindNamed(_profile.WaterName));
        }

        void DrawCanyon()
        {
            Title("Continuous corridor authoring");
            _profile.Canyon = (JetHorizonCanyonAuthoring)EditorGUILayout.ObjectField("Path asset", _profile.Canyon, typeof(JetHorizonCanyonAuthoring), false);
            EditorUtility.SetDirty(_profile);
            if (_profile.Canyon == null) { Missing("Assign or recreate a canyon authoring asset."); return; }

            var canyonEditor = new SerializedObject(_profile.Canyon);
            canyonEditor.Update();
            EditorGUILayout.PropertyField(canyonEditor.FindProperty("Points"), true);
            EditorGUILayout.PropertyField(canyonEditor.FindProperty("ChunkLength"));
            EditorGUILayout.PropertyField(canyonEditor.FindProperty("SampleSpacing"));
            EditorGUILayout.PropertyField(canyonEditor.FindProperty("FadeDistance"));
            EditorGUILayout.PropertyField(canyonEditor.FindProperty("PrewarmChunkCount"));
            EditorGUILayout.PropertyField(canyonEditor.FindProperty("SlabHeight"));
            EditorGUILayout.PropertyField(canyonEditor.FindProperty("SlabDepth"));
            EditorGUILayout.PropertyField(canyonEditor.FindProperty("Columns"));
            EditorGUILayout.PropertyField(canyonEditor.FindProperty("Rows"));
            EditorGUILayout.PropertyField(canyonEditor.FindProperty("Displacement"));
            EditorGUILayout.PropertyField(canyonEditor.FindProperty("Snap"));
            _showAdvanced = EditorGUILayout.Foldout(_showAdvanced, "Advanced jagged profile + bake policy", true);
            if (_showAdvanced)
            {
                EditorGUILayout.PropertyField(canyonEditor.FindProperty("Foot"));
                EditorGUILayout.PropertyField(canyonEditor.FindProperty("Sweep"));
                EditorGUILayout.PropertyField(canyonEditor.FindProperty("Mid"));
                EditorGUILayout.PropertyField(canyonEditor.FindProperty("Crest"));
                EditorGUILayout.PropertyField(canyonEditor.FindProperty("Seed"));
                EditorGUILayout.PropertyField(canyonEditor.FindProperty("CanyonMaterial"));
                EditorGUILayout.PropertyField(canyonEditor.FindProperty("AddMeshColliders"));
                EditorGUILayout.PropertyField(canyonEditor.FindProperty("CastShadows"));
                EditorGUILayout.PropertyField(canyonEditor.FindProperty("ReceiveShadows"));
                EditorGUILayout.PropertyField(canyonEditor.FindProperty("TriangleBudgetPerChunk"));
            }
            canyonEditor.ApplyModifiedProperties();

            using (new EditorGUILayout.HorizontalScope())
            {
                bool handles = JetHorizonSceneAuthoring.CanyonHandlesEnabled;
                if (GUILayout.Toggle(handles, "Edit Path in Scene", "Button") != handles)
                {
                    JetHorizonSceneAuthoring.CanyonHandlesEnabled = !handles; SceneView.RepaintAll();
                }
                if (GUILayout.Button("Preview Bake")) JetHorizonCanyonBaker.BuildPreview(_profile.Canyon);
                if (GUILayout.Button("Clear Preview")) JetHorizonCanyonBaker.ClearPreview();
                if (GUILayout.Button("Bake Prefab…")) JetHorizonCanyonBaker.BakePrefab(_profile.Canyon);
            }
            EditorGUILayout.HelpBox("The spline controls continuity and width. The generated slab skin retains angular displacement. Baking combines many slabs into one renderer per chunk, reducing runtime construction and draw overhead.", MessageType.Info);

            EditorGUILayout.Space(12f);
            Title("Hybrid Terrain world");
            _profile.HybridCanyonWorld = (HybridCanyonWorldProfile)EditorGUILayout.ObjectField(
                "World profile", _profile.HybridCanyonWorld, typeof(HybridCanyonWorldProfile), false);
            if (_profile.HybridCanyonWorld == null)
                _profile.HybridCanyonWorld = JetHorizonAuthoringProject.LoadOrCreateHybridCanyonProfile(_profile.CanyonMaterial);
            EditorUtility.SetDirty(_profile);

            if (_profile.HybridCanyonWorld != null)
            {
                var worldEditor = new SerializedObject(_profile.HybridCanyonWorld);
                worldEditor.Update();
                EditorGUILayout.PropertyField(worldEditor.FindProperty("CanyonMaterial"));
                EditorGUILayout.PropertyField(worldEditor.FindProperty("Settings"), true);
                worldEditor.ApplyModifiedProperties();
                using (new EditorGUILayout.HorizontalScope())
                {
                    if (GUILayout.Button("Preview Terrain + Arches", GUILayout.Height(28f)))
                        JetHorizonHybridCanyonAuthoring.BuildPreview(_profile.HybridCanyonWorld);
                    if (GUILayout.Button("Clear Hybrid Preview", GUILayout.Height(28f)))
                        JetHorizonHybridCanyonAuthoring.ClearPreview();
                }
            }
            EditorGUILayout.HelpBox(
                "Gameplay builds this entire construct once when the crystalline canyon begins. Terrain makes the broad banks and seabed; opaque mesh arches and monoliths provide overhangs. Terrain collision is intentionally disabled—the engine-neutral corridor remains authoritative and mathematically traversable.",
                MessageType.Info);
        }

        void DrawPowerups()
        {
            Title("Powerup presentation gallery");
            var presentation = UnityEngine.Object.FindFirstObjectByType<PowerupPresentationSystem>(FindObjectsInactive.Include);
            SelectRow("Live presentation system", presentation);
            if (presentation != null) DrawDefaultInspector(presentation);
            if (GUILayout.Button("Open Powerup Workbench", GUILayout.Height(30f))) JetHorizonWorkbench.Create(JetHorizonWorkbench.Kind.Powerup, _profile);
            EditorGUILayout.HelpBox("Powerup mechanics remain engine-neutral. Unity owns meshes, shader animation, light, collection bursts, sound, and preview presentation.", MessageType.Info);
        }

        void DrawCamera()
        {
            Title("Gameplay camera");
            var rig = UnityEngine.Object.FindFirstObjectByType<CameraRig>(FindObjectsInactive.Include);
            SelectRow("Camera rig", rig);
            if (rig != null) DrawDefaultInspector(rig);
            var cam = Camera.main;
            if (cam != null)
            {
                float fov = EditorGUILayout.Slider("Field of view", cam.fieldOfView, 20f, 120f);
                float near = EditorGUILayout.FloatField("Near clip", cam.nearClipPlane);
                float far = EditorGUILayout.FloatField("Far clip", cam.farClipPlane);
                if (!Mathf.Approximately(fov, cam.fieldOfView) || !Mathf.Approximately(near, cam.nearClipPlane) || !Mathf.Approximately(far, cam.farClipPlane))
                {
                    Undo.RecordObject(cam, "Edit gameplay camera");
                    cam.fieldOfView = fov; cam.nearClipPlane = Mathf.Max(.01f, near); cam.farClipPlane = Mathf.Max(cam.nearClipPlane + 1f, far);
                    EditorUtility.SetDirty(cam); MarkSceneDirty();
                }
                if (GUILayout.Button("Frame gameplay camera")) SelectAndFrame(cam.gameObject);
            }
            else Missing("No Main Camera is loaded.");
        }

        void DrawPerformance()
        {
            Title("Authoring budgets");
            DrawDefaultInspector(_profile);
            if (GUILayout.Button("Analyze Loaded Scene", GUILayout.Height(32f)))
            {
                var report = JetHorizonPerformanceAudit.Analyze(_profile);
                _lastReport = report.Summary;
                _lastReportType = report.Passed ? MessageType.Info : MessageType.Warning;
            }
            EditorGUILayout.HelpBox(_lastReport, _lastReportType);
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Open Unity Profiler")) EditorApplication.ExecuteMenuItem("Window/Analysis/Profiler");
                if (GUILayout.Button("Open Frame Debugger")) EditorApplication.ExecuteMenuItem("Window/Analysis/Frame Debugger");
                if (GUILayout.Button("Open Rendering Debugger")) EditorApplication.ExecuteMenuItem("Window/Analysis/Rendering Debugger");
            }
        }

        void DrawPostProcessing()
        {
            Title("Post-processing");
            _profile.PostProfile = (VolumeProfile)EditorGUILayout.ObjectField("Volume profile", _profile.PostProfile, typeof(VolumeProfile), false);
            if (_profile.PostProfile == null) return;
            if (_profile.PostProfile.TryGet(out ColorAdjustments color)) EditVolumeFloat("Exposure", color.postExposure, -3f, 3f, _profile.PostProfile);
            if (_profile.PostProfile.TryGet(out Bloom bloom))
            {
                EditVolumeFloat("Bloom intensity", bloom.intensity, 0f, 10f, _profile.PostProfile);
                EditVolumeFloat("Bloom threshold", bloom.threshold, 0f, 3f, _profile.PostProfile);
                EditVolumeFloat("Bloom scatter", bloom.scatter, 0f, 1f, _profile.PostProfile);
            }
            if (_profile.PostProfile.TryGet(out Vignette vignette)) EditVolumeFloat("Vignette", vignette.intensity, 0f, 1f, _profile.PostProfile);
        }

        void DuringSceneGui(SceneView view)
        {
            if (_profile == null) return;
            if (JetHorizonSceneAuthoring.CanyonHandlesEnabled && _profile.Canyon != null)
                JetHorizonSceneAuthoring.DrawCanyonHandles(_profile.Canyon);
            if (JetHorizonSceneAuthoring.ThrusterHandlesEnabled)
            {
                var thruster = UnityEngine.Object.FindFirstObjectByType<ThrusterFX>(FindObjectsInactive.Include);
                if (thruster != null) JetHorizonSceneAuthoring.DrawThrusterHandles(thruster);
            }
        }

        void CapturePreset()
        {
            string path = EditorUtility.SaveFilePanelInProject("Capture Jet Horizon look", "JetHorizonLook", "asset", "Choose a name for this reversible look preset.", JetHorizonAuthoringProject.AuthoringDirectory);
            if (string.IsNullOrEmpty(path)) return;
            _preset = JetHorizonAuthoringProject.Capture(path, _profile);
            Selection.activeObject = _preset;
        }

        void OpenGameScene()
        {
            if (EditorApplication.isPlaying) EditorApplication.isPlaying = false;
            if (!System.IO.File.Exists(System.IO.Path.Combine(System.IO.Directory.GetCurrentDirectory(), _profile.GameScenePath)))
            {
                EditorUtility.DisplayDialog("Game scene missing", _profile.GameScenePath, "OK"); return;
            }
            if (!EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            EditorSceneManager.OpenScene(_profile.GameScenePath, OpenSceneMode.Single);
        }

        void RunValidation()
        {
            var report = JetHorizonPerformanceAudit.Analyze(_profile);
            _lastReport = JetHorizonProjectValidator.Validate(_profile) + "\n\n" + report.Summary;
            _lastReportType = report.Passed && !_lastReport.Contains("ERROR") ? MessageType.Info : MessageType.Warning;
        }

        static void EditLight(Light light)
        {
            bool enabled = EditorGUILayout.Toggle("Enabled", light.enabled);
            Color color = EditorGUILayout.ColorField("Color", light.color);
            float intensity = EditorGUILayout.Slider("Intensity", light.intensity, 0f, 12f);
            LightShadows shadows = (LightShadows)EditorGUILayout.EnumPopup("Shadows", light.shadows);
            float range = light.type == LightType.Point || light.type == LightType.Spot ? EditorGUILayout.Slider("Range", light.range, .1f, 100f) : light.range;
            if (enabled == light.enabled && color == light.color && Mathf.Approximately(intensity, light.intensity) && shadows == light.shadows && Mathf.Approximately(range, light.range)) return;
            Undo.RecordObject(light, "Edit Jet Horizon light");
            light.enabled = enabled; light.color = color; light.intensity = intensity; light.shadows = shadows; light.range = range; EditorUtility.SetDirty(light); MarkSceneDirty();
        }

        static void DrawPostPropertyError(Material material, string property) =>
            EditorGUILayout.HelpBox(material == null ? "Material is missing." : $"Shader does not expose {property}.", MessageType.Warning);

        static void DrawMaterialFloat(Material material, string label, string property, float min, float max)
        {
            if (material == null || !material.HasProperty(property)) { DrawPostPropertyError(material, property); return; }
            float oldValue = material.GetFloat(property);
            float value = EditorGUILayout.Slider(label, oldValue, min, max);
            if (Mathf.Approximately(value, oldValue)) return;
            Undo.RecordObject(material, "Tune " + label); material.SetFloat(property, value); EditorUtility.SetDirty(material);
        }

        static void DrawMaterialColor(Material material, string label, string property)
        {
            if (material == null || !material.HasProperty(property)) { DrawPostPropertyError(material, property); return; }
            Color oldValue = material.GetColor(property);
            Color value = EditorGUILayout.ColorField(new GUIContent(label), oldValue, true, true, true);
            if (value == oldValue) return;
            Undo.RecordObject(material, "Tune " + label); material.SetColor(property, value); EditorUtility.SetDirty(material);
        }

        static void DrawAllMaterialProperties(Material material)
        {
            if (material == null) { Missing("Water material is missing."); return; }
            var editor = UnityEditor.Editor.CreateEditor(material);
            if (editor != null) { editor.OnInspectorGUI(); UnityEngine.Object.DestroyImmediate(editor); }
        }

        static void EditVolumeFloat(string label, FloatParameter parameter, float min, float max, UnityEngine.Object owner)
        {
            float value = EditorGUILayout.Slider(label, parameter.value, min, max);
            if (Mathf.Approximately(value, parameter.value)) return;
            Undo.RecordObject(owner, "Tune " + label); parameter.value = value; EditorUtility.SetDirty(owner);
        }

        static void DrawDefaultInspector(UnityEngine.Object target)
        {
            if (target == null) return;
            var editor = UnityEditor.Editor.CreateEditor(target);
            if (editor != null) { editor.OnInspectorGUI(); UnityEngine.Object.DestroyImmediate(editor); }
        }

        static void MaterialObjectRow(string label, ref Material material, Action<Material> assign)
        {
            var next = (Material)EditorGUILayout.ObjectField(label, material, typeof(Material), false);
            if (next == material) return;
            assign(next); material = next;
        }

        static void DrawTransform(string label, Transform transform)
        {
            if (transform == null) { Missing(label + " is not loaded."); return; }
            using (new EditorGUILayout.VerticalScope(EditorStyles.helpBox))
            {
                using (new EditorGUILayout.HorizontalScope())
                {
                    EditorGUILayout.LabelField(label, EditorStyles.boldLabel);
                    if (GUILayout.Button("Select", GUILayout.Width(58f))) SelectAndFrame(transform.gameObject);
                }
                Vector3 position = EditorGUILayout.Vector3Field("Position", transform.position);
                Vector3 rotation = EditorGUILayout.Vector3Field("Rotation", transform.eulerAngles);
                Vector3 scale = EditorGUILayout.Vector3Field("Scale", transform.localScale);
                if (position == transform.position && rotation == transform.eulerAngles && scale == transform.localScale) return;
                Undo.RecordObject(transform, "Edit " + label); transform.position = position; transform.eulerAngles = rotation; transform.localScale = scale; MarkSceneDirty();
            }
        }

        static void SelectRow(string label, UnityEngine.Object target)
        {
            using (new EditorGUILayout.HorizontalScope())
            {
                EditorGUILayout.ObjectField(label, target, typeof(UnityEngine.Object), true);
                GUI.enabled = target != null;
                if (GUILayout.Button("Select", GUILayout.Width(58f))) SelectAndFrame(target);
                GUI.enabled = true;
            }
        }

        static void DrawQuickStatus(string label, bool good, string detail)
        {
            using (new EditorGUILayout.HorizontalScope())
            {
                GUILayout.Label(good ? "●" : "●", new GUIStyle(EditorStyles.label) { normal = { textColor = good ? new Color(.2f, .8f, .35f) : new Color(1f, .35f, .25f) } }, GUILayout.Width(18f));
                GUILayout.Label(label, GUILayout.Width(155f)); GUILayout.Label(detail, EditorStyles.miniLabel);
            }
        }

        static void EditRenderSetting(string label, Color current, Action<Color> apply)
        {
            Color value = EditorGUILayout.ColorField(new GUIContent(label), current, true, true, true);
            if (value == current) return; apply(value); MarkSceneDirty();
        }

        static void Title(string title) { EditorGUILayout.Space(5f); EditorGUILayout.LabelField(title, EditorStyles.boldLabel); }
        static GUIStyle Wrap() => new GUIStyle(EditorStyles.label) { wordWrap = true };
        static void Missing(string message) => EditorGUILayout.HelpBox(message, MessageType.Warning);
        static bool BigButton(string label, float height) => GUILayout.Button(label, GUILayout.Height(height));
        static GameObject FindNamed(string name) => string.IsNullOrEmpty(name) ? null : GameObject.Find(name);
        static void SelectAndFrame(UnityEngine.Object target)
        {
            if (target == null) return;
            Selection.activeObject = target is Component component ? component.gameObject : target;
            SceneView.lastActiveSceneView?.FrameSelected();
        }
        static void MarkSceneDirty()
        {
            if (SceneManager.GetActiveScene().IsValid()) EditorSceneManager.MarkSceneDirty(SceneManager.GetActiveScene());
        }

        static string ScanShipHierarchy(GameObject ship, GameObject importedAsset)
        {
            GameObject source = ship != null ? ship : importedAsset;
            if (source == null) return "Assign the imported GLB or open the game scene first.";
            var transforms = source.GetComponentsInChildren<Transform>(true);
            string[] candidateWords = { "thruster", "nozzle", "engine", "exhaust", "fire", "jet", "socket", "wing", "gun", "weapon", "door", "gear", "light" };
            var candidates = transforms.Where(transform => candidateWords.Any(word => transform.name.IndexOf(word, StringComparison.OrdinalIgnoreCase) >= 0)).ToArray();
            int meshRenderers = source.GetComponentsInChildren<MeshRenderer>(true).Length;
            int skinnedRenderers = source.GetComponentsInChildren<SkinnedMeshRenderer>(true).Length;
            int meshFilters = source.GetComponentsInChildren<MeshFilter>(true).Length;
            int animators = source.GetComponentsInChildren<Animator>(true).Length;
            int animations = source.GetComponentsInChildren<Animation>(true).Length;
            var builder = new StringBuilder();
            builder.AppendLine($"Nodes {transforms.Length} | meshes {meshFilters} | renderers {meshRenderers} | skinned {skinnedRenderers} | animators {animators + animations}");
            builder.AppendLine($"Likely attachment/add-on nodes: {candidates.Length}");
            foreach (Transform candidate in candidates.Take(80)) builder.AppendLine("• " + AnimationUtility.CalculateTransformPath(candidate, source.transform));
            if (candidates.Length == 0) builder.AppendLine("No obvious names found. Scene socket handles can still calibrate explicit anchors visually.");
            if (candidates.Length > 80) builder.AppendLine($"…and {candidates.Length - 80} more.");
            return builder.ToString();
        }
    }
}
