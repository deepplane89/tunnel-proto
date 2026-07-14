using System.Collections.Generic;
using UnityEngine;
using JetHorizon.Simulation;

namespace JetHorizon
{
    /// <summary>
    /// Pooled cone + lethal-ring hazards: the random wave spawner (spec/02 §2),
    /// shared cone pool used by every corridor system, movement, fade-in,
    /// collision and near-miss. Everything is math collision — no PhysX.
    /// </summary>
    public sealed class ObstacleSpawner : MonoBehaviour, ISimSystem
    {
        public WaveDirector Waves;
        public ShipController Ship;
        public AngledWallSystem AngledWalls;
        public PickupSystem Pickups;
        public Material ConeMaterial;   // JH/NeonCone (set by bootstrap)
        public Material RingMaterial;

        public sealed class ConeObs
        {
            public Transform T;
            public MeshRenderer R;
            public MaterialPropertyBlock Mpb;
            public bool Active;
            public bool IsFatCone, SlalomScaled, IsCorridor;
            public int ColorType;
            public int CoreId;
        }

        sealed class RingObs
        {
            public Transform T; public MeshRenderer R; public MaterialPropertyBlock Mpb; public bool Active; public int CoreId;
        }

        // Lethal ring constants (spec/02 §1.4)
        const int RingPoolSize = 20;
        const float RingR = 5.25f, RingTube = 2.2f, RingY = 2f;
        const int RingSides = 8;

        readonly List<ConeObs> _cones = new List<ConeObs>(Tuning.ObstaclePoolSize);
        readonly List<RingObs> _rings = new List<RingObs>(RingPoolSize);
        readonly Dictionary<int, HazardSnapshot> _coreHazards = new Dictionary<int, HazardSnapshot>(Tuning.ObstaclePoolSize + RingPoolSize);
        Mesh _coneMesh, _ringMesh;
        int _wavesSinceCoin;

        RunSession S => GameManager.I.Session;

        static readonly int TintId = Shader.PropertyToID("_Tint");
        static readonly int FadeId = Shader.PropertyToID("_Fade");

        void Awake() => BuildPools();

        void BuildPools()
        {
            if (_cones.Count > 0) return;
            _coneMesh = MeshFactory.Cone(1.6f, 10.5f, 6);   // avg h ≈ 8+1.5 + 2 sink... scaled per-spawn
            _ringMesh = MeshFactory.PolygonTorus(RingR, RingTube, RingSides);

            var parent = new GameObject("ConePool").transform;
            parent.SetParent(transform, false);
            for (int i = 0; i < Tuning.ObstaclePoolSize; i++)
            {
                var go = new GameObject("cone");
                go.transform.SetParent(parent, false);
                var mf = go.AddComponent<MeshFilter>(); mf.sharedMesh = _coneMesh;
                var mr = go.AddComponent<MeshRenderer>(); mr.sharedMaterial = ConeMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                go.SetActive(false);
                _cones.Add(new ConeObs { T = go.transform, R = mr, Mpb = new MaterialPropertyBlock() });
            }
            var rparent = new GameObject("RingPool").transform;
            rparent.SetParent(transform, false);
            for (int i = 0; i < RingPoolSize; i++)
            {
                var go = new GameObject("ring");
                go.transform.SetParent(rparent, false);
                var mf = go.AddComponent<MeshFilter>(); mf.sharedMesh = _ringMesh;
                var mr = go.AddComponent<MeshRenderer>(); mr.sharedMaterial = RingMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                go.SetActive(false);
                _rings.Add(new RingObs { T = go.transform, R = mr, Mpb = new MaterialPropertyBlock() });
            }
        }

        public void ResetSystem()
        {
            BuildPools();
            WipeAllHazards();
            _wavesSinceCoin = 99;
        }

        public void WipeAllHazards()
        {
            GameManager.I?.ClearRegisteredHazards();
            foreach (var c in _cones) if (c.Active) Return(c, removeFromCore: false);
            foreach (var r in _rings)
            {
                if (!r.Active) continue;
                r.Active = false;
                r.CoreId = 0;
                r.T.gameObject.SetActive(false);
            }
        }

        public int ActiveHazardCount
        {
            get
            {
                int n = 0;
                foreach (var c in _cones) if (c.Active) n++;
                foreach (var r in _rings) if (r.Active) n++;
                return n + (AngledWalls != null ? AngledWalls.ActiveCount : 0);
            }
        }

        // ── Public cone spawn (used by zipper/slalom/corridors too) ──────────
        public ConeObs SpawnCone(float x, float z, Color? tint = null, float scaleXZ = 1f,
                                 bool isFat = false, bool isCorridor = false)
        {
            foreach (var c in _cones)
            {
                if (c.Active) continue;
                float h = 8f + Random.value * 3f, sink = 2f, totalH = h + sink;
                float collisionWidth = Mathf.Max(0f, scaleXZ - 1f) * (isFat ? 0.9f : 1.2f);
                int coreId = GameManager.I.RegisterHazard(new HazardSpawn
                {
                    Kind = HazardKind.Cone,
                    X = x,
                    Y = -sink,
                    Z = z,
                    CollisionHalfWidth = collisionWidth,
                    CollisionHalfDepth = Tuning.ColDistZ + Mathf.Max(0f, scaleXZ - 1f) * 0.4f,
                    VisualScale = scaleXZ,
                    NearMissEnabled = true
                });
                if (coreId == 0) return null;

                c.Active = true;
                c.CoreId = coreId;
                c.IsFatCone = isFat; c.SlalomScaled = scaleXZ != 1f; c.IsCorridor = isCorridor;
                c.ColorType = Random.Range(0, 3);
                c.T.position = new Vector3(x, -sink, z);
                c.T.localScale = new Vector3(scaleXZ, totalH / 10.5f, scaleXZ);
                Color col = tint ?? Vibes.ConeColors[c.ColorType];
                c.Mpb.SetColor(TintId, col);
                c.Mpb.SetFloat(FadeId, 0f);
                c.R.SetPropertyBlock(c.Mpb);
                c.T.gameObject.SetActive(true);
                return c;
            }
            return null; // pool exhausted
        }

        void Return(ConeObs c, bool removeFromCore = true)
        {
            if (removeFromCore && c.CoreId != 0) GameManager.I?.RemoveHazard(c.CoreId);
            c.Active = false;
            c.CoreId = 0;
            c.T.localScale = Vector3.one;
            c.IsFatCone = c.SlalomScaled = c.IsCorridor = false;
            c.T.gameObject.SetActive(false);
        }

        // ── Random wave spawner (spec/02 §2) ─────────────────────────────────
        public float CurrentSpawnZBase()
        {
            return Waves.SpawnMode switch
            {
                SpawnMode.FatCones => -28f,
                _ => Waves.ConeDensity == "ramp" ? -32f + 6f * Waves.StageRampT01 : -30f,
            };
        }

        public void SpawnWave()
        {
            var s = S;
            var mode = Waves.SpawnMode;

            // lane setup — predicted ship X
            float predicted = s.ShipX + s.ShipVelX * (Mathf.Abs(Tuning.SpawnZ) / Mathf.Max(1f, s.Speed)) * 0.85f;
            predicted = Mathf.Clamp(predicted, s.ShipX - 8f, s.ShipX + 8f);

            int count;
            int minLaneGap = 3;
            float spreadMul = 1f;
            switch (mode)
            {
                case SpawnMode.Lethal: count = Random.Range(3, 5); minLaneGap = 4; break;
                case SpawnMode.Angled:
                    AngledWalls.SpawnRandomRow(predicted, Random.Range(6, 9));
                    MaybeCoins(predicted);
                    return;
                case SpawnMode.FatCones: count = Random.Range(4, 6); minLaneGap = 5; spreadMul = 1.35f; break;
                case SpawnMode.EndlessMix: count = Random.Range(3, 5); minLaneGap = 4; break;
                default:
                    if (Waves.ConeDensity == "ramp") count = Random.Range(4, 6);
                    else count = 7 + Mathf.FloorToInt(s.PhysTier * 0.5f) + (Random.value < 0.5f ? 1 : 0);
                    break;
            }

            // Fisher-Yates lanes, reserve a guaranteed 2-lane gap
            var lanes = new List<int>(Tuning.LaneCount);
            for (int i = 0; i < Tuning.LaneCount; i++) lanes.Add(i);
            for (int i = lanes.Count - 1; i > 0; i--)
            {
                int j = Random.Range(0, i + 1);
                (lanes[i], lanes[j]) = (lanes[j], lanes[i]);
            }
            int gapLane = Random.Range(0, Tuning.LaneCount - 1);
            var used = new List<int>();

            int spawned = 0;
            foreach (int lane in lanes)
            {
                if (spawned >= count) break;
                if (lane == gapLane || lane == gapLane + 1) continue;
                bool tooClose = false;
                foreach (int u in used) if (Mathf.Abs(u - lane) < minLaneGap) { tooClose = true; break; }
                if (tooClose) continue;
                used.Add(lane);

                float x = predicted + (lane - 10) * Tuning.LaneWidth * spreadMul + (Random.value - 0.5f) * 0.6f;
                float z = Tuning.SpawnZ + (Random.value - 0.5f) * 8f;

                switch (mode)
                {
                    case SpawnMode.Lethal:
                        SpawnRing(x, z);
                        break;
                    case SpawnMode.FatCones:
                        SpawnCone(x, z, null, 4f, isFat: true);
                        break;
                    case SpawnMode.EndlessMix:
                        float roll = Random.value;
                        if (roll < 0.25f) SpawnRing(x, z);
                        else if (roll < 0.5f) AngledWalls.SpawnSingleRandomWall(x, z);
                        else
                        {
                            bool fat = Random.value < 0.5f;
                            SpawnCone(x, z, null, fat ? 4f : 1f, isFat: fat);
                        }
                        break;
                    default:
                        SpawnCone(x, z);
                        break;
                }
                spawned++;
            }

            MaybeCoins(predicted);
        }

        void MaybeCoins(float centerX)
        {
            _wavesSinceCoin++;
            if (_wavesSinceCoin <= 1) return;
            if (Pickups.TrySpawnCoinEvent(centerX)) _wavesSinceCoin = 0;
        }

        void SpawnRing(float x, float z)
        {
            foreach (var r in _rings)
            {
                if (r.Active) continue;
                int coreId = GameManager.I.RegisterHazard(HazardSpawn.Ring(x, RingY, z, RingR, RingTube));
                if (coreId == 0) return;
                r.Active = true;
                r.CoreId = coreId;
                r.T.position = new Vector3(x, RingY, z);
                r.Mpb.SetColor(TintId, Vibes.RingRed);
                r.Mpb.SetFloat(FadeId, 0f);
                r.R.SetPropertyBlock(r.Mpb);
                r.T.gameObject.SetActive(true);
                return;
            }
        }

        // ── Tick: project core snapshots onto pooled render objects ───────────
        public void SimTick(float dt)
        {
            var snapshot = GameManager.I.CoreSnapshot;
            _coreHazards.Clear();
            if (snapshot != null)
            {
                for (int i = 0; i < snapshot.HazardCount; i++)
                {
                    var hazard = snapshot.GetHazard(i);
                    _coreHazards[hazard.Id] = hazard;
                }
            }

            foreach (var c in _cones)
            {
                if (!c.Active) continue;
                if (!_coreHazards.TryGetValue(c.CoreId, out var hazard) || hazard.Kind != HazardKind.Cone)
                {
                    Return(c, removeFromCore: false);
                    continue;
                }
                var p = new Vector3(hazard.X, hazard.Y, hazard.Z);
                c.T.position = p;

                // fade-in −160 → −110
                float fade = Mathf.Clamp01((p.z - Tuning.SpawnZ) / (Tuning.FadeInEndZ - Tuning.SpawnZ));
                c.Mpb.SetFloat(FadeId, fade * Vibes.ConeOpacity[c.ColorType]);
                c.R.SetPropertyBlock(c.Mpb);
            }

            foreach (var r in _rings)
            {
                if (!r.Active) continue;
                if (!_coreHazards.TryGetValue(r.CoreId, out var hazard) || hazard.Kind != HazardKind.Ring)
                {
                    r.Active = false;
                    r.CoreId = 0;
                    r.T.gameObject.SetActive(false);
                    continue;
                }
                var p = new Vector3(hazard.X, hazard.Y, hazard.Z);
                r.T.position = p;
                float fade = Mathf.Clamp01((p.z - Tuning.SpawnZ) / (Tuning.FadeInEndZ - Tuning.SpawnZ));
                r.Mpb.SetFloat(FadeId, fade * 0.92f);
                r.R.SetPropertyBlock(r.Mpb);
            }
        }
    }
}
