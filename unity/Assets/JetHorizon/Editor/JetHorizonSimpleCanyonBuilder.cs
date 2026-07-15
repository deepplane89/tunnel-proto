using UnityEditor;
using UnityEngine;

namespace JetHorizon.EditorTools
{
    /// <summary>New-user-facing canyon workflow; intentionally hides project plumbing.</summary>
    public sealed class JetHorizonSimpleCanyonBuilder : EditorWindow
    {
        HybridCanyonWorldProfile _profile;
        Vector2 _scroll;
        bool _advanced;

        [MenuItem("Jet Horizon/Canyon Builder (Simple)", priority = 1)]
        public static void Open()
        {
            var window = GetWindow<JetHorizonSimpleCanyonBuilder>("Canyon Builder");
            window.minSize = new Vector2(430f, 590f);
            window.Show();
        }

        void OnEnable()
        {
            JetHorizonAuthoringProfile authoring = JetHorizonAuthoringProject.LoadOrCreate();
            _profile = authoring != null ? authoring.HybridCanyonWorld : null;
        }

        void OnGUI()
        {
            _scroll = EditorGUILayout.BeginScrollView(_scroll);
            GUILayout.Space(10f);
            EditorGUILayout.LabelField("JET HORIZON CANYON BUILDER", EditorStyles.boldLabel);
            EditorGUILayout.HelpBox(
                "This builds the opaque curved canyon corridor around one validated route. Unity Terrain is an optional backing layer and is currently disabled so you can judge the corridor by itself.",
                MessageType.Info);

            _profile = (HybridCanyonWorldProfile)EditorGUILayout.ObjectField("Canyon setup", _profile, typeof(HybridCanyonWorldProfile), false);
            if (_profile == null)
            {
                if (GUILayout.Button("Create Default Canyon Setup", GUILayout.Height(36f)))
                    _profile = JetHorizonAuthoringProject.LoadOrCreateHybridCanyonProfile(JetHorizonAuthoringProject.LoadOrCreate().CanyonMaterial);
                EditorGUILayout.EndScrollView();
                return;
            }

            SerializedObject serialized = new SerializedObject(_profile);
            serialized.Update();
            SerializedProperty settings = serialized.FindProperty("Settings");

            Step("1", "Create the editable flight path");
            EditorGUILayout.HelpBox(
                "The cyan line is the safe route used by gameplay, collision, terrain and walls. Drag its points in the Scene view; drag the square width handles to widen or narrow the canyon.",
                MessageType.None);
            if (GUILayout.Button("CREATE PATH FROM VALIDATED GAME ROUTE", GUILayout.Height(34f)))
            {
                Undo.RecordObject(_profile, "Create canyon path from game core");
                _profile.CaptureDefaultCorePath();
                EditorUtility.SetDirty(_profile);
                AssetDatabase.SaveAssets();
                serialized.Update();
            }
            EditorGUILayout.PropertyField(serialized.FindProperty("UseAuthoredPath"), new GUIContent("Use my edited path"));
            if (_profile.UseAuthoredPath)
            {
                EditorGUILayout.PropertyField(serialized.FindProperty("AuthoredPathLength"), new GUIContent("Route length"));
                EditorGUILayout.PropertyField(serialized.FindProperty("PathPoints"), new GUIContent("Route points"), true);
            }

            Step("2", "Choose the broad look");
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("BuildTerrainBacking"), new GUIContent("Add Terrain backing"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("BankHeight"), new GUIContent("Wall height"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("BankRiseWidth"), new GUIContent("Wall slope width", "Smaller values make steeper banks."));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("SurfaceNoise"), new GUIContent("Rocky breakup"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("NoiseScale"), new GUIContent("Rock feature size"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("PathTension"), new GUIContent("Curve tightness"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("WallHeightByProgress"), new GUIContent("Wall height along route"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("BankDegreesByProgress"), new GUIContent("Canyon bank along route"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("EntryClearance"), new GUIContent("Arch opening height"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("SideMonolithCount"), new GUIContent("Large rock landmarks"));
            serialized.ApplyModifiedProperties();

            GUILayout.Space(8f);
            if (GUILayout.Button("CREATE / REFRESH EDITABLE CANYON", GUILayout.Height(42f)))
            {
                JetHorizonHybridCanyonAuthoring.BuildPreview(_profile);
            }
            EditorGUILayout.HelpBox("This selects the route handles automatically. Cyan spheres move the route; square handles change its width.", MessageType.None);

            Step("3", "Optional hand sculpting");
            if (GUILayout.Button("Select Route Handles")) JetHorizonHybridCanyonAuthoring.SelectRouteHandles();
            if (_profile.Settings != null && _profile.Settings.BuildTerrainBacking)
            {
                EditorGUILayout.LabelField("In the Inspector, click Paint Terrain, choose Raise or Lower Terrain, then brush directly in the Scene view.", EditorStyles.wordWrappedLabel);
                if (GUILayout.Button("Select My Editable Terrain")) JetHorizonHybridCanyonAuthoring.SelectEditableTerrain();
            }
            else
            {
                EditorGUILayout.HelpBox("Terrain backing is off. The preview contains only the faceted corridor and authored rock structures.", MessageType.None);
            }

            Step("4", "Validate and put it into the game");
            if (GUILayout.Button("CHECK CANYON FOR GAPS", GUILayout.Height(30f)))
                JetHorizonHybridCanyonAuthoring.ValidatePreview(_profile, true);
            GUI.backgroundColor = new Color(.35f, 1f, .65f);
            if (GUILayout.Button("BAKE & USE IN GAME", GUILayout.Height(46f)))
                JetHorizonHybridCanyonAuthoring.BakePreviewForMobile(_profile);
            GUI.backgroundColor = Color.white;

            if (_profile.BakedWorldPrefab != null)
                EditorGUILayout.HelpBox("Ready. Enter Play mode, start a run, then press C to jump directly to the canyon.", MessageType.Info);
            else
                EditorGUILayout.HelpBox("Not baked yet. Gameplay will use an in-memory fallback until you click Bake & Use In Game.", MessageType.Warning);

            if (GUILayout.Button("QUICK BUILD (skip hand editing)", GUILayout.Height(30f)))
                JetHorizonHybridCanyonAuthoring.QuickBuildForMobile(_profile);

            _advanced = EditorGUILayout.Foldout(_advanced, "Advanced mobile and generation settings", true);
            if (_advanced)
            {
                serialized.Update();
                EditorGUILayout.PropertyField(serialized.FindProperty("CanyonMaterial"));
                EditorGUILayout.PropertyField(serialized.FindProperty("BakedWorldPrefab"));
                EditorGUILayout.PropertyField(serialized.FindProperty("Settings"), true);
                serialized.ApplyModifiedProperties();
            }
            EditorGUILayout.EndScrollView();
        }

        static void Step(string number, string title)
        {
            GUILayout.Space(14f);
            EditorGUILayout.LabelField($"STEP {number} — {title}", EditorStyles.boldLabel);
        }
    }
}
