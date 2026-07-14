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

        const int PoolSize = 100;
        readonly List<Coin> _coins = new List<Coin>(PoolSize);
        readonly Dictionary<int, PickupSnapshot> _corePickups = new Dictionary<int, PickupSnapshot>(PoolSize);
        Mesh _coinMesh;

        RunSession S => GameManager.I.Session;

        void Awake() => BuildPool();

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

        public void ResetSystem()
        {
            BuildPool();
            GameManager.I?.ClearRegisteredPickups();
            foreach (var c in _coins)
            {
                if (!c.Active) continue;
                c.Active = false;
                c.CoreId = 0;
                c.T.gameObject.SetActive(false);
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
        }

        void EnsureCorePresenters(SimulationSnapshot snapshot)
        {
            for (int i = 0; i < snapshot.PickupCount; i++)
            {
                var pickup = snapshot.GetPickup(i);
                if (pickup.Kind != PickupKind.Coin) continue;
                bool found = false;
                foreach (var coin in _coins)
                {
                    if (coin.Active && coin.CoreId == pickup.Id) { found = true; break; }
                }
                if (!found) AcquireCoreCoin(pickup);
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
    }
}
