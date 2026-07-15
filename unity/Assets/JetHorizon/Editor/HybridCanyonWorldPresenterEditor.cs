using UnityEditor;
using UnityEngine;

namespace JetHorizon.EditorTools
{
    [CustomEditor(typeof(HybridCanyonWorldPresenter))]
    public sealed class HybridCanyonWorldPresenterEditor : Editor
    {
        public override void OnInspectorGUI()
        {
            DrawDefaultInspector();
            var presenter = (HybridCanyonWorldPresenter)target;
            GUILayout.Space(8f);
            if (GUILayout.Button("Refresh Canyon Preview", GUILayout.Height(30f)) && presenter.Profile != null)
                JetHorizonHybridCanyonAuthoring.BuildPreview(presenter.Profile);
            if (GUILayout.Button("Open Simple Canyon Builder")) JetHorizonSimpleCanyonBuilder.Open();
        }

        void OnSceneGUI()
        {
            var presenter = (HybridCanyonWorldPresenter)target;
            HybridCanyonWorldProfile profile = presenter.Profile;
            if (profile == null || !profile.UseAuthoredPath || profile.PathPoints == null) return;
            Transform root = presenter.WorldContent != null ? presenter.WorldContent : presenter.transform;

            Handles.color = new Color(.1f, 1f, 1f, .9f);
            for (int i = 0; i < profile.PathPoints.Count; i++)
            {
                CanyonPathAuthoringPoint point = profile.PathPoints[i];
                Vector3 local = new Vector3(point.CenterX, 0f, -point.Distance);
                Vector3 world = root.TransformPoint(local);
                float handleSize = HandleUtility.GetHandleSize(world) * .085f;

                EditorGUI.BeginChangeCheck();
                Vector3 moved = Handles.FreeMoveHandle(world, handleSize, Vector3.zero, Handles.SphereHandleCap);
                if (EditorGUI.EndChangeCheck())
                {
                    Undo.RecordObject(profile, "Move canyon path point");
                    Vector3 changed = root.InverseTransformPoint(moved);
                    float minimum = i == 0 ? .01f : profile.PathPoints[i - 1].Distance + .25f;
                    float maximum = i == profile.PathPoints.Count - 1
                        ? profile.AuthoredPathLength
                        : profile.PathPoints[i + 1].Distance - .25f;
                    point.Distance = Mathf.Clamp(-changed.z, minimum, maximum);
                    point.CenterX = changed.x;
                    EditorUtility.SetDirty(profile);
                }

                Vector3 widthWorld = root.TransformPoint(local + Vector3.right * point.HalfWidth);
                EditorGUI.BeginChangeCheck();
                Vector3 movedWidth = Handles.Slider(widthWorld, root.right, handleSize, Handles.CubeHandleCap, .25f);
                if (EditorGUI.EndChangeCheck())
                {
                    Undo.RecordObject(profile, "Resize canyon opening");
                    point.HalfWidth = Mathf.Max(2f, root.InverseTransformPoint(movedWidth).x - point.CenterX);
                    EditorUtility.SetDirty(profile);
                }
                Handles.Label(world + Vector3.up * handleSize * 2f, $"{i + 1}: {point.Distance:0}m / width {point.HalfWidth * 2f:0}");

                if (i > 0)
                {
                    CanyonPathAuthoringPoint previous = profile.PathPoints[i - 1];
                    Handles.DrawAAPolyLine(4f,
                        root.TransformPoint(new Vector3(previous.CenterX, 0f, -previous.Distance)),
                        world);
                }
            }
        }
    }
}
