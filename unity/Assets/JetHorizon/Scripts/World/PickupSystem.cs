using System.Collections.Generic;
using UnityEngine;
using JetHorizon.Simulation;

namespace JetHorizon
{
    /// <summary>
    /// Coins (spec/02 §1.11): single / curved chain / straight chain patterns,
    /// bob + spin, proximity collect. Bonus-ring hooks kept for parity (wiped on canyons).
    /// </summary>
    public sealed class PickupSystem : MonoBehaviour, ISimSystem
    {
        public Material CoinMaterial;   // JH/NeonCone with gold tint

        sealed class Coin
        {
            public Transform T; public bool Active; public float Phase; public float BaseY; public int CoreId;
        }

        sealed class PowerupView
        {
            public Transform T;
            public Transform Icon;
            public bool Active;
            public int CoreId;
            public PowerupType Type;
            public Vector3 LastPosition;
        }

        sealed class CargoView
        {
            public Transform T;
            public Transform Core;
            public Transform LeftRail;
            public Transform RightRail;
            public MeshRenderer[] Renderers;
            public bool Active;
            public int CoreId;
            public RunCargoKind Kind;
        }

        const int PoolSize = 100;
        readonly List<Coin> _coins = new List<Coin>(PoolSize);
        readonly List<PowerupView> _powerups = new List<PowerupView>(10);
        readonly List<CargoView> _cargo = new List<CargoView>(18);
        readonly Dictionary<int, PickupSnapshot> _corePickups = new Dictionary<int, PickupSnapshot>(PoolSize);
        Mesh _coinMesh;
        Mesh _octahedronMesh, _torusMesh, _sphereMesh;
        Material _powerupCubeMaterial;
        readonly Dictionary<PowerupType, Material> _powerupIconMaterials = new Dictionary<PowerupType, Material>();
        readonly Dictionary<RunCargoKind, Material> _cargoMaterials = new Dictionary<RunCargoKind, Material>();

        RunSession S => GameManager.I.Session;

        void Awake()
        {
            BuildPool();
            BuildPowerupPool();
            BuildCargoPool();
        }

        void BuildCargoPool()
        {
            if (_cargo.Count > 0) return;
            _cargoMaterials[RunCargoKind.Salvage] = CreateHologram(TextureFactory.Hex(0x47f5ff), false);
            _cargoMaterials[RunCargoKind.Alloy] = CreateHologram(TextureFactory.Hex(0xffa43b), false);
            _cargoMaterials[RunCargoKind.Prism] = CreateHologram(TextureFactory.Hex(0xff4dff), false);
            var parent = new GameObject("CargoPool").transform;
            parent.SetParent(transform, false);
            for (int i = 0; i < 24; i++)
            {
                var root = new GameObject("cargo-pod");
                root.layer = 8;
                root.transform.SetParent(parent, false);

                GameObject core = CargoPart(root.transform, "Core", PrimitiveType.Cube);
                GameObject left = CargoPart(root.transform, "LeftRail", PrimitiveType.Cube);
                GameObject right = CargoPart(root.transform, "RightRail", PrimitiveType.Cube);
                left.transform.localPosition = new Vector3(-.9f, 0f, 0f);
                right.transform.localPosition = new Vector3(.9f, 0f, 0f);
                left.transform.localScale = right.transform.localScale = new Vector3(.18f, 1.15f, 2.1f);
                var renderers = new[]
                {
                    core.GetComponent<MeshRenderer>(),
                    left.GetComponent<MeshRenderer>(),
                    right.GetComponent<MeshRenderer>()
                };
                root.SetActive(false);
                _cargo.Add(new CargoView
                {
                    T = root.transform,
                    Core = core.transform,
                    LeftRail = left.transform,
                    RightRail = right.transform,
                    Renderers = renderers
                });
            }
        }

        static GameObject CargoPart(Transform parent, string name, PrimitiveType primitive)
        {
            GameObject part = GameObject.CreatePrimitive(primitive);
            Object.Destroy(part.GetComponent<Collider>());
            part.name = name;
            part.layer = 8;
            part.transform.SetParent(parent, false);
            part.GetComponent<MeshRenderer>().shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return part;
        }

        void BuildPool()
        {
            if (_coins.Count > 0) return;
            _coinMesh = MeshFactory.Coin();
            var parent = new GameObject("CoinPool").transform;
            parent.SetParent(transform, false);
            for (int i = 0; i < PoolSize; i++)
            {
                var go = new GameObject("coin");
                go.transform.SetParent(parent, false);
                go.AddComponent<MeshFilter>().sharedMesh = _coinMesh;
                var mr = go.AddComponent<MeshRenderer>();
                mr.sharedMaterial = CoinMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                go.SetActive(false);
                _coins.Add(new Coin { T = go.transform });
            }
        }

        Material CreateHologram(Color color, bool icon)
        {
            var shader = Shader.Find("JH/Holographic");
            var material = new Material(shader) { name = icon ? "JH_PowerupIcon" : "JH_PowerupCube" };
            material.SetColor("_HologramColor", color);
            material.SetFloat("_FresnelAmount", 0.70f);
            material.SetFloat("_FresnelOpacity", 1.0f);
            material.SetFloat("_ScanlineSize", 3.70f);
            material.SetFloat("_HologramBrightness", 1.60f);
            material.SetFloat("_SignalSpeed", 0.01f);
            material.SetFloat("_EnableBlinking", 1f);
            material.SetFloat("_BlinkFresnelOnly", 1f);
            material.SetFloat("_HologramOpacity", 0.70f);
            material.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
            material.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            material.SetFloat("_ZWrite", icon ? 0f : 1f);
            material.SetFloat("_ZTest", icon
                ? (float)UnityEngine.Rendering.CompareFunction.Always
                : (float)UnityEngine.Rendering.CompareFunction.LessEqual);
            material.renderQueue = icon ? 3100 : 3000;
            return material;
        }

        static Color PowerupColor(PowerupType type)
        {
            int rgb = PowerupCatalog.Get(type).ColorRgb;
            return TextureFactory.Hex(rgb);
        }

        void BuildPowerupPool()
        {
            if (_powerups.Count > 0) return;
            _octahedronMesh = MeshFactory.Octahedron(1.1f);
            _torusMesh = MeshFactory.PolygonTorus(0.935f, 0.33f, 20, 10);
            _sphereMesh = MeshFactory.Sphere(0.99f, 20, 16);
            _powerupCubeMaterial = CreateHologram(TextureFactory.Hex(0x00d5ff), false);
            for (int type = 1; type <= 4; type++)
                _powerupIconMaterials[(PowerupType)type] = CreateHologram(PowerupColor((PowerupType)type), true);

            var parent = new GameObject("PowerupPool").transform;
            parent.SetParent(transform, false);
            for (int i = 0; i < 10; i++)
            {
                var root = new GameObject("powerup");
                root.layer = 8;
                root.transform.SetParent(parent, false);

                var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Destroy(cube.GetComponent<Collider>());
                cube.name = "HologramCube";
                cube.layer = 8;
                cube.transform.SetParent(root.transform, false);
                cube.transform.localScale = Vector3.one * 3.5f;
                var cubeRenderer = cube.GetComponent<MeshRenderer>();
                cubeRenderer.sharedMaterial = _powerupCubeMaterial;
                cubeRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;

                var icon = new GameObject("PowerupIcon");
                icon.layer = 8;
                icon.transform.SetParent(root.transform, false);
                icon.AddComponent<MeshFilter>();
                var iconRenderer = icon.AddComponent<MeshRenderer>();
                iconRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;

                root.SetActive(false);
                _powerups.Add(new PowerupView { T = root.transform, Icon = icon.transform });
            }
        }

        public void ResetSystem()
        {
            BuildPool();
            BuildPowerupPool();
            BuildCargoPool();
            GameManager.I?.ClearRegisteredPickups();
            foreach (var c in _coins)
            {
                if (!c.Active) continue;
                c.Active = false;
                c.CoreId = 0;
                c.T.gameObject.SetActive(false);
            }
            foreach (var powerup in _powerups)
            {
                powerup.Active = false;
                powerup.CoreId = 0;
                powerup.Type = PowerupType.None;
                powerup.T.gameObject.SetActive(false);
            }
            foreach (var cargo in _cargo)
            {
                cargo.Active = false;
                cargo.CoreId = 0;
                cargo.T.gameObject.SetActive(false);
            }
        }

        public void WipeBonusRings() { /* bonus fuel rings not ported yet — hook kept for parity */ }

        /// <summary>Evenly spaced coin line (slalom gap reward).</summary>
        public void SpawnCoinLine(float centerX, float z, int count, float width)
        {
            for (int i = 0; i < count; i++)
            {
                float t = count == 1 ? 0.5f : i / (float)(count - 1);
                SpawnCoin(centerX + (t - 0.5f) * width, 1.2f, z);
            }
        }

        void SpawnCoin(float x, float y, float z)
        {
            foreach (var c in _coins)
            {
                if (c.Active) continue;
                int coreId = GameManager.I.RegisterPickup(PickupSpawn.Coin(x, y, z, Tuning.CoinScore));
                if (coreId == 0) return;
                c.Active = true;
                c.CoreId = coreId;
                c.Phase = Random.value * Mathf.PI * 2f;
                c.BaseY = y;
                c.T.position = new Vector3(x, y, z);
                c.T.gameObject.SetActive(true);
                return;
            }
        }

        public void SimTick(float dt)
        {
            var s = S;
            var snapshot = GameManager.I.CoreSnapshot;
            _corePickups.Clear();
            if (snapshot != null)
            {
                for (int i = 0; i < snapshot.PickupCount; i++)
                {
                    var pickup = snapshot.GetPickup(i);
                    _corePickups[pickup.Id] = pickup;
                }
                EnsureCorePresenters(snapshot);
            }

            foreach (var c in _coins)
            {
                if (!c.Active) continue;
                if (!_corePickups.TryGetValue(c.CoreId, out var pickup) || pickup.Kind != PickupKind.Coin)
                {
                    c.Active = false;
                    c.CoreId = 0;
                    c.T.gameObject.SetActive(false);
                    continue;
                }
                var p = new Vector3(pickup.X, pickup.Y, pickup.Z);

                // bob + spin (spec/01 §4.5)
                p.y = c.BaseY + Mathf.Sin(s.Elapsed * 2.2f + c.Phase) * 0.12f;
                c.T.position = p;
                c.T.rotation = Quaternion.Euler(0f, (s.Elapsed * 2.8f + c.Phase) * Mathf.Rad2Deg, 0f);
            }

            foreach (var powerup in _powerups)
            {
                if (!powerup.Active) continue;
                if (!_corePickups.TryGetValue(powerup.CoreId, out var pickup) || pickup.Kind != PickupKind.Powerup)
                {
                    if (Mathf.Abs(powerup.LastPosition.z - Tuning.ShipZ) < 4f)
                        PowerupCollectBurst.Spawn(transform, powerup.LastPosition, powerup.Type, powerup.Icon.GetComponent<MeshFilter>().sharedMesh,
                            _powerupIconMaterials[powerup.Type]);
                    powerup.Active = false;
                    powerup.CoreId = 0;
                    powerup.T.gameObject.SetActive(false);
                    continue;
                }

                powerup.LastPosition = new Vector3(pickup.X, pickup.Y, pickup.Z);
                powerup.T.position = powerup.LastPosition;
                powerup.T.rotation = Quaternion.Euler(
                    s.Elapsed * 0.2f * Mathf.Rad2Deg,
                    s.Elapsed * 0.5f * Mathf.Rad2Deg,
                    0f);
                powerup.Icon.localRotation = Quaternion.Euler(0f, s.Elapsed * 1.4f * Mathf.Rad2Deg, 0f);
            }

            foreach (var cargo in _cargo)
            {
                if (!cargo.Active) continue;
                if (!_corePickups.TryGetValue(cargo.CoreId, out var pickup) || pickup.Kind != PickupKind.Cargo)
                {
                    cargo.Active = false;
                    cargo.CoreId = 0;
                    cargo.T.gameObject.SetActive(false);
                    continue;
                }
                cargo.T.position = new Vector3(pickup.X, pickup.Y + Mathf.Sin(s.Elapsed * 2.6f + cargo.CoreId) * .16f, pickup.Z);
                cargo.T.rotation = Quaternion.Euler(12f, (s.Elapsed * 1.8f + cargo.CoreId) * Mathf.Rad2Deg, 28f);
            }
        }

        void EnsureCorePresenters(SimulationSnapshot snapshot)
        {
            for (int i = 0; i < snapshot.PickupCount; i++)
            {
                var pickup = snapshot.GetPickup(i);
                if (pickup.Kind == PickupKind.Coin)
                {
                    bool found = false;
                    foreach (var coin in _coins)
                    {
                        if (coin.Active && coin.CoreId == pickup.Id) { found = true; break; }
                    }
                    if (!found) AcquireCoreCoin(pickup);
                }
                else if (pickup.Kind == PickupKind.Powerup)
                {
                    bool found = false;
                    foreach (var powerup in _powerups)
                    {
                        if (powerup.Active && powerup.CoreId == pickup.Id) { found = true; break; }
                    }
                    if (!found) AcquireCorePowerup(pickup);
                }
                else if (pickup.Kind == PickupKind.Cargo)
                {
                    bool found = false;
                    foreach (var cargo in _cargo)
                        if (cargo.Active && cargo.CoreId == pickup.Id) { found = true; break; }
                    if (!found) AcquireCoreCargo(pickup);
                }
            }
        }

        void AcquireCoreCoin(PickupSnapshot pickup)
        {
            foreach (var coin in _coins)
            {
                if (coin.Active) continue;
                coin.Active = true;
                coin.CoreId = pickup.Id;
                coin.Phase = Random.value * Mathf.PI * 2f;
                coin.BaseY = pickup.Y;
                coin.T.position = new Vector3(pickup.X, pickup.Y, pickup.Z);
                coin.T.gameObject.SetActive(true);
                return;
            }
        }

        void AcquireCorePowerup(PickupSnapshot pickup)
        {
            foreach (var view in _powerups)
            {
                if (view.Active) continue;
                view.Active = true;
                view.CoreId = pickup.Id;
                view.Type = pickup.Powerup;
                view.LastPosition = new Vector3(pickup.X, pickup.Y, pickup.Z);
                view.T.position = view.LastPosition;
                view.T.rotation = Quaternion.identity;

                var filter = view.Icon.GetComponent<MeshFilter>();
                filter.sharedMesh = pickup.Powerup == PowerupType.Laser
                    ? _torusMesh
                    : pickup.Powerup == PowerupType.Magnet
                        ? _sphereMesh
                        : _octahedronMesh;
                view.Icon.GetComponent<MeshRenderer>().sharedMaterial = _powerupIconMaterials[pickup.Powerup];
                view.T.gameObject.SetActive(true);
                return;
            }
        }

        void AcquireCoreCargo(PickupSnapshot pickup)
        {
            foreach (var view in _cargo)
            {
                if (view.Active) continue;
                view.Active = true;
                view.CoreId = pickup.Id;
                view.Kind = pickup.CargoKind;
                for (int i = 0; i < view.Renderers.Length; i++)
                    view.Renderers[i].sharedMaterial = _cargoMaterials[pickup.CargoKind];
                ConfigureCargoPod(view, pickup.CargoKind);
                view.T.position = new Vector3(pickup.X, pickup.Y, pickup.Z);
                view.T.gameObject.SetActive(true);
                return;
            }
        }

        static void ConfigureCargoPod(CargoView view, RunCargoKind kind)
        {
            view.T.localScale = Vector3.one;
            view.Core.localRotation = Quaternion.identity;
            view.LeftRail.gameObject.SetActive(true);
            view.RightRail.gameObject.SetActive(true);
            if (kind == RunCargoKind.Salvage)
            {
                view.Core.localScale = new Vector3(1.35f, .95f, 1.65f);
                view.LeftRail.localScale = view.RightRail.localScale = new Vector3(.16f, 1.05f, 1.9f);
                view.T.localScale = Vector3.one * .82f;
            }
            else if (kind == RunCargoKind.Alloy)
            {
                view.Core.localScale = new Vector3(1.55f, .82f, 2.25f);
                view.LeftRail.localScale = view.RightRail.localScale = new Vector3(.24f, 1.2f, 2.5f);
                view.T.localScale = Vector3.one;
            }
            else
            {
                view.Core.localScale = Vector3.one * 1.6f;
                view.Core.localRotation = Quaternion.Euler(35f, 45f, 35f);
                view.LeftRail.localScale = view.RightRail.localScale = new Vector3(.14f, 1.7f, .14f);
                view.T.localScale = Vector3.one * 1.12f;
            }
            view.T.name = "cargo-pod-" + CargoCatalog.Get(kind).Id;
        }
    }
}
