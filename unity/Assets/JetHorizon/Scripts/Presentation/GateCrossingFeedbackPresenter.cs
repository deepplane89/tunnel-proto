using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Owns only the short-lived world-space afterimage and water pulse created by a
    /// core-confirmed gate crossing. It never awards speed or decides whether a gate hit.
    /// </summary>
    public sealed class GateCrossingFeedbackPresenter : MonoBehaviour, ISimSystem
    {
        sealed class Pulse
        {
            public bool Active;
            public float Age;
            public float Duration;
            public float Radius;
            public float Strength;
            public Transform Ring;
            public MeshRenderer RingRenderer;
            public Transform Water;
            public MeshRenderer WaterRenderer;
            public MaterialPropertyBlock RingProperties;
            public MaterialPropertyBlock WaterProperties;
        }

        const int PoolSize = 8;
        readonly Pulse[] _pulses = new Pulse[PoolSize];
        Mesh _ringMesh;
        Material _ringMaterial;
        Material _waterMaterial;
        Texture2D _waterTexture;

        static readonly int TintId = Shader.PropertyToID("_Tint");
        static readonly int BodyColorId = Shader.PropertyToID("_BodyColor");
        static readonly int GlowStrengthId = Shader.PropertyToID("_GlowStrength");
        static readonly int EdgeStrengthId = Shader.PropertyToID("_EdgeStrength");
        static readonly int FadeId = Shader.PropertyToID("_Fade");

        void Awake() => EnsureBuilt();
        void OnEnable() => GameEvents.SpeedGateCrossed += GateCrossed;
        void OnDisable() => GameEvents.SpeedGateCrossed -= GateCrossed;

        void EnsureBuilt()
        {
            if (_ringMesh != null) return;
            _ringMesh = MeshFactory.PolygonTorus(1f, .10f, 24, 8);
            Shader neon = Shader.Find("JH/NeonCone");
            Shader additive = Shader.Find("JH/Additive");
            if (neon != null) _ringMaterial = new Material(neon) { name = "JH_GateAfterimage_Runtime" };
            if (additive != null)
            {
                _waterTexture = TextureFactory.RingSprite(128);
                _waterMaterial = new Material(additive) { name = "JH_GateWaterPulse_Runtime" };
                _waterMaterial.SetTexture("_MainTex", _waterTexture);
            }
            for (int i = 0; i < PoolSize; i++) _pulses[i] = CreatePulse(i);
        }

        Pulse CreatePulse(int index)
        {
            var ring = new GameObject("Gate Afterimage " + index);
            ring.transform.SetParent(transform, false);
            ring.AddComponent<MeshFilter>().sharedMesh = _ringMesh;
            var ringRenderer = ring.AddComponent<MeshRenderer>();
            ringRenderer.sharedMaterial = _ringMaterial;
            ringRenderer.shadowCastingMode = ShadowCastingMode.Off;
            ringRenderer.receiveShadows = false;

            var water = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(water.GetComponent<Collider>());
            water.name = "Gate Water Pulse " + index;
            water.transform.SetParent(transform, false);
            water.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
            var waterRenderer = water.GetComponent<MeshRenderer>();
            waterRenderer.sharedMaterial = _waterMaterial;
            waterRenderer.shadowCastingMode = ShadowCastingMode.Off;
            waterRenderer.receiveShadows = false;

            ring.SetActive(false);
            water.SetActive(false);
            return new Pulse
            {
                Ring = ring.transform,
                RingRenderer = ringRenderer,
                Water = water.transform,
                WaterRenderer = waterRenderer,
                RingProperties = new MaterialPropertyBlock(),
                WaterProperties = new MaterialPropertyBlock()
            };
        }

        public void ResetSystem()
        {
            EnsureBuilt();
            for (int i = 0; i < _pulses.Length; i++) Release(_pulses[i]);
        }

        public void SimTick(float dt)
        {
            EnsureBuilt();
            float speed = GameManager.I != null ? GameManager.I.Session.EffectiveSpeed : Tuning.BaseSpeed;
            for (int i = 0; i < _pulses.Length; i++)
            {
                Pulse pulse = _pulses[i];
                if (!pulse.Active) continue;
                pulse.Age += dt;
                float t = Mathf.Clamp01(pulse.Age / pulse.Duration);
                float eased = 1f - Mathf.Pow(1f - t, 3f);
                float fade = 1f - t;
                Vector3 ringPosition = pulse.Ring.position;
                ringPosition.z += speed * dt * 1.18f;
                pulse.Ring.position = ringPosition;
                pulse.Ring.localScale = Vector3.one * pulse.Radius * Mathf.Lerp(1f, 1.30f, eased);
                pulse.Ring.localRotation *= Quaternion.Euler(0f, 0f, dt * 55f * pulse.Strength);

                Vector3 waterPosition = pulse.Water.position;
                waterPosition.z += speed * dt;
                pulse.Water.position = waterPosition;
                pulse.Water.localScale = Vector3.one * pulse.Radius * Mathf.Lerp(.7f, 2.8f, eased);

                Color tint = pulse.RingProperties.GetColor(TintId);
                tint.a = fade;
                pulse.RingProperties.SetColor(TintId, tint);
                pulse.RingProperties.SetColor(BodyColorId, tint * .12f);
                pulse.RingProperties.SetFloat(GlowStrengthId, Mathf.Lerp(5f, 1.5f, eased) * pulse.Strength);
                pulse.RingProperties.SetFloat(EdgeStrengthId, 1f);
                pulse.RingProperties.SetFloat(FadeId, fade);
                pulse.RingRenderer.SetPropertyBlock(pulse.RingProperties);

                Color waterTint = tint;
                waterTint.a = fade * .55f * pulse.Strength;
                pulse.WaterProperties.SetColor(TintId, waterTint);
                pulse.WaterRenderer.SetPropertyBlock(pulse.WaterProperties);
                if (t >= 1f) Release(pulse);
            }
        }

        void GateCrossed(SpeedGateKind kind, float gain, int streak)
        {
            EnsureBuilt();
            Pulse pulse = Acquire();
            if (pulse == null) return;
            float strength = kind == SpeedGateKind.Common ? .34f
                : kind == SpeedGateKind.Surge ? .72f : 1f;
            if (streak > 0 && streak % 5 == 0) strength = Mathf.Min(1f, strength + .12f);
            Color tint = kind == SpeedGateKind.Common ? new Color(.12f, 1f, .38f, 1f)
                : kind == SpeedGateKind.Surge ? new Color(.16f, .95f, 1f, 1f)
                : kind == SpeedGateKind.CanyonTransition ? new Color(1f, .48f, .10f, 1f)
                : new Color(1f, .18f, .82f, 1f);
            pulse.Active = true;
            pulse.Age = 0f;
            pulse.Duration = Mathf.Lerp(.32f, .62f, strength);
            pulse.Radius = kind == SpeedGateKind.Common ? 7.5f : 8.5f;
            pulse.Strength = strength;
            float x = GameManager.I != null ? GameManager.I.Session.ShipX : 0f;
            pulse.Ring.position = new Vector3(x, 7.4f, Tuning.ShipZ + .3f);
            pulse.Ring.localScale = Vector3.one * pulse.Radius;
            pulse.Ring.localRotation = Quaternion.identity;
            pulse.Water.position = new Vector3(x, .045f, Tuning.ShipZ + .3f);
            pulse.Water.localScale = Vector3.one * pulse.Radius * .7f;
            pulse.RingProperties.SetColor(TintId, tint);
            pulse.WaterProperties.SetColor(TintId, tint);
            pulse.Ring.gameObject.SetActive(true);
            pulse.Water.gameObject.SetActive(true);
        }

        Pulse Acquire()
        {
            for (int i = 0; i < _pulses.Length; i++)
                if (!_pulses[i].Active) return _pulses[i];
            Pulse oldest = _pulses[0];
            for (int i = 1; i < _pulses.Length; i++)
                if (_pulses[i].Age > oldest.Age) oldest = _pulses[i];
            return oldest;
        }

        static void Release(Pulse pulse)
        {
            if (pulse == null) return;
            pulse.Active = false;
            pulse.Ring.gameObject.SetActive(false);
            pulse.Water.gameObject.SetActive(false);
        }

        void OnDestroy()
        {
            if (_ringMesh != null) Destroy(_ringMesh);
            if (_ringMaterial != null) Destroy(_ringMaterial);
            if (_waterMaterial != null) Destroy(_waterMaterial);
            if (_waterTexture != null) Destroy(_waterTexture);
        }
    }
}
