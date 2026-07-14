using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Slalom: rows of fat-cone door walls every 60 u with a smoothly wandering gap
    /// (spec/02 §1.7). Gap follows a bounded random-walk "physics curve" kept ≥14 u
    /// from the ship's current X at spawn time so the player always has to move.
    /// </summary>
    public sealed class SlalomSystem : MonoBehaviour, ISimSystem
    {
        public ObstacleSpawner Obstacles;
        public PickupSystem Pickups;

        float _gapWidth;
        int _rowsLeft;
        float _spawnZ;          // world-unit accumulator, fire at ≥ 0, reset −60
        float _gapCenter;
        float _gapVel;
        bool _first;

        const float MaxWander = 26f;

        RunSession S => GameManager.I.Session;

        public void ResetSystem() { Abort(); }

        public void Begin(float gapWidth, int rows)
        {
            _gapWidth = gapWidth;
            _rowsLeft = rows;
            _spawnZ = 0f;       // first row immediately
            _first = true;
            S.SlalomActive = true;
        }

        public void Abort()
        {
            _rowsLeft = 0;
            if (GameManager.I != null) S.SlalomActive = false;
        }

        public void SimTick(float dt)
        {
            if (!S.SlalomActive) return;
            if (_rowsLeft <= 0) { S.SlalomActive = false; return; }

            _spawnZ += S.EffectiveSpeed * dt;
            if (_spawnZ < 0f) return;
            _spawnZ = -Tuning.SlalomZSpacing;
            SpawnRow();
            _rowsLeft--;
        }

        void SpawnRow()
        {
            var s = S;
            if (_first)
            {
                _first = false;
                _gapCenter = s.ShipX + (Random.value < 0.5f ? -18f : 18f);   // forces immediate move
                _gapVel = 0f;
            }
            else
            {
                // physics-curve wander: smooth accel toward a drifting target
                _gapVel += (Random.value - 0.5f) * 14f;
                _gapVel *= 0.7f;
                _gapCenter += _gapVel;
                _gapCenter = Mathf.Clamp(_gapCenter, s.ShipX - MaxWander, s.ShipX + MaxWander);
                // push gap ≥ 14 u from ship
                float d = _gapCenter - s.ShipX;
                if (Mathf.Abs(d) < Tuning.SlalomMinGapFromShip)
                    _gapCenter = s.ShipX + Mathf.Sign(d == 0f ? (Random.value - 0.5f) : d) * Tuning.SlalomMinGapFromShip;
            }

            float half = _gapWidth / 2f;
            // fat cones marching outward from the gap edges, 30% random skip
            for (float off = half + 2f; off < 90f; off += Tuning.SlalomConeStep)
            {
                if (Random.value > 0.30f)
                    Obstacles.SpawnCone(_gapCenter + off, Tuning.SpawnZ, Vibes.SlalomTint, 4f, isFat: true, isCorridor: true);
                if (Random.value > 0.30f)
                    Obstacles.SpawnCone(_gapCenter - off, Tuning.SpawnZ, Vibes.SlalomTint, 4f, isFat: true, isCorridor: true);
            }

            // 3 reward coins in the gap
            Pickups.SpawnCoinLine(_gapCenter, Tuning.SpawnZ, 3, _gapWidth * 0.6f);
            s.CorridorGapCenter = _gapCenter;
        }
    }
}
