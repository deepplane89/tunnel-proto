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
            public ParticleSystem Debris;
            public Transform Ring;
            public MeshRenderer RingRenderer;
            public Light Light;
            public MaterialPropertyBlock RingProperties;
            public float Age;
            public float Strength;
            public bool Active;
        }

        struct ScheduledBurst
        {
            public bool Active;
            public float Delay;
            public float X;
            public float Z;
            public float Strength;
            public int ParticleCount;
            public int DebrisCount;
        }

        const int PoolSize = 18;
        const int MaxScheduledBursts = 12;
        const int MaxCachedTargets = 32;
        const float Lifetime = .78f;
        readonly Burst[] _pool = new Burst[PoolSize];
        readonly ScheduledBurst[] _scheduled = new ScheduledBurst[MaxScheduledBursts];
        readonly int[] _cachedTargetIds = new int[MaxCachedTargets];
        readonly Vector3[] _cachedTargetPositions = new Vector3[MaxCachedTargets];
        Material _particleMaterial;
        Material _debrisMaterial;
        Material _ringMaterial;
        Mesh _debrisMesh;
        Texture2D _particleTexture;
        Texture2D _ringTexture;
        int _cachedTargetCount;
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
                _debrisMaterial = new Material(additive) { name = "JH_LaserDestructionDebris" };
                _debrisMaterial.SetTexture("_MainTex", Texture2D.whiteTexture);
                _debrisMaterial.SetColor("_Tint", new Color(1f, .095f, .008f, .92f));
                _ringMaterial = new Material(additive) { name = "JH_LaserDestructionRing" };
                _ringMaterial.SetTexture("_MainTex", _ringTexture);
            }
            _debrisMesh = MeshFactory.Octahedron(1f);
            _debrisMesh.name = "JH_LaserReactorFragment";
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
            main.maxParticles = 64;
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

            var debrisObject = new GameObject("Physical Reactor Fragments");
            debrisObject.transform.SetParent(root.transform, false);
            var debris = debrisObject.AddComponent<ParticleSystem>();
            var debrisMain = debris.main;
            debrisMain.loop = false;
            debrisMain.playOnAwake = false;
            debrisMain.duration = .12f;
            debrisMain.startLifetime = new ParticleSystem.MinMaxCurve(.42f, .88f);
            debrisMain.startSpeed = new ParticleSystem.MinMaxCurve(5.5f, 14.5f);
            debrisMain.startSize = new ParticleSystem.MinMaxCurve(.18f, .52f);
            debrisMain.startRotation3D = true;
            debrisMain.startRotationX = new ParticleSystem.MinMaxCurve(-Mathf.PI, Mathf.PI);
            debrisMain.startRotationY = new ParticleSystem.MinMaxCurve(-Mathf.PI, Mathf.PI);
            debrisMain.startRotationZ = new ParticleSystem.MinMaxCurve(-Mathf.PI, Mathf.PI);
            debrisMain.startColor = new ParticleSystem.MinMaxGradient(
                new Color(1f, .92f, .52f, 1f),
                new Color(.72f, .015f, .002f, .95f));
            debrisMain.gravityModifier = .48f;
            debrisMain.simulationSpace = ParticleSystemSimulationSpace.World;
            debrisMain.maxParticles = 40;
            var debrisEmission = debris.emission;
            debrisEmission.enabled = false;
            var debrisShape = debris.shape;
            debrisShape.shapeType = ParticleSystemShapeType.Sphere;
            debrisShape.radius = .48f;
            var debrisRotation = debris.rotationOverLifetime;
            debrisRotation.enabled = true;
            debrisRotation.separateAxes = true;
            debrisRotation.x = new ParticleSystem.MinMaxCurve(-7.5f, 7.5f);
            debrisRotation.y = new ParticleSystem.MinMaxCurve(-9f, 9f);
            debrisRotation.z = new ParticleSystem.MinMaxCurve(-6f, 6f);
            var debrisColor = debris.colorOverLifetime;
            debrisColor.enabled = true;
            var debrisGradient = new Gradient();
            debrisGradient.SetKeys(
                new[]
                {
                    new GradientColorKey(Color.white, 0f),
                    new GradientColorKey(new Color(1f, .12f, .008f), .28f),
                    new GradientColorKey(new Color(.11f, .008f, .004f), 1f)
                },
                new[]
                {
                    new GradientAlphaKey(1f, 0f),
                    new GradientAlphaKey(.88f, .55f),
                    new GradientAlphaKey(0f, 1f)
                });
            debrisColor.color = debrisGradient;
            var debrisRenderer = debris.GetComponent<ParticleSystemRenderer>();
            debrisRenderer.renderMode = ParticleSystemRenderMode.Mesh;
            debrisRenderer.mesh = _debrisMesh;
            debrisRenderer.sharedMaterial = _debrisMaterial;
            debrisRenderer.shadowCastingMode = ShadowCastingMode.Off;
            debrisRenderer.receiveShadows = false;
            debrisRenderer.enableGPUInstancing = true;

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
                Debris = debris,
                Ring = ring.transform,
                RingRenderer = ringRenderer,
                Light = light,
                RingProperties = new MaterialPropertyBlock()
            };
        }

        void OnHazardDestroyed(int id, float x, float z)
        {
            EnsureBuilt();
            bool reactor = IsCachedLaserTarget(id);
            float strength = _pendingImpactStrength * (reactor ? 1.18f : 1f);
            TriggerBurst(
                x,
                z,
                strength,
                Mathf.RoundToInt((reactor ? 38f : 30f) + strength * 4f),
                Mathf.RoundToInt((reactor ? 18f : 10f) + strength * 3f));
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
            TriggerBurst(x, z, 2.9f, 64, 36);

            int scheduled = 0;
            int stride = Mathf.Max(1, Mathf.CeilToInt(_cachedTargetCount / 10f));
            for (int i = 0; i < _cachedTargetCount && scheduled < 10; i += stride)
            {
                Vector3 position = _cachedTargetPositions[i];
                ScheduleBurst(
                    .045f + scheduled * .042f,
                    position.x,
                    position.z,
                    1.38f + scheduled * .055f,
                    34,
                    20);
                scheduled++;
            }

            if (scheduled == 0)
            {
                for (int i = 0; i < 6; i++)
                {
                    float angle = i * Mathf.PI / 3f + .28f;
                    ScheduleBurst(
                        .045f + i * .05f,
                        x + Mathf.Cos(angle) * (3.6f + (i % 2) * 1.8f),
                        z + Mathf.Sin(angle) * 4.6f,
                        1.45f + i * .06f,
                        34,
                        20);
                }
            }
        }

        void ScheduleBurst(
            float delay,
            float x,
            float z,
            float strength,
            int particleCount,
            int debrisCount)
        {
            for (int i = 0; i < _scheduled.Length; i++)
            {
                if (_scheduled[i].Active) continue;
                _scheduled[i] = new ScheduledBurst
                {
                    Active = true,
                    Delay = delay,
                    X = x,
                    Z = z,
                    Strength = strength,
                    ParticleCount = particleCount,
                    DebrisCount = debrisCount
                };
                return;
            }
        }

        void TriggerBurst(
            float x,
            float z,
            float strength,
            int particleCount,
            int debrisCount)
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
            burst.Debris.Clear(true);
            burst.Particles.Emit(Mathf.Clamp(particleCount, 8, 64));
            burst.Debris.Emit(Mathf.Clamp(debrisCount, 6, 40));
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
            CacheLaserTargets();
            TickScheduledBursts(dt);
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

        void TickScheduledBursts(float dt)
        {
            for (int i = 0; i < _scheduled.Length; i++)
            {
                ScheduledBurst scheduled = _scheduled[i];
                if (!scheduled.Active) continue;
                scheduled.Delay -= dt;
                if (scheduled.Delay > 0f)
                {
                    _scheduled[i] = scheduled;
                    continue;
                }
                _scheduled[i] = default;
                TriggerBurst(
                    scheduled.X,
                    scheduled.Z,
                    scheduled.Strength,
                    scheduled.ParticleCount,
                    scheduled.DebrisCount);
            }
        }

        void CacheLaserTargets()
        {
            var snapshot = GameManager.I != null ? GameManager.I.CoreSnapshot : null;
            if (snapshot == null) return;
            int count = 0;
            for (int i = 0; i < snapshot.HazardCount && count < MaxCachedTargets; i++)
            {
                HazardSnapshot hazard = snapshot.GetHazard(i);
                if (hazard.Role != HazardRole.LaserFormationTarget) continue;
                _cachedTargetIds[count] = hazard.Id;
                _cachedTargetPositions[count] = new Vector3(hazard.X, hazard.Y, hazard.Z);
                count++;
            }
            if (count > 0) _cachedTargetCount = count;
        }

        bool IsCachedLaserTarget(int id)
        {
            for (int i = 0; i < _cachedTargetCount; i++)
                if (_cachedTargetIds[i] == id) return true;
            return false;
        }

        public void ResetPresentation()
        {
            EnsureBuilt();
            for (int i = 0; i < _pool.Length; i++) Release(_pool[i]);
            for (int i = 0; i < _scheduled.Length; i++) _scheduled[i] = default;
            _cachedTargetCount = 0;
            _pendingImpactStrength = 1f;
        }

        static void Release(Burst burst)
        {
            if (burst == null) return;
            burst.Active = false;
            burst.Age = 0f;
            burst.Strength = 1f;
            burst.Particles.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            burst.Debris.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            burst.Light.intensity = 0f;
            burst.Root.SetActive(false);
        }

        void OnDestroy()
        {
            if (_particleMaterial != null) Destroy(_particleMaterial);
            if (_debrisMaterial != null) Destroy(_debrisMaterial);
            if (_ringMaterial != null) Destroy(_ringMaterial);
            if (_debrisMesh != null) Destroy(_debrisMesh);
            if (_particleTexture != null) Destroy(_particleTexture);
            if (_ringTexture != null) Destroy(_ringTexture);
        }
    }
}
