using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Event-driven laser impact payoff. Gameplay destruction remains in the core;
    /// this presenter owns only pooled shards, shock rings and short-lived light.
    /// </summary>
    public sealed class LaserDestructionPresenter : MonoBehaviour
    {
        sealed class Burst
        {
            public GameObject Root;
            public ParticleSystem Particles;
            public Transform Ring;
            public MeshRenderer RingRenderer;
            public Light Light;
            public MaterialPropertyBlock RingProperties;
            public float Age;
            public float Strength;
            public bool Active;
        }

        const int PoolSize = 12;
        const float Lifetime = .72f;
        readonly Burst[] _pool = new Burst[PoolSize];
        Material _particleMaterial;
        Material _ringMaterial;
        Texture2D _particleTexture;
        Texture2D _ringTexture;
        float _pendingImpactStrength = 1f;

        static readonly int TintId = Shader.PropertyToID("_Tint");

        void Awake() => EnsureBuilt();
        void OnEnable()
        {
            GameEvents.HazardDestroyed += OnHazardDestroyed;
            GameEvents.LaserChainAdvanced += OnLaserChainAdvanced;
            GameEvents.LaserFormationCompleted += OnLaserFormationCompleted;
        }
        void OnDisable()
        {
            GameEvents.HazardDestroyed -= OnHazardDestroyed;
            GameEvents.LaserChainAdvanced -= OnLaserChainAdvanced;
            GameEvents.LaserFormationCompleted -= OnLaserFormationCompleted;
        }

        void EnsureBuilt()
        {
            if (_pool[0] != null) return;
            Shader additive = Shader.Find("JH/Additive");
            if (additive != null)
            {
                _particleTexture = TextureFactory.RadialSprite(64);
                _particleTexture.name = "JH_RuntimeLaserShards";
                _ringTexture = TextureFactory.RingSprite(96);
                _ringTexture.name = "JH_RuntimeLaserShockRing";
                _particleMaterial = new Material(additive) { name = "JH_LaserDestructionParticles" };
                _particleMaterial.SetTexture("_MainTex", _particleTexture);
                _particleMaterial.SetColor("_Tint", new Color(1f, .18f, .015f, .9f));
                _ringMaterial = new Material(additive) { name = "JH_LaserDestructionRing" };
                _ringMaterial.SetTexture("_MainTex", _ringTexture);
            }
            for (int i = 0; i < PoolSize; i++) _pool[i] = CreateBurst(i);
        }

        Burst CreateBurst(int index)
        {
            var root = new GameObject($"Laser Destruction {index + 1:00}");
            root.transform.SetParent(transform, false);

            var particleObject = new GameObject("Plasma Shards");
            particleObject.transform.SetParent(root.transform, false);
            var particles = particleObject.AddComponent<ParticleSystem>();
            var main = particles.main;
            main.loop = false;
            main.playOnAwake = false;
            main.duration = .12f;
            main.startLifetime = new ParticleSystem.MinMaxCurve(.28f, .62f);
            main.startSpeed = new ParticleSystem.MinMaxCurve(7f, 17f);
            main.startSize = new ParticleSystem.MinMaxCurve(.11f, .32f);
            main.startRotation = new ParticleSystem.MinMaxCurve(-Mathf.PI, Mathf.PI);
            main.startColor = new ParticleSystem.MinMaxGradient(
                new Color(1f, .95f, .72f, 1f),
                new Color(1f, .05f, .005f, .9f));
            main.gravityModifier = .32f;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.maxParticles = 48;
            var emission = particles.emission;
            emission.enabled = false;
            var shape = particles.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = .52f;
            var color = particles.colorOverLifetime;
            color.enabled = true;
            var gradient = new Gradient();
            gradient.SetKeys(
                new[]
                {
                    new GradientColorKey(Color.white, 0f),
                    new GradientColorKey(new Color(1f, .20f, .015f), .35f),
                    new GradientColorKey(new Color(.18f, .02f, .01f), 1f)
                },
                new[]
                {
                    new GradientAlphaKey(1f, 0f),
                    new GradientAlphaKey(.8f, .45f),
                    new GradientAlphaKey(0f, 1f)
                });
            color.color = gradient;
            var trails = particles.trails;
            trails.enabled = true;
            trails.ratio = .78f;
            trails.lifetime = .18f;
            trails.dieWithParticles = true;
            trails.widthOverTrail = new ParticleSystem.MinMaxCurve(
                1f,
                new AnimationCurve(new Keyframe(0f, 1f), new Keyframe(1f, 0f)));
            var particleRenderer = particles.GetComponent<ParticleSystemRenderer>();
            particleRenderer.renderMode = ParticleSystemRenderMode.Billboard;
            particleRenderer.sharedMaterial = _particleMaterial;
            particleRenderer.trailMaterial = _particleMaterial;
            particleRenderer.shadowCastingMode = ShadowCastingMode.Off;

            var ring = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(ring.GetComponent<Collider>());
            ring.name = "Shock Ring";
            ring.transform.SetParent(root.transform, false);
            ring.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            var ringRenderer = ring.GetComponent<MeshRenderer>();
            ringRenderer.sharedMaterial = _ringMaterial;
            ringRenderer.shadowCastingMode = ShadowCastingMode.Off;
            ringRenderer.receiveShadows = false;

            var lightObject = new GameObject("Impact Light");
            lightObject.transform.SetParent(root.transform, false);
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = new Color(1f, .13f, .01f);
            light.range = 13f;
            light.shadows = LightShadows.None;
            light.intensity = 0f;

            root.SetActive(false);
            return new Burst
            {
                Root = root,
                Particles = particles,
                Ring = ring.transform,
                RingRenderer = ringRenderer,
                Light = light,
                RingProperties = new MaterialPropertyBlock()
            };
        }

        void OnHazardDestroyed(int id, float x, float z)
        {
            EnsureBuilt();
            TriggerBurst(x, z, _pendingImpactStrength, Mathf.RoundToInt(30f + _pendingImpactStrength * 4f));
            _pendingImpactStrength = 1f;
        }

        void OnLaserChainAdvanced(int chain, int destroyedTotal)
        {
            float milestone = destroyedTotal > 0 && destroyedTotal % LaserRewardModel.CargoMilestoneInterval == 0
                ? .30f
                : 0f;
            _pendingImpactStrength = 1f + Mathf.Min(10, chain) * .055f + milestone;
        }

        void OnLaserFormationCompleted(float x, float z)
        {
            EnsureBuilt();
            TriggerBurst(x, z, 2.65f, 48);
            for (int i = 0; i < 4; i++)
            {
                float angle = i * Mathf.PI * .5f + .35f;
                TriggerBurst(
                    x + Mathf.Cos(angle) * 4.2f,
                    z + Mathf.Sin(angle) * 3.2f,
                    1.45f,
                    32);
            }
        }

        void TriggerBurst(float x, float z, float strength, int particleCount)
        {
            Burst burst = Acquire();
            burst.Active = true;
            burst.Age = 0f;
            burst.Strength = Mathf.Max(.6f, strength);
            burst.Root.transform.position = new Vector3(x, 1.25f, z);
            burst.Root.SetActive(true);
            burst.Ring.localScale = Vector3.one * .35f;
            burst.Light.intensity = 13f * burst.Strength;
            burst.Particles.Clear(true);
            burst.Particles.Emit(Mathf.Clamp(particleCount, 8, 48));
        }

        Burst Acquire()
        {
            for (int i = 0; i < _pool.Length; i++)
                if (!_pool[i].Active) return _pool[i];
            Burst oldest = _pool[0];
            for (int i = 1; i < _pool.Length; i++)
                if (_pool[i].Age > oldest.Age) oldest = _pool[i];
            return oldest;
        }

        void Update()
        {
            float dt = Mathf.Min(Time.unscaledDeltaTime, Tuning.MaxRawDt);
            for (int i = 0; i < _pool.Length; i++)
            {
                Burst burst = _pool[i];
                if (burst == null || !burst.Active) continue;
                burst.Age += dt;
                float t = Mathf.Clamp01(burst.Age / Lifetime);
                float fade = 1f - t;
                float eased = 1f - Mathf.Pow(1f - t, 3f);
                burst.Ring.localScale = Vector3.one * Mathf.Lerp(.35f, 8.5f * burst.Strength, eased);
                burst.RingProperties.SetColor(
                    TintId,
                    new Color(
                        1f,
                        Mathf.Lerp(.82f, .05f, t),
                        Mathf.Lerp(.12f, .015f, t),
                        fade * Mathf.Min(.9f, .62f + burst.Strength * .08f)));
                burst.RingRenderer.SetPropertyBlock(burst.RingProperties);
                burst.Light.intensity = 13f * burst.Strength * fade * fade;
                if (t < 1f) continue;
                Release(burst);
            }
        }

        public void ResetPresentation()
        {
            EnsureBuilt();
            for (int i = 0; i < _pool.Length; i++) Release(_pool[i]);
        }

        static void Release(Burst burst)
        {
            if (burst == null) return;
            burst.Active = false;
            burst.Age = 0f;
            burst.Strength = 1f;
            burst.Particles.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            burst.Light.intensity = 0f;
            burst.Root.SetActive(false);
        }

        void OnDestroy()
        {
            if (_particleMaterial != null) Destroy(_particleMaterial);
            if (_ringMaterial != null) Destroy(_ringMaterial);
            if (_particleTexture != null) Destroy(_particleTexture);
            if (_ringTexture != null) Destroy(_ringTexture);
        }
    }
}
