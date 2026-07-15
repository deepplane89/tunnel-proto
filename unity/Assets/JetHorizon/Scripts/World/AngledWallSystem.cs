using System.Collections.Generic;
using UnityEngine;
using JetHorizon.Simulation;

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
            public int CoreId;
        }

        const int PoolSize = 160;
        readonly List<Wall> _pool = new List<Wall>(PoolSize);
        readonly Dictionary<int, HazardSnapshot> _coreWalls = new Dictionary<int, HazardSnapshot>(PoolSize);

        // structured burst state (grid tuner _awTuner)
        bool _burstActive;
        int _burstRowsDone;
        float _burstSpawnZ;
        int _burstAngleSign = 1;
        const int BurstRows = 20;
        const float BurstZSpacing = 50f;

        static readonly int TintId = Shader.PropertyToID("_Tint");
        static readonly int FadeId = Shader.PropertyToID("_Fade");
        static readonly int EdgeStrengthId = Shader.PropertyToID("_EdgeStrength");

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
            foreach (var w in _pool) if (w.Active) Return(w);
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

            // Core owns movement and OBB collision. Unity only projects snapshots.
            _coreWalls.Clear();
            var snapshot = GameManager.I.CoreSnapshot;
            if (snapshot != null)
            {
                for (int i = 0; i < snapshot.HazardCount; i++)
                {
                    var hazard = snapshot.GetHazard(i);
                    if (hazard.Kind == HazardKind.Wall && hazard.Style != HazardStyle.MonumentWall)
                        _coreWalls[hazard.Id] = hazard;
                }
                EnsureCorePresenters(snapshot);
            }
            foreach (var w in _pool)
            {
                if (!w.Active) continue;
                if (!_coreWalls.TryGetValue(w.CoreId, out var hazard))
                {
                    Return(w, removeFromCore: false);
                    continue;
                }

                var p = new Vector3(hazard.X, hazard.Y, hazard.Z);
                w.T.position = p;

                float fadeT = Mathf.Clamp01((p.z - Tuning.SpawnZ) / (-Tuning.SpawnZ * 0.4f));
                w.Mpb.SetFloat(FadeId, fadeT);
                w.R.SetPropertyBlock(w.Mpb);
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
                    Spawn(x, Tuning.SpawnZ, 22f, 4f, 35f * _burstAngleSign, y, rotX: -36f,
                        style: HazardStyle.StructuredWall);
                }
            _burstAngleSign = -_burstAngleSign;
        }

        void Spawn(
            float x,
            float z,
            float w,
            float h,
            float angleY,
            float y = -1f,
            float rotX = 0f,
            HazardStyle style = HazardStyle.AngledWall)
        {
            foreach (var wall in _pool)
            {
                if (wall.Active) continue;
                float worldY = y < 0f ? h / 2f : y;
                int colorType = Random.Range(0, 3);
                int coreId = GameManager.I.RegisterHazard(HazardSpawn.Wall(
                    x,
                    worldY,
                    z,
                    w,
                    h,
                    0.3f,
                    rotX * Mathf.Deg2Rad,
                    angleY * Mathf.Deg2Rad,
                    0f,
                    style,
                    colorType));
                if (coreId == 0) return;
                wall.Active = true;
                wall.CoreId = coreId;
                wall.T.position = new Vector3(x, worldY, z);
                wall.T.rotation = Quaternion.Euler(rotX, angleY, 0f);
                wall.T.localScale = new Vector3(w, h, 0.3f);
                wall.Mpb.SetColor(TintId, Vibes.ConeColors[colorType]);
                wall.Mpb.SetFloat(FadeId, 0f);
                wall.Mpb.SetFloat(EdgeStrengthId, 0.55f);
                wall.R.SetPropertyBlock(wall.Mpb);
                wall.T.gameObject.SetActive(true);
                return;
            }
        }

        void EnsureCorePresenters(SimulationSnapshot snapshot)
        {
            for (int i = 0; i < snapshot.HazardCount; i++)
            {
                var hazard = snapshot.GetHazard(i);
                if (hazard.Kind != HazardKind.Wall || hazard.Style == HazardStyle.MonumentWall) continue;
                bool found = false;
                foreach (var wall in _pool)
                {
                    if (wall.Active && wall.CoreId == hazard.Id) { found = true; break; }
                }
                if (!found) AcquireCoreWall(hazard);
            }
        }

        void AcquireCoreWall(HazardSnapshot hazard)
        {
            foreach (var wall in _pool)
            {
                if (wall.Active) continue;
                wall.Active = true;
                wall.CoreId = hazard.Id;
                wall.T.position = new Vector3(hazard.X, hazard.Y, hazard.Z);
                wall.T.rotation = SourceEulerXYZ(
                    hazard.RotationXRadians * Mathf.Rad2Deg,
                    hazard.RotationYRadians * Mathf.Rad2Deg,
                    hazard.RotationZRadians * Mathf.Rad2Deg);
                wall.T.localScale = new Vector3(
                    Mathf.Max(0.01f, hazard.VisualScale),
                    Mathf.Max(0.01f, hazard.VisualScaleY),
                    Mathf.Max(0.01f, hazard.VisualScaleZ));
                int colorType = Mathf.Abs(hazard.VisualVariant) % Vibes.ConeColors.Length;
                wall.Mpb.SetColor(TintId, hazard.Style == HazardStyle.StructuredWall
                    ? Vibes.StructuredWallTint
                    : Vibes.ConeColors[colorType]);
                wall.Mpb.SetFloat(FadeId, 0f);
                wall.Mpb.SetFloat(EdgeStrengthId, 0.55f);
                wall.R.SetPropertyBlock(wall.Mpb);
                wall.T.gameObject.SetActive(true);
                return;
            }
        }

        void Return(Wall wall, bool removeFromCore = true)
        {
            if (removeFromCore && wall.CoreId != 0) GameManager.I?.RemoveHazard(wall.CoreId);
            wall.Active = false;
            wall.CoreId = 0;
            wall.T.gameObject.SetActive(false);
        }

        static Quaternion SourceEulerXYZ(float xDegrees, float yDegrees, float zDegrees)
        {
            return Quaternion.AngleAxis(xDegrees, Vector3.right)
                * Quaternion.AngleAxis(yDegrees, Vector3.up)
                * Quaternion.AngleAxis(zDegrees, Vector3.forward);
        }
    }
}
