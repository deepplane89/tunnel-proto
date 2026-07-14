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
        [Tooltip("Anchor to the imported ship's calibrated socket rig")]
        public bool AutoAnchorToModel = true;

        const int MaxParticlesPerNozzle = 160;

        // Production Runner's user-tuned full-roll particle anchors, converted from
        // its Three.js reference pose into ship-root-local coordinates.
        static readonly Vector3 RollUpL = new Vector3(-0.900000f, -0.666667f, 1.366667f);
        static readonly Vector3 RollUpR = new Vector3( 2.466667f, -0.633333f, 1.700000f);
        static readonly Vector3 RollDownL = new Vector3(-1.833333f, -0.600000f, 2.200000f);
        static readonly Vector3 RollDownR = new Vector3( 1.333333f, -0.633333f, 2.000000f);

        ParticleSystem _particlesL, _particlesR;
        Transform _bloomL, _bloomR;
        MeshRenderer _bloomLR, _bloomRR;
        MaterialPropertyBlock _bloomMpb;
        Transform _coneL, _coneR;
        Material _matL, _matR;
        Transform _socketL, _socketR;
        Light _thrusterLight;
        ThrusterEffectDefinition _effect;
        Material _fallbackAdditive;
        Texture2D _fallbackTexture;
        Color _color = new Color(0.27f, 0.67f, 1f);

        static readonly int TintId = Shader.PropertyToID("_Tint");

        void OnEnable() => GameEvents.VibeChanged += OnVibe;
        void OnDisable() => GameEvents.VibeChanged -= OnVibe;

        void OnDestroy()
        {
            if (_fallbackAdditive != null) Destroy(_fallbackAdditive);
            if (_fallbackTexture != null) Destroy(_fallbackTexture);
        }

        void OnVibe(int idx)
        {
            _color = Vibes.Get(idx).thrusterColor;
            ApplyParticleColor(_particlesL);
            ApplyParticleColor(_particlesR);
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
                NozzleL = SocketLocal(_socketL, NozzleL);
                NozzleR = SocketLocal(_socketR, NozzleR);
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
            Material additive = ResolveAdditiveMaterial();
            _bloomL = MakeSprite("NozzleBloomL", NozzleL, out _bloomLR, additive);
            _bloomR = MakeSprite("NozzleBloomR", NozzleR, out _bloomRR, additive);
            _particlesL = MakeParticleStream("ThrusterParticlesL", NozzleL, additive);
            _particlesR = MakeParticleStream("ThrusterParticlesR", NozzleR, additive);

            var lightGo = new GameObject("ThrusterCastLight");
            lightGo.transform.SetParent(transform, false);
            lightGo.transform.localPosition = (NozzleL + NozzleR) * 0.5f;
            _thrusterLight = lightGo.AddComponent<Light>();
            _thrusterLight.type = LightType.Point;
            _thrusterLight.color = Color.Lerp(_color, Color.white, 0.18f);
            _thrusterLight.range = 9f;
            _thrusterLight.intensity = 0f;
            _thrusterLight.shadows = LightShadows.None;
            _thrusterLight.renderMode = LightRenderMode.ForcePixel;
        }

        Material ResolveAdditiveMaterial()
        {
            if (AdditiveMaterial != null) return AdditiveMaterial;
            var shader = Shader.Find("JH/Additive");
            if (shader == null) return ExhaustMaterial;
            _fallbackTexture = TextureFactory.RadialSprite();
            _fallbackAdditive = new Material(shader) { name = "RuntimeThrusterAdditive" };
            _fallbackAdditive.SetTexture("_MainTex", _fallbackTexture);
            return _fallbackAdditive;
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
            main.startLifetime = new ParticleSystem.MinMaxCurve(0.22f, 0.42f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(4.2f, 7.0f);
            main.startSize = new ParticleSystem.MinMaxCurve(0.10f, 0.16f);
            main.startRotation = new ParticleSystem.MinMaxCurve(-Mathf.PI, Mathf.PI);
            main.startColor = Color.white;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.scalingMode = ParticleSystemScalingMode.Shape;
            main.maxParticles = MaxParticlesPerNozzle;
            main.gravityModifier = 0f;

            var emission = ps.emission;
            emission.rateOverTime = 820f;

            var shape = ps.shape;
            shape.enabled = true;
            shape.shapeType = ParticleSystemShapeType.Cone;
            shape.angle = 2.5f;
            shape.radius = 0.07f;
            shape.radiusThickness = 1f;
            shape.length = 0.04f;

            var size = ps.sizeOverLifetime;
            size.enabled = true;
            size.size = new ParticleSystem.MinMaxCurve(1f, new AnimationCurve(
                new Keyframe(0f, 1.55f), new Keyframe(0.12f, 1.18f), new Keyframe(0.62f, 0.62f), new Keyframe(1f, 0.08f)));

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

        void ApplyParticleColor(ParticleSystem ps)
        {
            if (ps == null) return;
            var color = ps.colorOverLifetime;
            color.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[]
                {
                    new GradientColorKey(new Color(1f, 0.94f, 0.88f), 0f),
                    new GradientColorKey(Color.Lerp(_color, Color.white, 0.18f), 0.12f),
                    new GradientColorKey(_color, 0.55f),
                    new GradientColorKey(_color * 0.25f, 1f),
                },
                new[]
                {
                    new GradientAlphaKey(0.96f, 0f),
                    new GradientAlphaKey(0.70f, 0.18f),
                    new GradientAlphaKey(0.30f, 0.72f),
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
            }

            float pulseWave = 0.86f + 0.14f * Mathf.Sin(Time.time * 22f);
            float bloomOpacity = Mathf.Lerp(0.68f, 0.92f, speedFrac) * pulseWave;
            Color bloomCol = Color.Lerp(_color, Color.white, 0.20f);
            bloomCol.a = bloomOpacity;
            _bloomMpb.Clear();
            _bloomMpb.SetColor(TintId, bloomCol);
            _bloomLR.SetPropertyBlock(_bloomMpb);
            _bloomRR.SetPropertyBlock(_bloomMpb);

            // Source bloom is 0.6 at idle and grows with speed; these are ship-local
            // values, so the root's .30 scale reproduces its visible world footprint.
            float bloomSize = Mathf.Lerp(0.90f, 1.58f, speedFrac) * pulseWave;
            _bloomL.localScale = Vector3.one * bloomSize;
            _bloomR.localScale = Vector3.one * bloomSize;

            if (_thrusterLight != null)
            {
                _thrusterLight.transform.localPosition = Vector3.Lerp(nozzleL, nozzleR, 0.5f) + new Vector3(0f, 0.08f, 0.12f);
                _thrusterLight.color = Color.Lerp(_color, Color.white, 0.18f);
                _thrusterLight.intensity = Mathf.Lerp(4.5f, 8.5f, speedFrac) * pulseWave;
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

        static void SetStreamActive(ParticleSystem ps, bool on, float speedFrac)
        {
            var main = ps.main;
            main.startLifetime = new ParticleSystem.MinMaxCurve(
                Mathf.Lerp(0.22f, 0.30f, speedFrac),
                Mathf.Lerp(0.42f, 0.58f, speedFrac));
            var emission = ps.emission;
            emission.rateOverTime = Mathf.Lerp(820f, 1180f, speedFrac);
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
