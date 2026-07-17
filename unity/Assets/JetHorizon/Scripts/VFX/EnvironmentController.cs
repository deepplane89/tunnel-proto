using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

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
        Volume _volume;
        ColorAdjustments _colorAdjustments;
        Bloom _bloom;
        Vignette _vignette;
        ChromaticAberration _chromaticAberration;
        Light _keyLight, _rimLight, _fillLight, _sunRakeR, _sunRakeL;
        Renderer _corona;
        Texture2D _runtimeCorona;
        Mesh _runtimeSunMesh;

        // Three.js and URP do not map identical light/post values to identical pixels.
        // These are Unity presentation calibrations; simulation and vibe data stay untouched.
        const float FogDensity = 0.0058f;
        const float PostExposure = 0.90f;
        const float BloomScale = 1.65f;
        const float VignetteIntensity = 0.16f;
        const int ReflectableLayer = 8;
        static readonly int ForceFarDepthId = Shader.PropertyToID("_ForceFarDepth");

        void OnEnable()
        {
            GameEvents.VibeChanged += OnVibeChanged;
            CachePresentationRig();
            // This legacy additive quad is the broad horizontal flare the player
            // was seeing as "god rays" on the horizon. The hero sun, corona and
            // real water reflection already provide the intended horizon light.
            if (HorizonSeam != null) HorizonSeam.enabled = false;
            _current = _target = Vibes.Get(0);
            Apply(_current);
        }
        void OnDisable() => GameEvents.VibeChanged -= OnVibeChanged;

        void OnDestroy()
        {
            if (_runtimeCorona != null) Destroy(_runtimeCorona);
            if (_runtimeSunMesh != null) Destroy(_runtimeSunMesh);
        }

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

        void LateUpdate()
        {
            var cam = Camera.main;
            if (cam == null) return;
            // Match the source's billboarded corona/seam so the hero sun remains clean
            // during steering roll, retry sweeps and the death camera orbit.
            if (_corona != null)
                _corona.transform.LookAt(cam.transform.position, cam.transform.up);
            if (HorizonSeam != null && HorizonSeam.enabled)
                HorizonSeam.transform.LookAt(cam.transform.position, cam.transform.up);
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
            RenderSettings.fogDensity = FogDensity;
            RenderSettings.fogColor = v.fogColor;
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.12f, 0.13f, 0.18f);

            if (SkyboxMaterial != null)
            {
                SkyboxMaterial.SetColor("_TopColor", v.skyTop);
                SkyboxMaterial.SetColor("_BotColor", v.skyBot);
                SkyboxMaterial.SetFloat("_PanoBrightness", 0f);
            }
            if (SunMaterial != null)
            {
                SunMaterial.SetColor("_SunColor", v.sunColor);
                // The user wants the source's fully-enabled Quilez treatment on the
                // opening sun too: use the exact 1.0 branch blend, not a diluted overlay.
                bool explicitQuilez = v.sunShader == 0 || v.sunShader == 2;
                SunMaterial.SetFloat("_Warp", explicitQuilez ? 1f : 0f);
                SunMaterial.SetFloat("_Mode", v.sunShader);
                // Exact source Quilez palette. Ice and gold use their dedicated
                // built-in palettes in JH_Sun and ignore these three uniforms.
                SunMaterial.SetColor("_WarpCol1", new Color(0.25f, 0.04f, 0.02f));
                SunMaterial.SetColor("_WarpCol2", new Color(0.85f, 0.15f, 0.04f));
                SunMaterial.SetColor("_WarpCol3", new Color(1f, 0.45f, 0.08f));
                SunMaterial.SetFloat("_Emission", 1f);
            }
            if (WaterMaterial != null)
            {
                WaterMaterial.SetColor("_SkyColor", v.skyBot);
                WaterMaterial.SetColor("_SunColor", Color.Lerp(Color.black, v.sunColor, 0.72f));
            }
            if (HorizonSeam != null && HorizonSeam.enabled)
                HorizonSeam.material.SetColor("_Tint", new Color(
                    Mathf.Min(1f, v.sunColor.r + 0.15f), Mathf.Min(1f, v.sunColor.g + 0.05f), v.sunColor.b, 1f));
            if (_corona != null)
            {
                Color coronaTint = Color.Lerp(Color.white, v.sunColor, 0.22f);
                coronaTint.a = 1f;
                _corona.material.SetColor("_Tint", coronaTint);
            }

            ApplyLightingCalibration();
            if (_colorAdjustments != null) _colorAdjustments.postExposure.value = PostExposure;
            if (_bloom != null)
            {
                _bloom.intensity.value = v.bloomStrength * BloomScale;
                _bloom.threshold.value = 0.85f;
                _bloom.scatter.value = 0.30f;
                _bloom.highQualityFiltering.value = true;
            }
            if (_vignette != null)
            {
                _vignette.intensity.value = VignetteIntensity;
                _vignette.smoothness.value = 0.45f;
            }
            if (_chromaticAberration != null) _chromaticAberration.intensity.value = 0.015f;
        }

        void CachePresentationRig()
        {
            _volume = FindFirstObjectByType<Volume>();
            if (_volume != null && _volume.profile != null)
            {
                _volume.profile.TryGet(out _colorAdjustments);
                _volume.profile.TryGet(out _bloom);
                _volume.profile.TryGet(out _vignette);
                _volume.profile.TryGet(out _chromaticAberration);
            }

            _keyLight = FindLight("KeyLight");
            _rimLight = FindLight("RimLight");
            _fillLight = FindLight("FillLight");
            _sunRakeR = FindLight("SunRakeR");
            _sunRakeL = FindLight("SunRakeL");

            // Three.js directional lights point from their position toward their
            // target (the origin unless explicitly overridden). Reapply that rule
            // here so scene serialization or hierarchy changes cannot reverse them.
            AimDirectional(_keyLight, new Vector3(2f, 8.8f, 8f), Vector3.zero);
            AimDirectional(_rimLight, new Vector3(-3f, 6f, -8f), Vector3.zero);
            AimDirectional(_fillLight, new Vector3(0f, -2f, 6f), Vector3.zero);
            AimDirectional(_sunRakeR, new Vector3(2.5f, 1f, -18f), new Vector3(0f, 0.3f, 4.5f));
            AimDirectional(_sunRakeL, new Vector3(-2.5f, 1f, -18f), new Vector3(0f, 0.3f, 4.5f));

            if (SunGroup != null)
            {
                // Three.js rendered the hero sun into Water's mirror. The original
                // Unity pass only included ship/canyon layer 8, which removed the
                // actual sun and left a synthetic straight specular strip instead.
                SetLayerRecursively(SunGroup.gameObject, ReflectableLayer);
                var sunTransform = SunGroup.Find("Sun");
                var sunFilter = sunTransform != null ? sunTransform.GetComponent<MeshFilter>() : null;
                if (sunFilter != null)
                {
                    _runtimeSunMesh = MeshFactory.Sphere(0.5f, 64, 64);
                    sunFilter.sharedMesh = _runtimeSunMesh;
                }
                var coronaTransform = SunGroup.Find("Corona");
                _corona = coronaTransform != null ? coronaTransform.GetComponent<Renderer>() : null;
                if (_corona != null && _corona.sharedMaterial != null)
                {
                    // Corona is part of the celestial disc. At ordinary world depth it
                    // could still draw over canyon geometry behind z=-340 even after
                    // the sun sphere itself moved to far depth.
                    _corona.material.SetFloat(ForceFarDepthId, 1f);
                    _runtimeCorona = TextureFactory.SunCorona(1024);
                    _runtimeCorona.name = "RuntimeSunCorona";
                    _runtimeCorona.wrapMode = TextureWrapMode.Clamp;
                    _runtimeCorona.filterMode = FilterMode.Trilinear;
                    _runtimeCorona.anisoLevel = 4;
                    _corona.material.SetTexture("_MainTex", _runtimeCorona);
                }
            }
            if (HorizonSeam != null && HorizonSeam.enabled && HorizonSeam.sharedMaterial != null)
            {
                // Keep the additive horizon streak behind every world-space surface
                // for the same reason as the sun and corona.
                HorizonSeam.material.SetFloat(ForceFarDepthId, 1f);
            }
        }

        static void SetLayerRecursively(GameObject root, int layer)
        {
            root.layer = layer;
            foreach (Transform child in root.transform)
                SetLayerRecursively(child.gameObject, layer);
        }

        static Light FindLight(string objectName)
        {
            var go = GameObject.Find(objectName);
            return go != null ? go.GetComponent<Light>() : null;
        }

        static void AimDirectional(Light light, Vector3 sourcePosition, Vector3 targetPosition)
        {
            if (light == null) return;
            light.transform.position = sourcePosition;
            light.transform.rotation = Quaternion.LookRotation((targetPosition - sourcePosition).normalized, Vector3.up);
        }

        void ApplyLightingCalibration()
        {
            // Preserve the source rig's direction and color, while lifting URP's dark
            // metallic midtones enough to keep the ship and hazards readable.
            if (_keyLight != null) _keyLight.intensity = 3.75f;
            if (_rimLight != null) _rimLight.intensity = 0.38f;
            if (_fillLight != null) _fillLight.intensity = 0.58f;
            if (_sunRakeR != null) _sunRakeR.intensity = 0.48f;
            if (_sunRakeL != null) _sunRakeL.intensity = 0.32f;
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
            Dir("KeyLight",  Color.white,                       3.75f, new Vector3(2f, 8.8f, 8f));
            Dir("RimLight",  TextureFactory.Hex(0x00f0ff),      0.38f, new Vector3(-3f, 6f, -8f));
            Dir("FillLight", TextureFactory.Hex(0xff44cc),      0.58f, new Vector3(0f, -2f, 6f));
            Dir("SunRakeR",  TextureFactory.Hex(0xff9500),      0.48f, new Vector3(2.5f, 1f, -18f), new Vector3(0f, 0.3f, 4.5f));
            Dir("SunRakeL",  TextureFactory.Hex(0xff9500),      0.32f, new Vector3(-2.5f, 1f, -18f), new Vector3(0f, 0.3f, 4.5f));
            RenderSettings.ambientMode = AmbientMode.Flat;
            RenderSettings.ambientLight = new Color(0.12f, 0.13f, 0.18f);
        }
    }
}
