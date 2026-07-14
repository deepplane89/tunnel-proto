using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Unity presentation of the production Runner exhaust. Attachment comes from the
    /// engine-neutral ship sockets; rendering uses two world-space particle streams,
    /// nozzle bloom and a small local light so the exhaust reads on both hull and water.
    /// </summary>
    public sealed class ThrusterFX : MonoBehaviour
    {
        public enum Style { Light, Pylon }

        [Header("Preset")]
        public Style Preset = Style.Light;

        [Header("Materials (wired by bootstrap)")]
        public Material ExhaustMaterial;
        public Material AdditiveMaterial;

        [Header("Fallback offsets (ship-root-local)")]
        public Vector3 NozzleL = new Vector3(-1.600000f, -0.766667f, 2.000000f);
        public Vector3 NozzleR = new Vector3( 1.600000f, -0.766667f, 2.000000f);
        public Vector3 MiniNozzleL = new Vector3(-0.733333f, -0.666667f, 2.000000f);
        public Vector3 MiniNozzleR = new Vector3( 0.733333f, -0.666667f, 2.000000f);
        [Tooltip("Anchor to the imported ship's calibrated socket rig")]
        public bool AutoAnchorToModel = true;

        const int MaxParticlesPerNozzle = 160;

        // Production Runner's user-tuned full-roll particle anchors, converted from
        // its Three.js reference pose into ship-root-local coordinates.
        static readonly Vector3 RollUpL = new Vector3(-0.900000f, -0.666667f, 1.366667f);
        static readonly Vector3 RollUpR = new Vector3( 2.466667f, -0.633333f, 1.700000f);
        static readonly Vector3 RollDownL = new Vector3(-1.833333f, -0.600000f, 2.200000f);
        static readonly Vector3 RollDownR = new Vector3( 1.333333f, -0.633333f, 2.000000f);

        ParticleSystem _particlesL, _particlesR, _miniParticlesL, _miniParticlesR;
        Transform _bloomL, _bloomR, _miniBloomL, _miniBloomR;
        MeshRenderer _bloomLR, _bloomRR, _miniBloomLR, _miniBloomRR;
        MaterialPropertyBlock _bloomMpb;
        Transform _coneL, _coneR;
        Material _matL, _matR;
        Transform _socketL, _socketR, _miniSocketL, _miniSocketR;
        bool _miniThrustersEnabled;
        Light _thrusterLight;
        ThrusterEffectDefinition _effect;
        Material _runtimeParticleMaterial;
        Material _runtimeBloomMaterial;
        Texture2D _fallbackTexture;
        Color _color = new Color(0.27f, 0.67f, 1f);

        static readonly int TintId = Shader.PropertyToID("_Tint");

        void OnEnable() => GameEvents.VibeChanged += OnVibe;
        void OnDisable() => GameEvents.VibeChanged -= OnVibe;

        void OnDestroy()
        {
            if (_runtimeParticleMaterial != null) Destroy(_runtimeParticleMaterial);
            if (_runtimeBloomMaterial != null) Destroy(_runtimeBloomMaterial);
            if (_fallbackTexture != null) Destroy(_fallbackTexture);
        }

        void OnVibe(int idx)
        {
            _color = Vibes.Get(idx).thrusterColor;
            ApplyParticleColor(_particlesL);
            ApplyParticleColor(_particlesR);
            ApplyMiniParticleColor(_miniParticlesL);
            ApplyMiniParticleColor(_miniParticlesR);
            if (_thrusterLight != null) _thrusterLight.color = Color.Lerp(_color, Color.white, 0.18f);
        }

        void Start()
        {
            _bloomMpb = new MaterialPropertyBlock();
            _effect = ThrusterEffectCatalog.Light;
            if (AutoAnchorToModel) AutoAnchor();
            if (Preset == Style.Pylon) BuildPylon();
            else BuildLight();
        }

        void AutoAnchor()
        {
            var model = transform.Find("ShipModel");
            if (model != null) SetLayerRecursively(model.gameObject, 8);

            var rig = GetComponent<ShipSocketRig>();
            if (rig == null)
            {
                if (model != null)
                {
                    rig = gameObject.AddComponent<ShipSocketRig>();
                    rig.Configure(ShipCatalog.Runner, model);
                }
            }
            if (rig != null && rig.MainThrusterLeft != null && rig.MainThrusterRight != null)
            {
                _socketL = rig.MainThrusterLeft;
                _socketR = rig.MainThrusterRight;
                _miniSocketL = rig.MiniThrusterLeft;
                _miniSocketR = rig.MiniThrusterRight;
                _miniThrustersEnabled = rig.MiniThrustersEnabled;
                NozzleL = SocketLocal(_socketL, NozzleL);
                NozzleR = SocketLocal(_socketR, NozzleR);
                MiniNozzleL = SocketLocal(_miniSocketL, MiniNozzleL);
                MiniNozzleR = SocketLocal(_miniSocketR, MiniNozzleR);
                return;
            }

            // Last-resort support for a differently imported GLB that exposes named nozzle nodes.
            Transform a = null, b = null;
            foreach (var t in GetComponentsInChildren<Transform>(true))
            {
                string n = t.name.ToLowerInvariant();
                if (!n.Contains("fire") && !n.Contains("nozzle") && !n.Contains("exhaust")) continue;
                if (a == null) a = t;
                else if (b == null && t != a) b = t;
            }
            if (a == null) return;
            Vector3 pa = transform.InverseTransformPoint(a.position);
            Vector3 pb = b != null ? transform.InverseTransformPoint(b.position) : pa;
            NozzleL = pa.x <= pb.x ? pa : pb;
            NozzleR = pa.x <= pb.x ? pb : pa;
        }

        static void SetLayerRecursively(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform child in go.transform)
                SetLayerRecursively(child.gameObject, layer);
        }

        // ── LIGHT ────────────────────────────────────────────────────────
        void BuildLight()
        {
            ResolveLightMaterials(out var particleMaterial, out var bloomMaterial);
            _bloomL = MakeSprite("NozzleBloomL", NozzleL, out _bloomLR, bloomMaterial);
            _bloomR = MakeSprite("NozzleBloomR", NozzleR, out _bloomRR, bloomMaterial);
            _particlesL = MakeParticleStream("ThrusterParticlesL", NozzleL, particleMaterial);
            _particlesR = MakeParticleStream("ThrusterParticlesR", NozzleR, particleMaterial);

            if (_miniThrustersEnabled)
            {
                _miniBloomL = MakeSprite("MiniNozzleBloomL", MiniNozzleL, out _miniBloomLR, bloomMaterial);
                _miniBloomR = MakeSprite("MiniNozzleBloomR", MiniNozzleR, out _miniBloomRR, bloomMaterial);
                _miniParticlesL = MakeMiniParticleStream("MiniThrusterParticlesL", MiniNozzleL, particleMaterial);
                _miniParticlesR = MakeMiniParticleStream("MiniThrusterParticlesR", MiniNozzleR, particleMaterial);
            }

            var lightGo = new GameObject("ThrusterCastLight");
            lightGo.transform.SetParent(transform, false);
            lightGo.transform.localPosition = (NozzleL + NozzleR) * 0.5f;
            _thrusterLight = lightGo.AddComponent<Light>();
            _thrusterLight.type = LightType.Point;
            _thrusterLight.color = Color.Lerp(_color, Color.white, 0.18f);
            _thrusterLight.range = 5.5f;
            _thrusterLight.intensity = 0f;
            _thrusterLight.shadows = LightShadows.None;
            _thrusterLight.renderMode = LightRenderMode.ForcePixel;
        }

        void ResolveLightMaterials(out Material particleMaterial, out Material bloomMaterial)
        {
            var shader = Shader.Find("JH/ThrusterAdditive");
            if (shader == null)
            {
                particleMaterial = bloomMaterial = AdditiveMaterial != null ? AdditiveMaterial : ExhaustMaterial;
                return;
            }

            _runtimeParticleMaterial = new Material(shader) { name = "RuntimeLightThrusterPoints" };
            _runtimeParticleMaterial.SetTexture("_MainTex", Texture2D.whiteTexture);
            _runtimeParticleMaterial.SetColor("_Tint", Color.white);

            Texture bloomTexture = AdditiveMaterial != null ? AdditiveMaterial.GetTexture("_MainTex") : null;
            if (bloomTexture == null)
            {
                _fallbackTexture = TextureFactory.RadialSprite();
                bloomTexture = _fallbackTexture;
            }
            _runtimeBloomMaterial = new Material(shader) { name = "RuntimeLightThrusterBloom" };
            _runtimeBloomMaterial.SetTexture("_MainTex", bloomTexture);
            _runtimeBloomMaterial.SetColor("_Tint", Color.white);
            particleMaterial = _runtimeParticleMaterial;
            bloomMaterial = _runtimeBloomMaterial;
        }

        Transform MakeSprite(string name, Vector3 localPos, out MeshRenderer mr, Material material)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(go.GetComponent<Collider>());
            go.name = name;
            go.transform.SetParent(transform, false);
            go.transform.localPosition = localPos;
            mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = material;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            mr.receiveShadows = false;
            return go.transform;
        }

        ParticleSystem MakeParticleStream(string name, Vector3 localPos, Material material)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = localPos;
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);

            var main = ps.main;
            main.loop = true;
            main.playOnAwake = false;
            main.duration = 1f;
            // LIGHT preset: (lifeMin .05 + jitter .05) * lifeBase .20.
            main.startLifetime = new ParticleSystem.MinMaxCurve(0.01f, 0.02f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(4.0f, 6.0f);
            main.startSize = 0.06f;
            main.startRotation = new ParticleSystem.MinMaxCurve(-Mathf.PI, Mathf.PI);
            main.startColor = Color.white;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.scalingMode = ParticleSystemScalingMode.Shape;
            main.maxParticles = MaxParticlesPerNozzle;
            main.gravityModifier = 0f;

            var emission = ps.emission;
            // The source maintains a fully populated 160-point buffer.
            emission.rateOverTime = 12000f;

            var shape = ps.shape;
            shape.enabled = true;
            shape.shapeType = ParticleSystemShapeType.Rectangle;
            shape.scale = new Vector3(0.07f, 0.07f, 0.001f);

            var size = ps.sizeOverLifetime;
            size.enabled = false;

            var renderer = ps.GetComponent<ParticleSystemRenderer>();
            renderer.sharedMaterial = material;
            renderer.renderMode = ParticleSystemRenderMode.Billboard;
            renderer.alignment = ParticleSystemRenderSpace.View;
            renderer.sortMode = ParticleSystemSortMode.YoungestInFront;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.minParticleSize = 0f;
            renderer.maxParticleSize = 0.12f;

            ApplyParticleColor(ps);
            return ps;
        }

        ParticleSystem MakeMiniParticleStream(string name, Vector3 localPos, Material material)
        {
            var ps = MakeParticleStream(name, localPos, material);
            var main = ps.main;
            main.startLifetime = 0.01f;
            main.startSpeed = new ParticleSystem.MinMaxCurve(1.3f, 1.7f);
            main.startSize = 0.09f;
            main.maxParticles = 50;

            var emission = ps.emission;
            emission.rateOverTime = 5000f;

            var shape = ps.shape;
            shape.scale = new Vector3(0.08f, 0.08f, 0.001f);
            ApplyMiniParticleColor(ps);
            return ps;
        }

        void ApplyParticleColor(ParticleSystem ps)
        {
            if (ps == null) return;
            var color = ps.colorOverLifetime;
            color.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[]
                {
                    new GradientColorKey(new Color(1f, 0.85f, 0.85f), 0f),
                    new GradientColorKey(_color, 0.10f),
                    new GradientColorKey(Color.black, 1f),
                },
                new[]
                {
                    new GradientAlphaKey(0.48f, 0f),
                    new GradientAlphaKey(0.48f, 0.90f),
                    new GradientAlphaKey(0f, 1f),
                });
            color.color = gradient;
        }

        void ApplyMiniParticleColor(ParticleSystem ps)
        {
            if (ps == null) return;
            var color = ps.colorOverLifetime;
            color.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[]
                {
                    new GradientColorKey(_color, 0f),
                    new GradientColorKey(_color, 0.10f),
                    new GradientColorKey(Color.black, 1f),
                },
                new[]
                {
                    new GradientAlphaKey(0.48f, 0f),
                    new GradientAlphaKey(0.48f, 0.90f),
                    new GradientAlphaKey(0f, 1f),
                });
            color.color = gradient;
        }

        // ── PYLON ────────────────────────────────────────────────────────
        void BuildPylon()
        {
            _coneL = MakeCone(NozzleL, out _matL);
            _coneR = MakeCone(NozzleR, out _matR);
        }

        Transform MakeCone(Vector3 localPos, out Material mat)
        {
            var go = new GameObject("ExhaustCone");
            go.transform.SetParent(transform, false);
            go.transform.localPosition = localPos;
            go.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            go.AddComponent<MeshFilter>().sharedMesh = MeshFactory.Cone(1f, 1f, 16);
            var mr = go.AddComponent<MeshRenderer>();
            mat = new Material(ExhaustMaterial);
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = ShadowCastingMode.Off;
            return go.transform;
        }

        void Update()
        {
            if (GameManager.I == null) return;
            bool on = GameManager.I.Phase == GamePhase.Playing;
            var s = GameManager.I.Session;
            float speedFrac = Mathf.Clamp01(s.EffectiveSpeed / (Tuning.BaseSpeed * 2.5f));

            if (Preset == Style.Pylon)
            {
                UpdatePylon(on, speedFrac);
                return;
            }

            if (_particlesL == null) return;
            Vector3 nozzleL = SocketLocal(_socketL, NozzleL);
            Vector3 nozzleR = SocketLocal(_socketR, NozzleR);
            ApplyRollPose(s.RollAngle, ref nozzleL, ref nozzleR);
            PositionEmitter(_particlesL, nozzleL);
            PositionEmitter(_particlesR, nozzleR);
            _bloomL.localPosition = nozzleL;
            _bloomR.localPosition = nozzleR;

            SetStreamActive(_particlesL, on, speedFrac);
            SetStreamActive(_particlesR, on, speedFrac);
            if (_miniThrustersEnabled)
            {
                Vector3 miniNozzleL = SocketLocal(_miniSocketL, MiniNozzleL);
                Vector3 miniNozzleR = SocketLocal(_miniSocketR, MiniNozzleR);
                PositionEmitter(_miniParticlesL, miniNozzleL);
                PositionEmitter(_miniParticlesR, miniNozzleR);
                _miniBloomL.localPosition = miniNozzleL;
                _miniBloomR.localPosition = miniNozzleR;
                SetStreamActive(_miniParticlesL, on, speedFrac, true);
                SetStreamActive(_miniParticlesR, on, speedFrac, true);
                _miniBloomL.gameObject.SetActive(on);
                _miniBloomR.gameObject.SetActive(on);
            }
            _bloomL.gameObject.SetActive(on);
            _bloomR.gameObject.SetActive(on);
            if (!on)
            {
                if (_thrusterLight != null) _thrusterLight.intensity = 0f;
                return;
            }

            var cam = UnityEngine.Camera.main;
            if (cam != null)
            {
                _bloomL.rotation = cam.transform.rotation;
                _bloomR.rotation = cam.transform.rotation;
                if (_miniThrustersEnabled)
                {
                    _miniBloomL.rotation = cam.transform.rotation;
                    _miniBloomR.rotation = cam.transform.rotation;
                }
            }

            float pulseWave = 0.86f + 0.14f * Mathf.Sin(Time.time * 22f);
            float bloomOpacity = 0.43f * (0.85f + 0.15f * Mathf.Sin(Time.time * 8f));
            Color bloomCol = _color;
            bloomCol.a = bloomOpacity;
            _bloomMpb.Clear();
            _bloomMpb.SetColor(TintId, bloomCol);
            _bloomLR.SetPropertyBlock(_bloomMpb);
            _bloomRR.SetPropertyBlock(_bloomMpb);

            // Source bloom is 0.6 at idle and grows with speed; these are ship-local
            // values, so the root's .30 scale reproduces its visible world footprint.
            float sourceSpeedScale = Mathf.Clamp(s.EffectiveSpeed / Tuning.BaseSpeed, 0f, 2.6f);
            float bloomSize = (0.6f + sourceSpeedScale * 0.7f) * 0.80f * 0.10f;
            _bloomL.localScale = Vector3.one * bloomSize;
            _bloomR.localScale = Vector3.one * bloomSize;

            if (_miniThrustersEnabled)
            {
                float miniBloomOpacity = 0.15f + sourceSpeedScale * 0.15f;
                Color miniBloomCol = _color;
                miniBloomCol.a = miniBloomOpacity;
                _bloomMpb.Clear();
                _bloomMpb.SetColor(TintId, miniBloomCol);
                _miniBloomLR.SetPropertyBlock(_bloomMpb);
                _miniBloomRR.SetPropertyBlock(_bloomMpb);
                float miniBloomSize = 0.25f + sourceSpeedScale * 0.25f;
                _miniBloomL.localScale = Vector3.one * miniBloomSize;
                _miniBloomR.localScale = Vector3.one * miniBloomSize;
            }

            if (_thrusterLight != null)
            {
                _thrusterLight.transform.localPosition = Vector3.Lerp(nozzleL, nozzleR, 0.5f) + new Vector3(0f, 0.08f, 0.12f);
                _thrusterLight.color = Color.Lerp(_color, Color.white, 0.18f);
                _thrusterLight.intensity = Mathf.Lerp(1.2f, 2.2f, speedFrac) * pulseWave;
            }
        }

        void UpdatePylon(bool on, float speedFrac)
        {
            if (_coneL == null) return;
            _coneL.gameObject.SetActive(on);
            _coneR.gameObject.SetActive(on);
            if (!on) return;
            float len = _effect.ConeLength * (0.7f + 0.5f * speedFrac) * (1f + Mathf.Sin(Time.time * 31f) * 0.04f);
            var sc = new Vector3(_effect.ConeRadius * 2f, len, _effect.ConeRadius * 2f);
            _coneL.localScale = sc;
            _coneR.localScale = sc;
            _coneL.localPosition = SocketLocal(_socketL, NozzleL);
            _coneR.localPosition = SocketLocal(_socketR, NozzleR);
            _matL.SetColor("_Color", _color);
            _matR.SetColor("_Color", _color);
        }

        static void PositionEmitter(ParticleSystem ps, Vector3 localPosition)
        {
            ps.transform.localPosition = localPosition;
            ps.transform.localRotation = Quaternion.identity;
        }

        static void ApplyRollPose(float rollAngle, ref Vector3 left, ref Vector3 right)
        {
            float ratio = Mathf.Clamp(rollAngle / (Mathf.PI * 0.5f), -1f, 1f);
            float amount = Mathf.Abs(ratio);
            if (amount <= 0.001f) return;
            if (ratio < 0f)
            {
                left = Vector3.Lerp(left, RollUpL, amount);
                right = Vector3.Lerp(right, RollUpR, amount);
            }
            else
            {
                left = Vector3.Lerp(left, RollDownL, amount);
                right = Vector3.Lerp(right, RollDownR, amount);
            }
        }

        static void SetStreamActive(ParticleSystem ps, bool on, float speedFrac, bool mini = false)
        {
            var main = ps.main;
            float sourceSpeedScale = Mathf.Clamp(speedFrac * 2.5f, 0f, 2.6f);
            main.startSpeed = mini
                ? new ParticleSystem.MinMaxCurve(0.8f + sourceSpeedScale * 0.5f, 1.2f + sourceSpeedScale * 0.5f)
                : new ParticleSystem.MinMaxCurve(2.5f + sourceSpeedScale * 1.5f, 4.5f + sourceSpeedScale * 1.5f);
            var emission = ps.emission;
            emission.rateOverTime = mini ? 5000f : 12000f;
            if (on)
            {
                if (!ps.isPlaying) ps.Play();
            }
            else if (ps.isPlaying || ps.particleCount > 0)
            {
                ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            }
        }

        Vector3 SocketLocal(Transform socket, Vector3 fallback)
        {
            return socket != null ? transform.InverseTransformPoint(socket.position) : fallback;
        }
    }
}
