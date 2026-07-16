using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Unity view adapter for engine-neutral power-up snapshots. It owns no timers,
    /// collision, or damage state; it renders the production shield, laser,
    /// overdrive and magnet language from core facts and events.
    /// </summary>
    public sealed class PowerupPresentationSystem : MonoBehaviour, ISimSystem
    {
        sealed class LaserBolt
        {
            public GameObject Root;
            public LineRenderer Aura;
            public LineRenderer Glow;
            public LineRenderer Core;
            public Transform HeadFlare;
            public Transform Muzzle;
            public float Age;
        }

        const int LaserBoltPoolSize = 12;
        const float LaserBoltLifetime = .6f;
        const float LaserBoltSpeed = 140f;
        const int ShieldHitCount = 6;

        public Transform ShipRoot;

        GameObject _shield;
        Material _shieldMaterial;
        Light _shieldLight;
        Transform _magnetRingA, _magnetRingB;
        Material _magnetMaterialA, _magnetMaterialB;
        Light _magnetLight;
        readonly List<LaserBolt> _bolts = new List<LaserBolt>(24);
        Transform _laserPoolRoot;
        Material _laserAuraMaterial;
        Material _laserGlowMaterial;
        Material _laserCoreMaterial;
        Material _laserFlareMaterial;
        Texture2D _laserFlareTexture;
        Light _laserMuzzleLight;
        ShipSocketRig _socketRig;
        LaserSocketDefinition _laserDefinition;
        MaterialPropertyBlock _shipBlock;
        Renderer[] _shipRenderers;
        float _shieldBuild;
        float _shieldBreak;
        readonly Vector4[] _shieldHits = new Vector4[ShieldHitCount];
        int _shieldHitIndex;
        float _laserMuzzleAge = 99f;
        bool _built;

        RunSession S => GameManager.I != null ? GameManager.I.Session : null;

        void Awake()
        {
            // MaterialPropertyBlock allocates a native Unity object. Creating it in a
            // MonoBehaviour field initializer runs during serialization and is forbidden.
            _shipBlock = new MaterialPropertyBlock();
            for (int i = 0; i < ShieldHitCount; i++)
                _shieldHits[i] = new Vector4(0f, 1f, 0f, -999f);
        }

        void OnEnable()
        {
            GameEvents.PowerupActivated += OnActivated;
            GameEvents.PowerupExpired += OnExpired;
            GameEvents.ShieldHit += OnShieldHit;
            GameEvents.ShieldBroken += OnShieldBroken;
            GameEvents.LaserFired += OnLaserFired;
        }

        void OnDisable()
        {
            GameEvents.PowerupActivated -= OnActivated;
            GameEvents.PowerupExpired -= OnExpired;
            GameEvents.ShieldHit -= OnShieldHit;
            GameEvents.ShieldBroken -= OnShieldBroken;
            GameEvents.LaserFired -= OnLaserFired;
        }

        void EnsureBuilt()
        {
            if (_built || ShipRoot == null) return;
            _built = true;
            _socketRig = ShipRoot.GetComponent<ShipSocketRig>();
            _laserDefinition = ShipCatalog.Runner.Lasers;
            _shipRenderers = ShipRoot.Find("ShipModel")?.GetComponentsInChildren<Renderer>(true) ?? new Renderer[0];
            BuildShield();
            BuildMagnet();
            BuildLaserPool();
        }

        void BuildShield()
        {
            _shield = new GameObject("ProductionShield");
            _shield.layer = 8;
            _shield.transform.SetParent(ShipRoot, false);
            _shield.transform.localPosition = Vector3.zero;
            _shield.transform.localScale = Vector3.one * (2.4f / Mathf.Max(0.001f, ShipRoot.lossyScale.x));
            _shield.AddComponent<MeshFilter>().sharedMesh = MeshFactory.Sphere(1f, 48, 32);
            _shieldMaterial = new Material(Shader.Find("JH/Shield")) { name = "JH_ProductionShield" };
            var renderer = _shield.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = _shieldMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;

            var lightObject = new GameObject("ShieldLight");
            lightObject.transform.SetParent(ShipRoot, false);
            _shieldLight = lightObject.AddComponent<Light>();
            _shieldLight.type = LightType.Point;
            _shieldLight.color = TextureFactory.Hex(0x00eeff);
            _shieldLight.range = 8f;
            _shieldLight.shadows = LightShadows.None;
            _shieldLight.intensity = 0f;
            _shield.SetActive(false);
        }

        Material CreateAdditive(Color tint, string name)
        {
            var material = new Material(Shader.Find("JH/Additive")) { name = name };
            material.SetTexture("_MainTex", Texture2D.whiteTexture);
            material.SetColor("_Tint", tint);
            return material;
        }

        void BuildMagnet()
        {
            float inverseScale = 1f / Mathf.Max(0.001f, ShipRoot.lossyScale.x);
            Mesh mesh = MeshFactory.PolygonTorus(3.2f * inverseScale, 0.08f * inverseScale, 40, 6);
            _magnetMaterialA = CreateAdditive(new Color(0.27f, 1f, 0.53f, 0.55f), "JH_MagnetRingA");
            _magnetMaterialB = CreateAdditive(new Color(0.27f, 1f, 0.53f, 0.38f), "JH_MagnetRingB");
            _magnetRingA = MakeRing("MagnetRingA", mesh, _magnetMaterialA);
            _magnetRingB = MakeRing("MagnetRingB", mesh, _magnetMaterialB);

            var lightObject = new GameObject("MagnetLight");
            lightObject.transform.SetParent(ShipRoot, false);
            _magnetLight = lightObject.AddComponent<Light>();
            _magnetLight.type = LightType.Point;
            _magnetLight.color = TextureFactory.Hex(0x44ff88);
            _magnetLight.range = 12f;
            _magnetLight.shadows = LightShadows.None;
            _magnetLight.intensity = 0f;
        }

        Transform MakeRing(string name, Mesh mesh, Material material)
        {
            var root = new GameObject(name);
            root.layer = 8;
            root.transform.SetParent(ShipRoot, false);
            root.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = root.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            root.SetActive(false);
            return root.transform;
        }

        void OnActivated(PowerupType type, float duration)
        {
            EnsureBuilt();
            if (type == PowerupType.Shield)
            {
                _shieldBuild = 0.8f;
                _shieldBreak = 0f;
                ResetShieldHits();
            }
        }

        void OnExpired(PowerupType type)
        {
            if (type == PowerupType.Shield) _shieldBreak = 0.6f;
        }

        void OnShieldHit(int remaining)
        {
            // Source parity: impacts deliberately rotate through six independent
            // slots so overlapping cell flashes and traveling rings can coexist.
            _shieldHitIndex = (_shieldHitIndex + 1) % ShieldHitCount;
            Vector3 direction = Random.onUnitSphere.normalized;
            _shieldHits[_shieldHitIndex] = new Vector4(direction.x, direction.y, direction.z,
                S != null ? S.Elapsed : 0f);
        }

        void OnShieldBroken() => _shieldBreak = 0.6f;

        void OnLaserFired(float laneOffset)
        {
            EnsureBuilt();
            if (ShipRoot == null || _bolts.Count == 0) return;
            LaserBolt bolt = AcquireLaserBolt();
            bolt.Age = 0f;
            bolt.Muzzle = laneOffset < 0f
                ? (_socketRig != null ? _socketRig.LaserMuzzleLeft : null)
                : (_socketRig != null ? _socketRig.LaserMuzzleRight : null);
            Float3 fallback = laneOffset < 0f ? _laserDefinition.Left : _laserDefinition.Right;
            bolt.Root.transform.position = bolt.Muzzle != null
                ? bolt.Muzzle.position
                : ShipRoot.TransformPoint(new Vector3(fallback.X, fallback.Y, fallback.Z));
            bolt.Root.transform.rotation = Quaternion.identity;
            bolt.Root.SetActive(true);
            if (_laserMuzzleLight != null) _laserMuzzleLight.transform.position = bolt.Root.transform.position;
            _laserMuzzleAge = 0f;
        }

        void BuildLaserPool()
        {
            _laserPoolRoot = new GameObject("Laser Bolt Pool").transform;
            _laserPoolRoot.SetParent(transform, false);
            _laserAuraMaterial = CreateLaserMaterial(new Color(1f, .035f, .005f, .18f), 1.8f, .48f, "JH_LaserAuraShared");
            _laserGlowMaterial = CreateLaserMaterial(new Color(1f, .12f, .015f, .58f), 3.4f, .28f, "JH_LaserGlowShared");
            _laserCoreMaterial = CreateLaserMaterial(new Color(1f, .92f, .72f, 1f), 6.2f, .12f, "JH_LaserCoreShared");
            _laserFlareTexture = TextureFactory.RadialSprite(64);
            _laserFlareTexture.name = "JH_RuntimeLaserFlare";
            _laserFlareMaterial = CreateAdditive(new Color(1f, .28f, .025f, .9f), "JH_LaserHeadFlareShared");
            _laserFlareMaterial.SetTexture("_MainTex", _laserFlareTexture);
            for (int i = 0; i < LaserBoltPoolSize; i++)
            {
                var root = new GameObject($"Bolt {i + 1:00}");
                root.layer = 8;
                root.transform.SetParent(_laserPoolRoot, false);
                var bolt = new LaserBolt { Root = root };
                bolt.Aura = MakeLaserLine(
                    root,
                    "Plasma Aura",
                    .34f,
                    _laserDefinition.CoreLength * 1.10f,
                    _laserAuraMaterial);
                bolt.Glow = MakeLaserLine(
                    root,
                    "Energy Body",
                    .16f,
                    _laserDefinition.GlowLength,
                    _laserGlowMaterial);
                bolt.Core = MakeLaserLine(
                    root,
                    "White-Hot Core",
                    .045f,
                    _laserDefinition.CoreLength,
                    _laserCoreMaterial);
                bolt.HeadFlare = MakeLaserFlare(root, _laserDefinition.CoreLength);
                root.SetActive(false);
                _bolts.Add(bolt);
            }

            var muzzle = new GameObject("LaserMuzzleLight");
            muzzle.transform.SetParent(ShipRoot, false);
            muzzle.transform.localPosition = Vector3.zero;
            _laserMuzzleLight = muzzle.AddComponent<Light>();
            _laserMuzzleLight.type = LightType.Point;
            _laserMuzzleLight.color = new Color(1f, .16f, .02f);
            _laserMuzzleLight.range = 7f;
            _laserMuzzleLight.intensity = 0f;
            _laserMuzzleLight.shadows = LightShadows.None;
        }

        Material CreateLaserMaterial(Color tint, float intensity, float softness, string name)
        {
            var shader = Shader.Find("JH/Laser");
            var material = new Material(shader != null ? shader : Shader.Find("JH/Additive")) { name = name };
            if (shader != null)
            {
                material.SetColor("_Tint", tint);
                material.SetFloat("_Intensity", intensity);
                material.SetFloat("_EdgeSoftness", softness);
                material.SetFloat("_PulseSpeed", 18f);
            }
            else
            {
                material.SetTexture("_MainTex", Texture2D.whiteTexture);
                material.SetColor("_Tint", tint * intensity);
            }
            return material;
        }

        LaserBolt AcquireLaserBolt()
        {
            LaserBolt oldest = _bolts[0];
            for (int i = 0; i < _bolts.Count; i++)
            {
                if (!_bolts[i].Root.activeSelf) return _bolts[i];
                if (_bolts[i].Age > oldest.Age) oldest = _bolts[i];
            }
            return oldest;
        }

        LineRenderer MakeLaserLine(
            GameObject root,
            string name,
            float width,
            float length,
            Material material)
        {
            var lineObject = new GameObject(name);
            lineObject.layer = 8;
            lineObject.transform.SetParent(root.transform, false);
            var line = lineObject.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.positionCount = 2;
            line.SetPosition(0, new Vector3(0f, 0f, -length * .5f));
            line.SetPosition(1, new Vector3(0f, 0f, length * .5f));
            line.widthCurve = new AnimationCurve(
                new Keyframe(0f, .06f), new Keyframe(.14f, 1f),
                new Keyframe(.72f, .82f), new Keyframe(1f, 0f));
            line.widthMultiplier = width;
            line.sharedMaterial = material;
            line.startColor = line.endColor = Color.white;
            line.numCapVertices = 4;
            line.numCornerVertices = 2;
            line.textureMode = LineTextureMode.Stretch;
            line.shadowCastingMode = ShadowCastingMode.Off;
            return line;
        }

        Transform MakeLaserFlare(GameObject root, float coreLength)
        {
            var flare = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(flare.GetComponent<Collider>());
            flare.name = "Leading Flare";
            flare.layer = 8;
            flare.transform.SetParent(root.transform, false);
            flare.transform.localPosition = new Vector3(0f, 0f, -coreLength * .5f);
            flare.transform.localScale = Vector3.one * .58f;
            var renderer = flare.GetComponent<MeshRenderer>();
            renderer.sharedMaterial = _laserFlareMaterial;
            renderer.shadowCastingMode = ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return flare.transform;
        }

        public void SimTick(float dt)
        {
            EnsureBuilt();
            if (!_built || S == null) return;
            UpdateShield(dt);
            UpdateMagnet();
            UpdateOverdrive();
            UpdateLaserBolts(dt);
            UpdateLaserMuzzle(dt);
        }

        void UpdateShield(float dt)
        {
            bool active = S.ShieldTimer > 0f || _shieldBreak > 0f;
            _shield.SetActive(active);
            if (!active)
            {
                _shieldLight.intensity = 0f;
                return;
            }

            float reveal = 0f;
            if (_shieldBuild > 0f)
            {
                _shieldBuild = Mathf.Max(0f, _shieldBuild - dt);
                float t = 1f - _shieldBuild / 0.8f;
                float ease = t * (2f - t);
                reveal = 1f - ease;
                _shieldLight.intensity = ease * 1.5f;
            }
            else if (_shieldBreak > 0f)
            {
                _shieldBreak = Mathf.Max(0f, _shieldBreak - dt);
                float t = 1f - _shieldBreak / 0.6f;
                reveal = t * t;
                _shieldLight.intensity = (1f - reveal) * 1.5f;
            }
            else
            {
                _shieldLight.intensity = 1.2f + Mathf.Sin(S.Elapsed * 9f) * 0.4f;
            }

            _shieldMaterial.SetFloat("_TimeValue", S.Elapsed);
            _shieldMaterial.SetFloat("_Life", S.ShieldHits > 0 ? 1f : 0.25f);
            _shieldMaterial.SetFloat("_Reveal", reveal);
            _shieldMaterial.SetVectorArray("_HitData", _shieldHits);
        }

        void UpdateMagnet()
        {
            bool active = S.MagnetTimer > 0f;
            _magnetRingA.gameObject.SetActive(active);
            _magnetRingB.gameObject.SetActive(active);
            if (!active)
            {
                _magnetLight.intensity = 0f;
                return;
            }
            float time = S.Elapsed;
            _magnetRingA.localRotation = Quaternion.Euler(time * 1.8f * Mathf.Rad2Deg, time * 0.9f * Mathf.Rad2Deg, 0f);
            _magnetRingB.localRotation = Quaternion.Euler(time * 1.8f * Mathf.Rad2Deg + 90f, 0f, time * 1.2f * Mathf.Rad2Deg);
            float pulse = 0.55f + Mathf.Sin(time * 8f) * 0.2f;
            _magnetMaterialA.SetColor("_Tint", new Color(0.27f, 1f, 0.53f, pulse));
            _magnetMaterialB.SetColor("_Tint", new Color(0.27f, 1f, 0.53f, pulse * 0.7f));
            _magnetLight.intensity = 1.8f + Mathf.Sin(time * 6f) * 0.8f;
        }

        void UpdateOverdrive()
        {
            if (_shipRenderers == null) return;
            if (S.OverdriveTimer <= 0f)
            {
                foreach (var renderer in _shipRenderers) renderer.SetPropertyBlock(null);
                return;
            }

            Color baseColor;
            Color emission;
            float intensity;
            if (S.OverdriveSpeedTimer > 0f)
            {
                float hue = (S.Elapsed * 2f) % 1f;
                baseColor = Color.HSVToRGB(hue, 1f, 1f);
                emission = Color.HSVToRGB((hue + 0.08f) % 1f, 1f, 1f);
                intensity = 1.4f + Mathf.Sin(S.Elapsed * 12f * Mathf.PI) * 0.6f;
            }
            else
            {
                float flash = 0.5f + 0.5f * Mathf.Sin(S.Elapsed * 3f * Mathf.PI);
                baseColor = Color.white;
                emission = Color.white;
                intensity = flash * 1.5f;
            }
            _shipBlock.Clear();
            _shipBlock.SetColor("_BaseColor", baseColor);
            _shipBlock.SetColor("_EmissionColor", emission * intensity);
            foreach (var renderer in _shipRenderers) renderer.SetPropertyBlock(_shipBlock);
        }

        void UpdateLaserBolts(float dt)
        {
            for (int i = _bolts.Count - 1; i >= 0; i--)
            {
                var bolt = _bolts[i];
                if (!bolt.Root.activeSelf) continue;
                bolt.Age += dt;
                Vector3 position = bolt.Root.transform.position;
                if (bolt.Muzzle != null) position.x = bolt.Muzzle.position.x;
                position += Vector3.back * LaserBoltSpeed * dt;
                bolt.Root.transform.position = position;
                float life = Mathf.Clamp01(1f - bolt.Age / LaserBoltLifetime);
                float flareScale = (.34f + Mathf.Sin((S != null ? S.Elapsed : Time.time) * 31f + i) * .05f) * life;
                bolt.HeadFlare.localScale = Vector3.one * Mathf.Max(.01f, flareScale);
                var cam = Camera.main;
                if (cam != null)
                    bolt.HeadFlare.rotation = Quaternion.LookRotation(
                        bolt.HeadFlare.position - cam.transform.position, cam.transform.up);
                if (bolt.Age < LaserBoltLifetime && bolt.Root.transform.position.z > -205f) continue;
                bolt.Root.SetActive(false);
                bolt.Muzzle = null;
            }
        }

        void UpdateLaserMuzzle(float dt)
        {
            if (_laserMuzzleLight == null) return;
            _laserMuzzleAge += dt;
            float flash = Mathf.Exp(-_laserMuzzleAge * 24f);
            _laserMuzzleLight.intensity = 5.5f * flash;
        }

        void ResetShieldHits()
        {
            _shieldHitIndex = 0;
            for (int i = 0; i < ShieldHitCount; i++)
                _shieldHits[i] = new Vector4(0f, 1f, 0f, -999f);
            if (_shieldMaterial != null) _shieldMaterial.SetVectorArray("_HitData", _shieldHits);
        }

        public void ResetSystem()
        {
            EnsureBuilt();
            _shieldBuild = _shieldBreak = 0f;
            ResetShieldHits();
            if (_shield != null) _shield.SetActive(false);
            if (_shieldLight != null) _shieldLight.intensity = 0f;
            if (_magnetRingA != null) _magnetRingA.gameObject.SetActive(false);
            if (_magnetRingB != null) _magnetRingB.gameObject.SetActive(false);
            if (_magnetLight != null) _magnetLight.intensity = 0f;
            if (_laserMuzzleLight != null) _laserMuzzleLight.intensity = 0f;
            foreach (var renderer in _shipRenderers ?? new Renderer[0]) renderer.SetPropertyBlock(null);
            foreach (var bolt in _bolts)
            {
                bolt.Age = 0f;
                bolt.Muzzle = null;
                if (bolt.Root != null) bolt.Root.SetActive(false);
            }
        }

        void OnDestroy()
        {
            if (_shieldMaterial != null) Destroy(_shieldMaterial);
            if (_laserAuraMaterial != null) Destroy(_laserAuraMaterial);
            if (_laserGlowMaterial != null) Destroy(_laserGlowMaterial);
            if (_laserCoreMaterial != null) Destroy(_laserCoreMaterial);
            if (_laserFlareMaterial != null) Destroy(_laserFlareMaterial);
            if (_laserFlareTexture != null) Destroy(_laserFlareTexture);
        }
    }
}
