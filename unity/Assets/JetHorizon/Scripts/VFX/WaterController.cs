using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Water floor behavior (spec/03 §5): plane follows ship X every frame,
    /// forward flow accumulates at 0.45 × speed.
    /// </summary>
    public sealed class WaterController : MonoBehaviour
    {
        public Material WaterMaterial;
        const float FlowScale = 0.45f;
        float _flowZ;

        void Awake()
        {
            // The hand-authored scene predates the reflection component. Keep this
            // self-healing so existing scenes and future bootstrapped scenes both get
            // the same source-accurate mirror without requiring a scene rebuild.
            if (WaterMaterial == null)
            {
                var renderer = GetComponent<Renderer>();
                if (renderer != null) WaterMaterial = renderer.sharedMaterial;
            }

            var reflection = GetComponent<PlanarReflection>();
            if (reflection == null) reflection = gameObject.AddComponent<PlanarReflection>();
            reflection.WaterMaterial = WaterMaterial;
            reflection.PlaneY = transform.position.y;
            reflection.ReflectLayer = 8;
        }

        void Update()
        {
            if (GameManager.I == null || WaterMaterial == null) return;
            var s = GameManager.I.Session;

            // follow ship X
            var p = transform.position;
            p.x = s.ShipX;
            transform.position = p;

            if (GameManager.I.Phase == GamePhase.Playing)
            {
                float rawDt = Mathf.Min(Time.deltaTime, Tuning.MaxRawDt);
                _flowZ -= s.EffectiveSpeed * (s.EffectiveSpeed / Tuning.BaseSpeed) * rawDt * FlowScale;
                WaterMaterial.SetFloat("_FlowZ", _flowZ);
            }
        }
    }
}
