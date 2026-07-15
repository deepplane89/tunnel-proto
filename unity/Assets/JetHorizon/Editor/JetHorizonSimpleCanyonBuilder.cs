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
                "This creates a real Unity Terrain for editing, then converts it into optimized opaque chunks used by the mobile game. The safe flight path and collisions stay owned by the game core.",
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

            Step("1", "Choose the broad look");
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("BankHeight"), new GUIContent("Wall height"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("BankRiseWidth"), new GUIContent("Wall slope width", "Smaller values make steeper banks."));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("SurfaceNoise"), new GUIContent("Rocky breakup"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("NoiseScale"), new GUIContent("Rock feature size"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("EntryClearance"), new GUIContent("Arch opening height"));
            EditorGUILayout.PropertyField(settings.FindPropertyRelative("SideMonolithCount"), new GUIContent("Large rock landmarks"));
            serialized.ApplyModifiedProperties();

            GUILayout.Space(8f);
            if (GUILayout.Button("CREATE / REFRESH EDITABLE CANYON", GUILayout.Height(42f)))
            {
                JetHorizonHybridCanyonAuthoring.BuildPreview(_profile);
                JetHorizonHybridCanyonAuthoring.SelectEditableTerrain();
            }
            EditorGUILayout.HelpBox("This selects the Terrain automatically. You can stop here and accept the generated shape.", MessageType.None);

            Step("2", "Optional hand sculpting");
            EditorGUILayout.LabelField("In the Inspector, click Paint Terrain, choose Raise or Lower Terrain, then brush directly in the Scene view.", EditorStyles.wordWrappedLabel);
            if (GUILayout.Button("Select My Editable Terrain")) JetHorizonHybridCanyonAuthoring.SelectEditableTerrain();

            Step("3", "Put it into the game");
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
