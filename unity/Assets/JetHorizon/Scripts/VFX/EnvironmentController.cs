using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Owns the lighting rig, fog, skybox gradient, the giant sun + corona + horizon
    /// seam, and vibe (palette) transitions. Values: spec/03 §2-4.
    /// </summary>
    public sealed class EnvironmentController : MonoBehaviour
    {
        [Header("Wired by bootstrap")]
        public Material SkyboxMaterial;      // JH/SkyboxGradient
        public Material SunMaterial;         // JH/Sun
        public Material WaterMaterial;       // JH/Water
        public Renderer HorizonSeam;         // additive quad
        public Transform SunGroup;           // sun sphere + corona + seam (tracks shipX)

        Vibe _current, _target;
        float _lerpT = 1f;

        void OnEnable()
        {
            GameEvents.VibeChanged += OnVibeChanged;
            _current = _target = Vibes.Get(0);
            Apply(_current);
        }
        void OnDisable() => GameEvents.VibeChanged -= OnVibeChanged;

        void OnVibeChanged(int idx)
        {
            _current = LerpVibe(_current, _target, Mathf.Clamp01(_lerpT));
            _target = Vibes.Get(idx);
            _lerpT = 0f;
        }

        void Update()
        {
            if (GameManager.I == null) return;

            if (_lerpT < 1f)
            {
                _lerpT = Mathf.Min(1f, _lerpT + Time.deltaTime * 0.5f);   // ~2 s crossfade
                Apply(LerpVibe(_current, _target, _lerpT));
            }

            // sun locked to shipX — infinite-distance illusion
            if (SunGroup != null)
            {
                var s = GameManager.I.Session;
                SunGroup.position = new Vector3(s.ShipX, SunGroup.position.y, SunGroup.position.z);
                if (WaterMaterial != null) WaterMaterial.SetFloat("_ShipX", s.ShipX);
            }
        }

        static Vibe LerpVibe(Vibe a, Vibe b, float t)
        {
            return new Vibe
            {
                name = b.name,
                skyTop = Color.Lerp(a.skyTop, b.skyTop, t),
                skyBot = Color.Lerp(a.skyBot, b.skyBot, t),
                gridColor = Color.Lerp(a.gridColor, b.gridColor, t),
                sunColor = Color.Lerp(a.sunColor, b.sunColor, t),
                fogColor = Color.Lerp(a.fogColor, b.fogColor, t),
                thrusterColor = Color.Lerp(a.thrusterColor, b.thrusterColor, t),
                nebulaTint = Color.Lerp(a.nebulaTint, b.nebulaTint, t),
                bloomStrength = Mathf.Lerp(a.bloomStrength, b.bloomStrength, t),
                sunShader = b.sunShader,
            };
        }

        void Apply(Vibe v)
        {
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Exponential;
            RenderSettings.fogDensity = 0.008f;
            RenderSettings.fogColor = v.fogColor;

            if (SkyboxMaterial != null)
            {
                SkyboxMaterial.SetColor("_TopColor", v.skyTop);
                SkyboxMaterial.SetColor("_BotColor", v.skyBot);
            }
            if (SunMaterial != null)
            {
                SunMaterial.SetColor("_SunColor", v.sunColor);
                bool warped = v.sunShader >= 2;
                SunMaterial.SetFloat("_Warp", warped ? 1f : 0f);
                // warp palette derived from sun color per branch
                SunMaterial.SetColor("_WarpCol1", v.sunColor * 0.35f);
                SunMaterial.SetColor("_WarpCol2", v.sunColor);
                Color hot = v.sunShader == 4 ? new Color(1f, 0.95f, 0.6f) :
                            v.sunShader == 3 ? Color.Lerp(v.sunColor, Color.white, 0.4f) :
                            new Color(1f, 0.45f, 0.08f);
                SunMaterial.SetColor("_WarpCol3", hot);
            }
            if (WaterMaterial != null)
                WaterMaterial.SetColor("_SkyColor", v.skyBot);
            if (HorizonSeam != null)
                HorizonSeam.material.SetColor("_Tint", new Color(
                    Mathf.Min(1f, v.sunColor.r + 0.15f), Mathf.Min(1f, v.sunColor.g + 0.05f), v.sunColor.b, 1f));

            // Bloom strength per vibe is applied by the bootstrap-created Volume;
            // adjust here if a Bloom override is present.
            var volume = FindFirstObjectByType<UnityEngine.Rendering.Volume>();
            if (volume != null && volume.profile != null &&
                volume.profile.TryGet<UnityEngine.Rendering.Universal.Bloom>(out var bloom))
                bloom.intensity.value = v.bloomStrength * 1.5f;   // URP intensity scale vs Unreal strength, tuned by eye
        }

        /// <summary>Lighting rig per spec/03 §2 — called by bootstrap at scene build.</summary>
        public static void BuildLightRig(Transform parent)
        {
            void Dir(string name, Color c, float intensity, Vector3 pos, Vector3? lookAt = null)
            {
                var go = new GameObject(name);
                go.transform.SetParent(parent, false);
                go.transform.position = pos;
                go.transform.LookAt(lookAt ?? Vector3.zero);
                var l = go.AddComponent<Light>();
                l.type = LightType.Directional;
                l.color = c; l.intensity = intensity;
                l.shadows = LightShadows.None;
            }
            Dir("KeyLight",  Color.white,                       2.56f, new Vector3(2f, 8.8f, 8f));
            Dir("RimLight",  TextureFactory.Hex(0x00f0ff),      0.10f, new Vector3(-3f, 6f, -8f));
            Dir("FillLight", TextureFactory.Hex(0xff44cc),      0.25f, new Vector3(0f, -2f, 6f));
            Dir("SunRakeR",  TextureFactory.Hex(0xff9500),      0.22f, new Vector3(2.5f, 1f, -18f), new Vector3(0f, 0.3f, 4.5f));
            Dir("SunRakeL",  TextureFactory.Hex(0xff9500),      0.10f, new Vector3(-2.5f, 1f, -18f), new Vector3(0f, 0.3f, 4.5f));
            RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.02f, 0.02f, 0.02f);
        }
    }
}
