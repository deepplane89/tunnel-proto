using System.Collections.Generic;
using UnityEngine;

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
            public Transform T; public bool Active; public float Phase; public float BaseY;
        }

        const int PoolSize = 100;
        readonly List<Coin> _coins = new List<Coin>(PoolSize);
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
            foreach (var c in _coins) if (c.Active) { c.Active = false; c.T.gameObject.SetActive(false); }
        }

        public void WipeBonusRings() { /* bonus fuel rings not ported yet — hook kept for parity */ }

        /// <summary>Coin event roll (DR rates). Returns true if coins were spawned.</summary>
        public bool TrySpawnCoinEvent(float centerX)
        {
            float roll = Random.value;
            if (roll < 0.45f)
            {
                SpawnCoin(centerX + Random.Range(-8, 9) * Tuning.LaneWidth * 0.5f, 1.2f, Tuning.SpawnZ);
                return true;
            }
            if (roll < 0.80f)
            {
                // curved chain: 10-15 coins, sine arc in X and Y
                int count = 10 + Random.Range(0, 6);
                float zSpan = 28f + Random.value * 16f;
                float baseX = centerX + (Random.value < 0.5f ? -4f : 4f);
                float xSwing = Random.value < 0.5f ? -5f : 5f;
                for (int i = 0; i < count; i++)
                {
                    float frac = i / (float)(count - 1);
                    SpawnCoin(baseX + Mathf.Sin(frac * Mathf.PI) * xSwing,
                              1.2f + Mathf.Sin(frac * Mathf.PI) * 0.7f,
                              Tuning.SpawnZ - frac * zSpan);
                }
                return true;
            }
            // straight chain: 8-12 coins, one lane
            int n = 8 + Random.Range(0, 5);
            float zs = 20f + Random.value * 12f;
            float x = centerX + Random.Range(-8, 9) * Tuning.LaneWidth * 0.5f;
            for (int i = 0; i < n; i++)
                SpawnCoin(x, 1.2f, Tuning.SpawnZ - i / (float)(n - 1) * zs);
            return true;
        }

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
                c.Active = true;
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
            float eff = s.EffectiveSpeed;

            foreach (var c in _coins)
            {
                if (!c.Active) continue;
                var p = c.T.position;
                p.z += eff * dt;

                // bob + spin (spec/01 §4.5)
                p.y = c.BaseY + Mathf.Sin(s.Elapsed * 2.2f + c.Phase) * 0.12f;
                c.T.position = p;
                c.T.rotation = Quaternion.Euler(0f, (s.Elapsed * 2.8f + c.Phase) * Mathf.Rad2Deg, 0f);

                if (p.z > Tuning.DespawnZ) { c.Active = false; c.T.gameObject.SetActive(false); continue; }

                float dx = Mathf.Abs(p.x - s.ShipX);
                float dz = Mathf.Abs(p.z - Tuning.ShipZ);
                if (dx < 1.6f && dz < 1.6f)
                {
                    c.Active = false; c.T.gameObject.SetActive(false);
                    s.PlayerScore += Tuning.CoinScore;
                    GameEvents.RaiseCoinCollected();
                }
            }
        }
    }
}
