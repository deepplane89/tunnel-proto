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
