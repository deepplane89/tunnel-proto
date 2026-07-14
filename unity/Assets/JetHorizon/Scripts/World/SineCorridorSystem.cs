using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// L4 / L5 sine cone-corridors (spec/02 §5): rows every ~7 u, funnel squeeze →
    /// straight → sine sweep with amp/period ramps → exit widen. Exact constants ported.
    /// </summary>
    public sealed class SineCorridorSystem : MonoBehaviour, ISimSystem
    {
        public enum Kind { L4, L5 }

        public ObstacleSpawner Obstacles;

        struct Cfg
        {
            public int CloseRows, StraightRows, TotalRows, ExitRows, CenterConeInterval;
            public float WideX, NarrowX, SqueezeTo, AmpStart, AmpMax, AmpRamp, PeriodStart, PeriodMin, PeriodRamp;
            public Color Tint;
        }

        static readonly Cfg L4Cfg = new Cfg
        {
            CloseRows = 35, StraightRows = 10, TotalRows = 518, ExitRows = 20, CenterConeInterval = 0,
            WideX = 80f, NarrowX = 6f, SqueezeTo = 4.5f,
            AmpStart = 14f, AmpMax = 44f, AmpRamp = 120f,
            PeriodStart = 220f, PeriodMin = 160f, PeriodRamp = 260f,
            Tint = new Color(1f, 0f, 2f/3f)   // 0xff00aa
        };
        static readonly Cfg L5Cfg = new Cfg
        {
            CloseRows = 29, StraightRows = 12, TotalRows = 420, ExitRows = 20, CenterConeInterval = 12,
            WideX = 64f, NarrowX = 10f, SqueezeTo = 8f,
            AmpStart = 10f, AmpMax = 40f, AmpRamp = 180f,
            PeriodStart = 200f, PeriodMin = 140f, PeriodRamp = 280f,
            Tint = new Color(1f, 0.8f, 0f)    // 0xffcc00
        };

        Cfg _cfg;
        Kind _kind;
        int _rowsDone;
        float _spawnZ;
        float _sineT;
        float _anchor;

        RunSession S => GameManager.I.Session;

        public void ResetSystem()
        {
            _rowsDone = 0;
            if (GameManager.I != null) S.SineCorridorActive = false;
        }

        public void Begin(Kind kind)
        {
            _kind = kind;
            _cfg = kind == Kind.L4 ? L4Cfg : L5Cfg;
            _rowsDone = 0; _sineT = 0f;
            _spawnZ = 0f;
            _anchor = S.ShipX;
            S.SineCorridorActive = true;
            S.CorridorGapCenter = _anchor;
        }

        public void SimTick(float dt)
        {
            var s = S;
            if (!s.SineCorridorActive) return;
            if (_rowsDone >= _cfg.TotalRows) { s.SineCorridorActive = false; return; }

            _spawnZ += s.EffectiveSpeed * dt;
            while (_spawnZ >= 0f && _rowsDone < _cfg.TotalRows)
            {
                _spawnZ = -7f + (Random.value - 0.5f) * 2f;   // row every ~7 u
                SpawnRow();
                _rowsDone++;
            }
        }

        void SpawnRow()
        {
            var s = S;
            var c = _cfg;
            static float Ease(float t) => t < 0.5f ? 2f * t * t : -1f + (4f - 2f * t) * t;

            // half-width
            float halfX;
            int curveRows = Mathf.Max(0, _rowsDone - (c.CloseRows + c.StraightRows));
            if (_rowsDone < c.CloseRows)
                halfX = c.WideX + (c.NarrowX - c.WideX) * Ease(_rowsDone / (float)c.CloseRows);
            else
            {
                float squeezeT = Mathf.Min(1f, curveRows / 120f);
                halfX = c.NarrowX - (c.NarrowX - c.SqueezeTo) * squeezeT * squeezeT;
                if (_kind == Kind.L4 && curveRows >= 370 && curveRows < 395)
                {
                    float knifeT = (curveRows - 370) / 25f;
                    float spike = 1f - Mathf.Abs(knifeT * 2f - 1f);
                    halfX -= (halfX - 3f) * spike;             // dips to 3 at spike peak
                }
            }
            bool inExit = _rowsDone >= c.TotalRows - c.ExitRows;
            if (inExit)
                halfX += (c.WideX - halfX) * Mathf.Min(1f, (_rowsDone - (c.TotalRows - c.ExitRows)) / (float)c.ExitRows);

            // centerline
            float center = _anchor;
            if (_rowsDone >= c.CloseRows + c.StraightRows)
            {
                float ampT = Mathf.Min(1f, curveRows / c.AmpRamp);
                float amp = c.AmpStart + (c.AmpMax - c.AmpStart) * ampT * ampT;
                float perT = Mathf.Min(1f, curveRows / c.PeriodRamp);
                float period = c.PeriodStart - (c.PeriodStart - c.PeriodMin) * perT * perT;
                _sineT += 2f * Mathf.PI / period;
                center = _anchor + amp * Mathf.Sin(_sineT);
            }
            s.CorridorGapCenter = center;

            // cones: inner ± halfX, outer ± (halfX + laneWidth), jitter ±0.3
            float J() => (Random.value - 0.5f) * 0.6f;
            Obstacles.SpawnCone(center + halfX + J(), Tuning.SpawnZ, c.Tint, isCorridor: true);
            Obstacles.SpawnCone(center - halfX + J(), Tuning.SpawnZ, c.Tint, isCorridor: true);
            Obstacles.SpawnCone(center + halfX + Tuning.LaneWidth + J(), Tuning.SpawnZ, c.Tint, isCorridor: true);
            Obstacles.SpawnCone(center - halfX - Tuning.LaneWidth + J(), Tuning.SpawnZ, c.Tint, isCorridor: true);

            // L5 center hazard cone every 12 rows once the sine has started
            if (c.CenterConeInterval > 0 && curveRows > 0 && !inExit && _rowsDone % c.CenterConeInterval == 0)
                Obstacles.SpawnCone(center + J(), Tuning.SpawnZ, c.Tint, isCorridor: true);
        }
    }
}
