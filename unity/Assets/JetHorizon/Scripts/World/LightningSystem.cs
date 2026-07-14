using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Presents core-owned canyon lightning using the production visual language:
    /// blue warning disc, 10-segment white-hot core, broad blue glow, ground flash,
    /// camera shake and a short-lived point light. Timing and collision stay in core.
    /// </summary>
    public sealed class LightningSystem : MonoBehaviour, ISimSystem
    {
        public CameraRig Camera;
        public Material BoltMaterial;

        const float WarningDiscRadius = 3.5f;
        const float WarningSeconds = 0.3f;
        const float StrikeSeconds = 0.5f;
        const float LingerSeconds = 4f;
        const float BoltVisibleSeconds = StrikeSeconds + LingerSeconds;
        const float TunedCoreRadius = 0.45f;
        const float TunedGlowRadius = 0.25f;
        const float SkyHeight = 55f;
        const int SegmentCount = 10;
        const float Jaggedness = 1.9f;

        sealed class Strike
        {
            public int CoreId;
            public GameObject Warn;
            public MeshRenderer WarnRenderer;
            public GameObject Bolt;
            public LineRenderer Core;
            public LineRenderer Glow;
            public MeshRenderer GroundFlash;
            public Light FlashLight;
            public bool Struck;
            public int CrackleFrame = -1;
        }

        readonly List<Strike> _strikes = new List<Strike>(20);
        readonly Dictionary<int, HazardSnapshot> _coreStrikes = new Dictionary<int, HazardSnapshot>(32);
        MaterialPropertyBlock _mpb;
        Material _lineMaterial;

        static readonly int TintId = Shader.PropertyToID("_Tint");

        void Awake() => _mpb = new MaterialPropertyBlock();

        public void ResetSystem() => ClearAll();

        void OnDestroy()
        {
            ClearAll();
            if (_lineMaterial != null) Destroy(_lineMaterial);
        }

        void EnsureLineMaterial()
        {
            if (_lineMaterial != null) return;
            if (BoltMaterial != null)
            {
                _lineMaterial = new Material(BoltMaterial) { name = "JH_LightningLine" };
                _lineMaterial.SetTexture("_MainTex", Texture2D.whiteTexture);
                return;
            }
            var shader = Shader.Find("JH/Additive");
            if (shader != null)
            {
                _lineMaterial = new Material(shader) { name = "JH_LightningLine" };
                _lineMaterial.SetTexture("_MainTex", Texture2D.whiteTexture);
            }
        }

        void SetTint(Renderer renderer, Color color)
        {
            if (renderer == null) return;
            _mpb.Clear();
            _mpb.SetColor(TintId, color);
            renderer.SetPropertyBlock(_mpb);
        }

        void ClearAll()
        {
            foreach (var strike in _strikes) DestroyPresenter(strike);
            _strikes.Clear();
        }

        public void SimTick(float dt)
        {
            var snapshot = GameManager.I.CoreSnapshot;
            _coreStrikes.Clear();
            if (snapshot != null)
            {
                for (int i = 0; i < snapshot.HazardCount; i++)
                {
                    var hazard = snapshot.GetHazard(i);
                    if (hazard.Kind == HazardKind.Lightning) _coreStrikes[hazard.Id] = hazard;
                }
                EnsureCorePresenters(snapshot);
            }

            for (int i = _strikes.Count - 1; i >= 0; i--)
            {
                var strike = _strikes[i];
                if (!_coreStrikes.TryGetValue(strike.CoreId, out var hazard))
                {
                    DestroyPresenter(strike);
                    _strikes.RemoveAt(i);
                    continue;
                }

                if (strike.Warn != null)
                {
                    strike.Warn.transform.position = new Vector3(hazard.X, 0.055f, hazard.Z);
                    float warningPulse = 0.24f + 0.18f * (0.5f + 0.5f * Mathf.Sin(Time.time * 28f));
                    SetTint(strike.WarnRenderer, new Color(0.27f, 0.63f, 1f, warningPulse));
                }
                if (strike.Bolt != null)
                {
                    strike.Bolt.transform.position = new Vector3(hazard.X, 0.08f, hazard.Z);
                    float strikeAge = Mathf.Max(0f, hazard.AgeSeconds - WarningSeconds);
                    UpdateCrackle(strike, strikeAge);
                    UpdateStrikeFade(strike, strikeAge);
                }

                if (!strike.Struck && hazard.CollisionActive)
                {
                    strike.Struck = true;
                    if (strike.Warn != null)
                    {
                        Destroy(strike.Warn);
                        strike.Warn = null;
                        strike.WarnRenderer = null;
                    }
                    BuildBolt(strike, hazard.X, hazard.Z);
                    if (Camera != null) Camera.Shake();
                }
            }
        }

        void EnsureCorePresenters(SimulationSnapshot snapshot)
        {
            for (int i = 0; i < snapshot.HazardCount; i++)
            {
                var hazard = snapshot.GetHazard(i);
                if (hazard.Kind != HazardKind.Lightning) continue;
                bool found = false;
                foreach (var strike in _strikes)
                {
                    if (strike.CoreId == hazard.Id) { found = true; break; }
                }
                if (!found) SpawnPresenter(hazard);
            }
        }

        void SpawnPresenter(HazardSnapshot hazard)
        {
            var warn = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(warn.GetComponent<Collider>());
            warn.name = "LightningWarning";
            warn.transform.SetParent(transform, false);
            warn.transform.position = new Vector3(hazard.X, 0.055f, hazard.Z);
            warn.transform.rotation = Quaternion.Euler(90f, 0f, 0f);
            warn.transform.localScale = Vector3.one * (WarningDiscRadius * 2f);
            var renderer = warn.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = BoltMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            SetTint(renderer, new Color(0.27f, 0.63f, 1f, 0.35f));

            var strike = new Strike { CoreId = hazard.Id, Warn = warn, WarnRenderer = renderer };
            if (hazard.CollisionActive)
            {
                strike.Struck = true;
                Destroy(warn);
                strike.Warn = null;
                strike.WarnRenderer = null;
                BuildBolt(strike, hazard.X, hazard.Z);
            }
            _strikes.Add(strike);
        }

        void BuildBolt(Strike strike, float x, float z)
        {
            EnsureLineMaterial();
            var root = new GameObject("LightningStrike");
            root.transform.SetParent(transform, false);
            root.transform.position = new Vector3(x, 0.08f, z);
            strike.Bolt = root;

            var points = BuildJaggedPath();
            // Three.js tuned TubeGeometry uses radii 0.45 core / 0.25 glow.
            // LineRenderer consumes diameter, and its glow must surround the core.
            strike.Glow = MakeLine(root.transform, "Glow", (TunedCoreRadius + TunedGlowRadius) * 2f, points, 0);
            strike.Core = MakeLine(root.transform, "Core", TunedCoreRadius * 2f, points, 1);
            SetTint(strike.Glow, new Color(0.53f, 0.78f, 1f, 0.50f));
            SetTint(strike.Core, new Color(1f, 1f, 1f, 1f));

            var flash = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(flash.GetComponent<Collider>());
            flash.name = "GroundFlash";
            flash.transform.SetParent(root.transform, false);
            flash.transform.localPosition = new Vector3(0f, 0.02f, 0f);
            flash.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            flash.transform.localScale = Vector3.one * 11f;
            strike.GroundFlash = flash.GetComponent<MeshRenderer>();
            strike.GroundFlash.sharedMaterial = BoltMaterial;
            strike.GroundFlash.shadowCastingMode = ShadowCastingMode.Off;
            strike.GroundFlash.receiveShadows = false;
            SetTint(strike.GroundFlash, new Color(0.60f, 0.91f, 1f, 0.72f));

            var lightGo = new GameObject("StrikeLight");
            lightGo.transform.SetParent(root.transform, false);
            lightGo.transform.localPosition = new Vector3(0f, 3.5f, 0f);
            strike.FlashLight = lightGo.AddComponent<Light>();
            strike.FlashLight.type = LightType.Point;
            strike.FlashLight.color = new Color(0.60f, 0.91f, 1f);
            strike.FlashLight.range = 30f;
            strike.FlashLight.intensity = 14f;
            strike.FlashLight.shadows = LightShadows.None;
            strike.FlashLight.renderMode = LightRenderMode.ForcePixel;
        }

        Vector3[] BuildJaggedPath()
        {
            var points = new Vector3[SegmentCount + 1];
            points[0] = Vector3.zero;
            float x = 0f, z = 0f;
            for (int i = 1; i < SegmentCount; i++)
            {
                float edgeT = Mathf.Sin(i / (float)SegmentCount * Mathf.PI);
                x = Mathf.Lerp(x, Random.Range(-Jaggedness, Jaggedness), 0.72f);
                z = Mathf.Lerp(z, Random.Range(-Jaggedness * 0.42f, Jaggedness * 0.42f), 0.72f);
                points[i] = new Vector3(x * edgeT, SkyHeight * i / SegmentCount, z * edgeT);
            }
            points[SegmentCount] = new Vector3(0f, SkyHeight, 0f);
            return points;
        }

        LineRenderer MakeLine(Transform parent, string name, float width, Vector3[] points, int sortingOrder)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var line = go.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.sharedMaterial = _lineMaterial != null ? _lineMaterial : BoltMaterial;
            line.positionCount = points.Length;
            line.SetPositions(points);
            line.startWidth = width;
            line.endWidth = width * 0.52f;
            line.numCornerVertices = 3;
            line.numCapVertices = 4;
            line.textureMode = LineTextureMode.Stretch;
            line.alignment = LineAlignment.View;
            line.shadowCastingMode = ShadowCastingMode.Off;
            line.receiveShadows = false;
            line.sortingOrder = sortingOrder;
            return line;
        }

        void UpdateCrackle(Strike strike, float age)
        {
            float rate = age < StrikeSeconds ? 22f : 18f;
            int frame = Mathf.FloorToInt(age * rate);
            if (frame == strike.CrackleFrame || strike.Core == null || strike.Glow == null) return;
            strike.CrackleFrame = frame;
            var points = BuildJaggedPath();
            strike.Core.SetPositions(points);
            strike.Glow.SetPositions(points);
        }

        void UpdateStrikeFade(Strike strike, float age)
        {
            float boltFade;
            float glowFade;
            if (age <= StrikeSeconds)
            {
                float t = Mathf.Clamp01(age / StrikeSeconds);
                boltFade = Mathf.Max(0.8f, 1f - t * 0.1f);
                glowFade = Mathf.Max(0.4f, 0.5f - t * 0.05f);
            }
            else
            {
                float lingerT = Mathf.Clamp01((age - StrikeSeconds) / LingerSeconds);
                float finalFade = Mathf.InverseLerp(1f, 0.75f, lingerT);
                float flicker = 0.70f + 0.30f * Mathf.Abs(Mathf.Sin(age * 14f + strike.CoreId * 1.73f));
                boltFade = finalFade * flicker;
                glowFade = finalFade * flicker * 0.5f;
            }
            bool boltVisible = age < BoltVisibleSeconds && boltFade > 0.01f;
            if (strike.Core != null)
            {
                strike.Core.enabled = boltVisible;
                SetTint(strike.Core, new Color(1f, 1f, 1f, boltFade));
            }
            if (strike.Glow != null)
            {
                strike.Glow.enabled = boltVisible;
                SetTint(strike.Glow, new Color(0.53f, 0.78f, 1f, glowFade));
            }

            float groundFade = 1f - Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.18f, 1.35f, age));
            if (strike.GroundFlash != null)
            {
                strike.GroundFlash.enabled = groundFade > 0.01f;
                SetTint(strike.GroundFlash, new Color(0.60f, 0.91f, 1f, 0.72f * groundFade));
                float ringScale = Mathf.Lerp(11f, 18f, Mathf.Clamp01(age / 1.35f));
                strike.GroundFlash.transform.localScale = Vector3.one * ringScale;
            }
            if (strike.FlashLight != null)
            {
                float flash = Mathf.Exp(-age * 8.5f);
                strike.FlashLight.intensity = 14f * flash;
            }
        }

        static void DestroyPresenter(Strike strike)
        {
            if (strike.Warn != null) Destroy(strike.Warn);
            if (strike.Bolt != null) Destroy(strike.Bolt);
        }
    }
}
