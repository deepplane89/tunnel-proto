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
            public LineRenderer Glow;
            public LineRenderer Core;
            public float Age;
        }

        public Transform ShipRoot;

        GameObject _shield;
        Material _shieldMaterial;
        Light _shieldLight;
        Transform _magnetRingA, _magnetRingB;
        Material _magnetMaterialA, _magnetMaterialB;
        Light _magnetLight;
        readonly List<LaserBolt> _bolts = new List<LaserBolt>(24);
        readonly MaterialPropertyBlock _shipBlock = new MaterialPropertyBlock();
        Renderer[] _shipRenderers;
        float _shieldBuild;
        float _shieldBreak;
        float _shieldHitAge = -1f;
        Vector3 _shieldHitDirection = Vector3.back;
        bool _built;

        RunSession S => GameManager.I != null ? GameManager.I.Session : null;

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
            _shipRenderers = ShipRoot.Find("ShipModel")?.GetComponentsInChildren<Renderer>(true) ?? new Renderer[0];
            BuildShield();
            BuildMagnet();
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
                _shieldHitAge = -1f;
            }
        }

        void OnExpired(PowerupType type)
        {
            if (type == PowerupType.Shield) _shieldBreak = 0.6f;
        }

        void OnShieldHit(int remaining)
        {
            _shieldHitDirection = Random.onUnitSphere;
            _shieldHitDirection.z = -Mathf.Abs(_shieldHitDirection.z);
            _shieldHitDirection.Normalize();
            _shieldHitAge = 0f;
        }

        void OnShieldBroken() => _shieldBreak = 0.6f;

        void OnLaserFired(float laneOffset)
        {
            EnsureBuilt();
            if (ShipRoot == null) return;
            var root = new GameObject("LaserBolt");
            root.layer = 8;
            root.transform.position = ShipRoot.position + new Vector3(laneOffset, 0.45f, -2.5f);
            var bolt = new LaserBolt { Root = root };
            bolt.Glow = MakeLaserLine(root, "Glow", 0.12f, new Color(1f, 0.13f, 0f, 0.35f));
            bolt.Core = MakeLaserLine(root, "Core", 0.04f, Color.white);
            _bolts.Add(bolt);
        }

        LineRenderer MakeLaserLine(GameObject root, string name, float width, Color color)
        {
            var lineObject = new GameObject(name);
            lineObject.layer = 8;
            lineObject.transform.SetParent(root.transform, false);
            var line = lineObject.AddComponent<LineRenderer>();
            line.useWorldSpace = false;
            line.positionCount = 2;
            line.SetPosition(0, new Vector3(0f, 0f, -1f));
            line.SetPosition(1, new Vector3(0f, 0f, 1f));
            line.startWidth = line.endWidth = width;
            line.sharedMaterial = CreateAdditive(color, $"JH_Laser{name}");
            line.startColor = line.endColor = color;
            line.numCapVertices = 2;
            line.shadowCastingMode = ShadowCastingMode.Off;
            return line;
        }

        public void SimTick(float dt)
        {
            EnsureBuilt();
            if (!_built || S == null) return;
            UpdateShield(dt);
            UpdateMagnet();
            UpdateOverdrive();
            UpdateLaserBolts(dt);
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

            if (_shieldHitAge >= 0f)
            {
                _shieldHitAge += dt;
                if (_shieldHitAge >= 1.5f) _shieldHitAge = -1f;
            }
            _shieldMaterial.SetFloat("_TimeValue", S.Elapsed);
            _shieldMaterial.SetFloat("_Life", S.ShieldHits > 0 ? 1f : 0.25f);
            _shieldMaterial.SetFloat("_Reveal", reveal);
            _shieldMaterial.SetVector("_HitDirection", _shieldHitDirection);
            _shieldMaterial.SetFloat("_HitAge", _shieldHitAge);
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
                bolt.Age += dt;
                bolt.Root.transform.position += Vector3.back * 150f * dt;
                if (bolt.Age < 1.35f && bolt.Root.transform.position.z > -205f) continue;
                if (bolt.Glow != null) Destroy(bolt.Glow.sharedMaterial);
                if (bolt.Core != null) Destroy(bolt.Core.sharedMaterial);
                Destroy(bolt.Root);
                _bolts.RemoveAt(i);
            }
        }

        public void ResetSystem()
        {
            EnsureBuilt();
            _shieldBuild = _shieldBreak = 0f;
            _shieldHitAge = -1f;
            if (_shield != null) _shield.SetActive(false);
            if (_shieldLight != null) _shieldLight.intensity = 0f;
            if (_magnetRingA != null) _magnetRingA.gameObject.SetActive(false);
            if (_magnetRingB != null) _magnetRingB.gameObject.SetActive(false);
            if (_magnetLight != null) _magnetLight.intensity = 0f;
            foreach (var renderer in _shipRenderers ?? new Renderer[0]) renderer.SetPropertyBlock(null);
            foreach (var bolt in _bolts)
            {
                if (bolt.Glow != null) Destroy(bolt.Glow.sharedMaterial);
                if (bolt.Core != null) Destroy(bolt.Core.sharedMaterial);
                Destroy(bolt.Root);
            }
            _bolts.Clear();
        }
    }
}
