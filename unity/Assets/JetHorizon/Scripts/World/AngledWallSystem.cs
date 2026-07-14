using System.Collections.Generic;
using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Neon angled wall panels (spec/02 §1.3): random rows (spawner mode 'angled')
    /// and structured grid bursts (S5). Rotated-OBB collision, ship = 0.3 u cube.
    /// </summary>
    public sealed class AngledWallSystem : MonoBehaviour, ISimSystem
    {
        public Material WallMaterial;   // JH/NeonCone works fine (tint + fade)

        sealed class Wall
        {
            public Transform T; public MeshRenderer R; public MaterialPropertyBlock Mpb; public bool Active;
        }

        const int PoolSize = 160;
        readonly List<Wall> _pool = new List<Wall>(PoolSize);

        // structured burst state (grid tuner _awTuner)
        bool _burstActive;
        int _burstRowsDone;
        float _burstSpawnZ;
        int _burstAngleSign = 1;
        const int BurstRows = 20;
        const float BurstZSpacing = 50f;

        static readonly int TintId = Shader.PropertyToID("_Tint");
        static readonly int FadeId = Shader.PropertyToID("_Fade");

        RunSession S => GameManager.I.Session;

        void Awake() => BuildPool();

        void BuildPool()
        {
            if (_pool.Count > 0) return;
            var parent = new GameObject("WallPool").transform;
            parent.SetParent(transform, false);
            for (int i = 0; i < PoolSize; i++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Destroy(go.GetComponent<Collider>());
                go.name = "wall";
                go.transform.SetParent(parent, false);
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = WallMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                go.SetActive(false);
                _pool.Add(new Wall { T = go.transform, R = mr, Mpb = new MaterialPropertyBlock() });
            }
        }

        public void ResetSystem() { BuildPool(); Abort(); WipeAll(); }

        public void Abort()
        {
            _burstActive = false;
            if (GameManager.I != null) S.AngledWallsActive = false;
        }

        public void WipeAll()
        {
            foreach (var w in _pool) if (w.Active) { w.Active = false; w.T.gameObject.SetActive(false); }
        }

        public int ActiveCount
        {
            get { int n = 0; foreach (var w in _pool) if (w.Active) n++; return n; }
        }

        /// <summary>Random walls row — 6-8 panels 8×4 at 25-45°, min 4-lane separation.</summary>
        public void SpawnRandomRow(float centerX, int count)
        {
            var usedLanes = new List<int>();
            int tries = 0;
            while (usedLanes.Count < count && tries++ < 60)
            {
                int lane = Random.Range(0, Tuning.LaneCount);
                bool clash = false;
                foreach (int u in usedLanes) if (Mathf.Abs(u - lane) < 4) { clash = true; break; }
                if (clash) continue;
                usedLanes.Add(lane);
                float x = centerX + (lane - 10) * Tuning.LaneWidth;
                float angle = Random.Range(25f, 45f) * (Random.value < 0.5f ? -1f : 1f);
                Spawn(x, Tuning.SpawnZ + (Random.value - 0.5f) * 8f, 8f, 4f, angle);
            }
        }

        public void SpawnSingleRandomWall(float x, float z)
        {
            float angle = Random.Range(25f, 45f) * (Random.value < 0.5f ? -1f : 1f);
            Spawn(x, z, 8f, 4f, angle);
        }

        /// <summary>Structured grid burst — 20 rows of 22×4 panels, alternating lean (spec/02 §1.3b).</summary>
        public void StartStructuredBurst()
        {
            _burstActive = true;
            _burstRowsDone = 0;
            _burstSpawnZ = 0f;
            _burstAngleSign = 1;
            S.AngledWallsActive = true;
        }

        public void SimTick(float dt)
        {
            var s = S;
            float eff = s.EffectiveSpeed;

            // burst row cadence
            if (_burstActive)
            {
                _burstSpawnZ += eff * dt;
                if (_burstSpawnZ >= 0f)
                {
                    _burstSpawnZ = -BurstZSpacing;
                    SpawnBurstRow();
                    if (++_burstRowsDone >= BurstRows) _burstActive = false;
                }
            }
            if (!_burstActive && s.AngledWallsActive && ActiveCount == 0)
                s.AngledWallsActive = false;

            // movement + fade + OBB collision
            float shipX = s.ShipX, shipY = s.ShipY;
            bool invulnerable = s.InvincibleTimer > 0f || s.IntroActive;
            foreach (var w in _pool)
            {
                if (!w.Active) continue;
                var p = w.T.position;
                p.z += eff * dt;
                w.T.position = p;

                float fadeT = Mathf.Clamp01((p.z - Tuning.SpawnZ) / (-Tuning.SpawnZ * 0.4f));
                w.Mpb.SetFloat(FadeId, fadeT);
                w.R.SetPropertyBlock(w.Mpb);

                if (p.z > Tuning.DespawnZ) { w.Active = false; w.T.gameObject.SetActive(false); continue; }
                if (invulnerable) continue;

                // rotated-OBB vs ship 0.3-cube (spec/01 §4.3)
                if (Mathf.Abs(p.z - Tuning.ShipZ) < 6f)
                {
                    Vector3 delta = new Vector3(shipX, shipY, Tuning.ShipZ) - p;
                    Vector3 local = Quaternion.Inverse(w.T.rotation) * delta;
                    Vector3 half = w.T.localScale * 0.5f;
                    const float shipHalf = 0.3f;
                    if (Mathf.Abs(local.x) < half.x + shipHalf &&
                        Mathf.Abs(local.y) < half.y + shipHalf &&
                        Mathf.Abs(local.z) < half.z + shipHalf)
                    {
                        GameManager.I.KillPlayer();
                        return;
                    }
                }
            }
        }

        void SpawnBurstRow()
        {
            var s = S;
            // grid tuner: wallW 22, wallH 4, angle 35°, xOffset 12, copiesX 6 @ 42, copiesY 2 @ 6, fieldShift −9.5
            float baseX = s.ShipX + _burstAngleSign * 12f - 9.5f;
            for (int cx = 0; cx < 6; cx++)
                for (int cy = 0; cy < 2; cy++)
                {
                    float x = baseX + (cx - 2.5f) * 42f;
                    float y = 2f + cy * 6f;
                    Spawn(x, Tuning.SpawnZ, 22f, 4f, 35f * _burstAngleSign, y, rotX: -36f);
                }
            _burstAngleSign = -_burstAngleSign;
        }

        void Spawn(float x, float z, float w, float h, float angleY, float y = -1f, float rotX = 0f)
        {
            foreach (var wall in _pool)
            {
                if (wall.Active) continue;
                wall.Active = true;
                wall.T.position = new Vector3(x, y < 0f ? h / 2f : y, z);
                wall.T.rotation = Quaternion.Euler(rotX, angleY, 0f);
                wall.T.localScale = new Vector3(w, h, 0.3f);
                wall.Mpb.SetColor(TintId, Vibes.ConeColors[Random.Range(0, 3)]);
                wall.Mpb.SetFloat(FadeId, 0f);
                wall.R.SetPropertyBlock(wall.Mpb);
                wall.T.gameObject.SetActive(true);
                return;
            }
        }
    }
}
