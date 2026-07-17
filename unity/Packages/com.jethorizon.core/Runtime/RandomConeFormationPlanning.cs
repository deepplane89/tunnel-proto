using System;
using System.Collections.Generic;

namespace JetHorizon.Simulation
{
    /// <summary>
    /// One preplanned row from the production random-cone generator. The row keeps
    /// the source's 21-lane shuffle, four-to-five blockers, adjacent free opening,
    /// three-lane anti-bunch rule and distance cadence while replacing cones with
    /// finite crystalline formation features.
    /// </summary>
    public sealed class RandomConeFormationRow
    {
        readonly int[] _blockedLanes;

        public float Distance { get; }
        public int SafeGapStartLane { get; }
        public int ValuableGapStartLane { get; }
        public float SafeCenterX { get; }
        public float ValuableCenterX { get; }
        public int BlockedCount => _blockedLanes.Length;

        internal RandomConeFormationRow(
            float distance,
            int safeGapStartLane,
            int valuableGapStartLane,
            float safeCenterX,
            float valuableCenterX,
            int[] blockedLanes)
        {
            Distance = distance;
            SafeGapStartLane = safeGapStartLane;
            ValuableGapStartLane = valuableGapStartLane;
            SafeCenterX = safeCenterX;
            ValuableCenterX = valuableCenterX;
            _blockedLanes = (int[])blockedLanes.Clone();
        }

        public int GetBlockedLane(int index) => index >= 0 && index < _blockedLanes.Length
            ? _blockedLanes[index]
            : throw new ArgumentOutOfRangeException(nameof(index));
    }

    public sealed class RandomConeFormationPlan
    {
        readonly RandomConeFormationRow[] _rows;
        readonly TerrainWorldFeature[] _features;
        readonly WorldParcelRoutePlan[] _routes;

        public float Length { get; }
        public float RevealDistance { get; }
        public float ApproachDistance { get; }
        public int RowCount => _rows.Length;
        public int FeatureCount => _features.Length;
        public int RouteCount => _routes.Length;

        internal RandomConeFormationPlan(
            float length,
            float revealDistance,
            float approachDistance,
            RandomConeFormationRow[] rows,
            TerrainWorldFeature[] features,
            WorldParcelRoutePlan[] routes)
        {
            Length = length;
            RevealDistance = revealDistance;
            ApproachDistance = approachDistance;
            _rows = (RandomConeFormationRow[])rows.Clone();
            _features = (TerrainWorldFeature[])features.Clone();
            _routes = (WorldParcelRoutePlan[])routes.Clone();
        }

        public RandomConeFormationRow GetRow(int index) => index >= 0 && index < _rows.Length
            ? _rows[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public TerrainWorldFeature GetFeature(int index) => index >= 0 && index < _features.Length
            ? _features[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public WorldParcelRoutePlan GetRoute(int index) => index >= 0 && index < _routes.Length
            ? _routes[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        internal TerrainWorldFeature[] CopyFeatures() => (TerrainWorldFeature[])_features.Clone();
        internal WorldParcelRoutePlan[] CopyRoutes() => (WorldParcelRoutePlan[])_routes.Clone();
    }

    /// <summary>
    /// Deterministic engine-neutral port of the old random-cone row algorithm.
    /// World spacing intentionally remains 26-32 units plus source jitter: unlike
    /// time-normalized spacing, higher forward speed therefore looks and feels faster.
    /// </summary>
    public sealed class RandomConeFormationPlanner
    {
        public const int LaneCount = 21;
        public const float LaneWidth = 3.2f;
        public const int MinimumLaneGap = 3;
        public const int MinimumBlockersPerRow = 4;
        public const int MaximumBlockersPerRow = 5;
        public const int AuthoredRowCount = 7;
        public const float SourceSpawnDistance = 160f;

        const float InitialLeadDistance = 22f;
        const float ExitClearDistance = 48f;
        static readonly TerrainWorldFeatureKind[] Silhouettes =
        {
            TerrainWorldFeatureKind.WaterlineSpire,
            TerrainWorldFeatureKind.WaterlineSplitPair,
            TerrainWorldFeatureKind.WaterlineRidge,
            TerrainWorldFeatureKind.WaterlineSteppedChain,
            TerrainWorldFeatureKind.WaterlineAsymmetricGroup,
            TerrainWorldFeatureKind.WaterlineCluster
        };

        public RandomConeFormationPlan Create(
            float startDistance,
            float worldStartDistance,
            float forwardSpeed,
            ShipCapabilityProfile capability,
            int seed,
            int variant)
        {
            if (startDistance < worldStartDistance) throw new ArgumentOutOfRangeException(nameof(startDistance));
            if (forwardSpeed <= 0f) throw new ArgumentOutOfRangeException(nameof(forwardSpeed));

            var random = new DeterministicRandom(unchecked((uint)seed));
            var rows = new RandomConeFormationRow[AuthoredRowCount];
            var features = new List<TerrainWorldFeature>(AuthoredRowCount * MaximumBlockersPerRow);
            var safePoints = new CargoWaveRoutePoint[AuthoredRowCount];
            var valuablePoints = new CargoWaveRoutePoint[AuthoredRowCount];
            var laneScratch = new int[LaneCount];
            float localStart = startDistance - worldStartDistance;
            float rowDistance = localStart + InitialLeadDistance;
            int safeGapStart = 9 + ((variant & 1) == 0 ? 0 : 1);

            for (int rowIndex = 0; rowIndex < AuthoredRowCount; rowIndex++)
            {
                if (rowIndex > 0)
                {
                    float ramp = rowIndex / (float)(AuthoredRowCount - 1);
                    float sourceSpacing = 32f - 6f * ramp;
                    rowDistance += sourceSpacing + (random.NextFloat() - .5f) * 10f;

                    // The source picked a new random two-lane gap every row. Keep that
                    // rhythm, but constrain its random walk to the ship's validated
                    // movement envelope so the authored opening is actually usable.
                    int laneStep = random.NextInt(-1, 2);
                    float seconds = sourceSpacing / forwardSpeed;
                    float available = capability.MaximumLateralVelocity * seconds
                        + .5f * capability.LateralAcceleration * seconds * seconds;
                    if (available < LaneWidth * .85f) laneStep = 0;
                    safeGapStart = Math.Max(5, Math.Min(14, safeGapStart + laneStep));
                }

                int valuableGapStart = safeGapStart <= 9
                    ? Math.Min(LaneCount - 2, safeGapStart + 6)
                    : Math.Max(0, safeGapStart - 6);
                ShuffleLanes(random, laneScratch);
                int targetCount = MinimumBlockersPerRow + random.NextInt(0, 2);
                var blocked = new List<int>(MaximumBlockersPerRow);
                for (int i = 0; i < laneScratch.Length && blocked.Count < targetCount; i++)
                {
                    int lane = laneScratch[i];
                    if (InsideGap(lane, safeGapStart) || InsideGap(lane, valuableGapStart)) continue;
                    bool clashes = false;
                    for (int blockedIndex = 0; blockedIndex < blocked.Count; blockedIndex++)
                        if (Math.Abs(blocked[blockedIndex] - lane) < MinimumLaneGap)
                        {
                            clashes = true;
                            break;
                        }
                    if (!clashes) blocked.Add(lane);
                }

                float safeCenter = GapCenterX(safeGapStart);
                float valuableCenter = GapCenterX(valuableGapStart);
                rows[rowIndex] = new RandomConeFormationRow(
                    rowDistance,
                    safeGapStart,
                    valuableGapStart,
                    safeCenter,
                    valuableCenter,
                    blocked.ToArray());
                float routeHalfWidth = Math.Max(capability.CollisionHalfWidth + .65f, 2.15f);
                safePoints[rowIndex] = new CargoWaveRoutePoint(
                    CargoWaveRouteRole.Safe,
                    worldStartDistance + rowDistance,
                    safeCenter,
                    routeHalfWidth);
                valuablePoints[rowIndex] = new CargoWaveRoutePoint(
                    CargoWaveRouteRole.Valuable,
                    worldStartDistance + rowDistance,
                    valuableCenter,
                    routeHalfWidth);

                for (int blockedIndex = 0; blockedIndex < blocked.Count; blockedIndex++)
                {
                    int lane = blocked[blockedIndex];
                    float x = LaneCenterX(lane) + (random.NextFloat() - .5f) * .6f;
                    float zJitter = (random.NextFloat() - .5f) * 8f;
                    float halfWidth = 2.05f + random.NextFloat() * .55f;
                    float halfDepth = 2.8f + random.NextFloat() * 1.35f;
                    float height = 10f + random.NextFloat() * 8f;
                    int silhouetteIndex = (variant * 3 + rowIndex + blockedIndex) % Silhouettes.Length;
                    features.Add(new TerrainWorldFeature(
                        500000 + (variant & 15) * 10000 + rowIndex * 100 + blockedIndex,
                        Silhouettes[silhouetteIndex],
                        rowDistance + zJitter,
                        x,
                        halfWidth,
                        height,
                        halfDepth,
                        TraversalRequirement.None,
                        seed + rowIndex * 101 + blockedIndex * 17));
                }
            }

            float length = rowDistance - localStart + ExitClearDistance;
            var routes = new[]
            {
                new WorldParcelRoutePlan("random-cones.safe", CargoWaveRouteRole.Safe, safePoints),
                new WorldParcelRoutePlan("random-cones.valuable", CargoWaveRouteRole.Valuable, valuablePoints)
            };
            return new RandomConeFormationPlan(
                length,
                SourceSpawnDistance,
                78f,
                rows,
                features.ToArray(),
                routes);
        }

        static void ShuffleLanes(DeterministicRandom random, int[] lanes)
        {
            for (int i = 0; i < lanes.Length; i++) lanes[i] = i;
            for (int i = lanes.Length - 1; i > 0; i--)
            {
                int j = random.NextInt(0, i + 1);
                int temporary = lanes[i];
                lanes[i] = lanes[j];
                lanes[j] = temporary;
            }
        }

        static bool InsideGap(int lane, int gapStart) => lane == gapStart || lane == gapStart + 1;
        static float LaneCenterX(int lane) => (lane - (LaneCount - 1) * .5f) * LaneWidth;
        static float GapCenterX(int gapStart) => (gapStart + .5f - (LaneCount - 1) * .5f) * LaneWidth;
    }
}
