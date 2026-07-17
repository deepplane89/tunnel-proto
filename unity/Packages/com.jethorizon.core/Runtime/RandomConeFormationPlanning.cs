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
        public int BurstIndex { get; }
        public int RowInBurst { get; }
        public int AntiCampingTargetLane { get; }
        public int SafeGapStartLane { get; }
        public int ValuableGapStartLane { get; }
        public float SafeCenterX { get; }
        public float ValuableCenterX { get; }
        public int BlockedCount => _blockedLanes.Length;

        internal RandomConeFormationRow(
            float distance,
            int burstIndex,
            int rowInBurst,
            int antiCampingTargetLane,
            int safeGapStartLane,
            int valuableGapStartLane,
            float safeCenterX,
            float valuableCenterX,
            int[] blockedLanes)
        {
            Distance = distance;
            BurstIndex = burstIndex;
            RowInBurst = rowInBurst;
            AntiCampingTargetLane = antiCampingTargetLane;
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

        public bool RejectsStationaryHold(float x, float shipHalfWidth)
        {
            if (shipHalfWidth <= 0f) throw new ArgumentOutOfRangeException(nameof(shipHalfWidth));
            for (int i = 0; i < _features.Length; i++)
                if (Math.Abs(_features[i].CenterX - x) <= Math.Max(
                    .1f,
                    _features[i].HalfWidth + shipHalfWidth
                        - RandomConeFormationPlanner.CollisionVisualInset))
                    return true;
            return false;
        }

        internal TerrainWorldFeature[] CopyFeatures() => (TerrainWorldFeature[])_features.Clone();
        internal WorldParcelRoutePlan[] CopyRoutes() => (WorldParcelRoutePlan[])_routes.Clone();
    }

    /// <summary>
    /// Deterministic engine-neutral port of the old random-cone row algorithm.
    /// The source lane shuffle and anti-bunch rules are arranged into three finite
    /// bursts. Each burst holds a readable opening on one side, the next burst moves
    /// it across the water, and the third returns it, forcing a real slalom.
    /// </summary>
    public sealed class RandomConeFormationPlanner
    {
        public const int LaneCount = 21;
        public const float LaneWidth = 3.2f;
        public const int MinimumLaneGap = 3;
        public const int MinimumBlockersPerRow = 4;
        public const int MaximumBlockersPerRow = 5;
        public const int BurstCount = 3;
        public const int RowsPerBurst = 3;
        public const int AuthoredRowCount = BurstCount * RowsPerBurst;
        public const float SourceSpawnDistance = 160f;
        public const float ReferenceForwardSpeed = 128f;
        public const float NominalInBurstSpacing = 64f;
        public const float InterBurstSpacing = 180f;
        public const float StationaryHoldMinimumX = -32f;
        public const float StationaryHoldMaximumX = 32f;
        public const float CollisionVisualInset = 1.25f;

        const float InitialLeadDistance = 30f;
        const float ExitClearDistance = 72f;
        static readonly int[] SlalomGapStarts = { 5, 6, 7, 12, 13, 14, 7, 6, 5 };
        // The GitHub generator defeats camping by rebuilding every lane around
        // predicted ship X. A prebuilt finite wave cannot chase after reveal, so
        // these anchors provide the equivalent guarantee across the whole field.
        static readonly int[] AntiCampingTargetLanes = { 12, 15, 18, 0, 3, 6, 20, 9, 10 };
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
            float paceScale = PaceDistanceScale(forwardSpeed);
            float rowDistance = localStart + InitialLeadDistance * paceScale;

            for (int rowIndex = 0; rowIndex < AuthoredRowCount; rowIndex++)
            {
                int burstIndex = rowIndex / RowsPerBurst;
                int rowInBurst = rowIndex % RowsPerBurst;
                if (rowIndex > 0)
                {
                    float spacing = rowInBurst == 0
                        ? InterBurstSpacing
                        : NominalInBurstSpacing + (random.NextFloat() - .5f) * 10f;
                    rowDistance += spacing * paceScale;
                }

                int safeGapStart = SlalomGapStarts[rowIndex];
                if ((variant & 1) != 0) safeGapStart = LaneCount - 2 - safeGapStart;
                int antiCampingTargetLane = AntiCampingTargetLanes[rowIndex];
                if ((variant & 1) != 0)
                    antiCampingTargetLane = LaneCount - 1 - antiCampingTargetLane;
                int direction = safeGapStart < (LaneCount - 2) / 2 ? -1 : 1;
                int valuableGapStart = Math.Max(
                    0,
                    Math.Min(LaneCount - 2, safeGapStart + direction * 4));
                ShuffleLanes(random, laneScratch);
                int targetCount = MaximumBlockersPerRow;
                var blocked = new List<int>(MaximumBlockersPerRow);
                blocked.Add(antiCampingTargetLane);
                for (int i = 0; i < laneScratch.Length && blocked.Count < targetCount; i++)
                {
                    int lane = laneScratch[i];
                    // The original cone radius fit tightly beside its two-lane gap.
                    // These geological silhouettes are wider, so reserve one guard
                    // lane on either edge of the safe opening before shuffling the
                    // remaining source lanes.
                    if (InsideSafeClearance(lane, safeGapStart)
                        || InsideGap(lane, valuableGapStart)) continue;
                    bool clashes = false;
                    for (int blockedIndex = 0; blockedIndex < blocked.Count; blockedIndex++)
                        if (Math.Abs(blocked[blockedIndex] - lane) < MinimumLaneGap)
                        {
                            clashes = true;
                            break;
                        }
                    if (!clashes) blocked.Add(lane);
                }
                if (blocked.Count != targetCount)
                    throw new InvalidOperationException("Random-cone row could not place its full blocker density.");

                float safeCenter = GapCenterX(safeGapStart);
                float valuableCenter = GapCenterX(valuableGapStart);
                rows[rowIndex] = new RandomConeFormationRow(
                    rowDistance,
                    burstIndex,
                    rowInBurst,
                    antiCampingTargetLane,
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
                    float zJitter = (random.NextFloat() - .5f) * 6f;
                    float halfWidth = 5.2f + random.NextFloat() * .6f;
                    float halfDepth = 3.4f + random.NextFloat() * 1.8f;
                    float height = 9f + random.NextFloat() * 9f;
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

            float length = rowDistance - localStart + ExitClearDistance * paceScale;
            for (float x = StationaryHoldMinimumX; x <= StationaryHoldMaximumX + .01f; x += .25f)
            {
                bool rejected = false;
                for (int featureIndex = 0; featureIndex < features.Count; featureIndex++)
                    if (Math.Abs(features[featureIndex].CenterX - x)
                        <= Math.Max(
                            .1f,
                            features[featureIndex].HalfWidth + capability.CollisionHalfWidth
                                - CollisionVisualInset))
                    {
                        rejected = true;
                        break;
                    }
                if (!rejected)
                    throw new InvalidOperationException(
                        "Random-cone formation leaves a stationary hold at X=" + x.ToString("0.00") + ".");
            }
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

        public static float PaceDistanceScale(float forwardSpeed)
            => .5f + .5f * Math.Max(1f, forwardSpeed / ReferenceForwardSpeed);

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

        static bool InsideSafeClearance(int lane, int gapStart)
            => lane >= gapStart - 1 && lane <= gapStart + 2;
        static bool InsideGap(int lane, int gapStart) => lane == gapStart || lane == gapStart + 1;
        static float LaneCenterX(int lane) => (lane - (LaneCount - 1) * .5f) * LaneWidth;
        static float GapCenterX(int gapStart) => (gapStart + .5f - (LaneCount - 1) * .5f) * LaneWidth;
    }
}
