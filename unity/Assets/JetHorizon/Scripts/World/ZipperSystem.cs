using UnityEngine;

namespace JetHorizon
{
    /// <summary>Zipper gates: alternating cone walls with a side-flipping gap (spec/02 §1.6).</summary>
    public sealed class ZipperSystem : MonoBehaviour, ISimSystem
    {
        public ObstacleSpawner Obstacles;

        int _rowsLeft;
        int _rowsTotal;
        int _side = 1;
        float _timer;

        RunSession S => GameManager.I.Session;

        public void ResetSystem() { Abort(); }

        public void Begin(int rows)
        {
            _rowsTotal = rows; _rowsLeft = rows;
            _side = Random.value < 0.5f ? -1 : 1;
            _timer = -1.0f;                    // 1 s grace before first row
            S.ZipperActive = true;
        }

        public void Abort()
        {
            _rowsLeft = 0;
            if (GameManager.I != null) S.ZipperActive = false;
        }

        public void SimTick(float dt)
        {
            if (!S.ZipperActive) return;
            if (_rowsLeft <= 0) { S.ZipperActive = false; return; }

            _timer += dt;
            int rowsDone = _rowsTotal - _rowsLeft;
            float ramp = Mathf.Min(rowsDone / (float)Mathf.Max(1, _rowsTotal - 1), 1f);
            float interval = 1.5f - ramp * 0.65f;         // 1.5 s → 0.85 s
            if (_timer < interval) return;
            _timer = 0f;
            SpawnRow(rowsDone);
            _rowsLeft--;
        }

        void SpawnRow(int rowsDone)
        {
            var s = S;
            float gapCX = s.ShipX + _side * Tuning.ZipperOffset;
            float gapHalf = rowsDone >= Tuning.ZipperRows - 2 ? Tuning.ZipperGapHalf * 1.9f : Tuning.ZipperGapHalf;

            // fill 8-lane-wide span (21 * 8 = 168 u) centered on shipX
            float span = Tuning.LaneCount * 8f;
            for (float x = s.ShipX - span / 2f; x <= s.ShipX + span / 2f; x += Tuning.LaneWidth)
            {
                if (Mathf.Abs(x - gapCX) <= gapHalf) continue;
                Obstacles.SpawnCone(x + (Random.value - 0.5f) * 0.5f, Tuning.SpawnZ, Vibes.ZipperTint, isCorridor: true);
            }
            _side = -_side;
        }
    }
}
