using System;
using System.Collections.Generic;

namespace JetHorizon.Simulation
{
    /// <summary>
    /// Shared pace limits for authored terrain. Runtime pace and world generation
    /// must use the same ceiling or a route can be valid at launch and impossible
    /// after its own completion rewards accelerate the ship.
    /// </summary>
    public static class TerrainWorldPaceRules
    {
        public static float MaximumSpeedForHeat(int heat)
            => 128f + Math.Max(0, Math.Min(5, heat)) * 12f;
    }

    public static class TraversalEnvelopeRules
    {
        public const float SafetyMargin = 1.25f;
        public const float ComfortVelocityUsage = .72f;
        public const float ComfortAccelerationUsage = .62f;
        public const float MobileReactionSeconds = .20f;
        public const float SpatialSampleDistance = 10f;

        public static float ComfortableSlope(ShipCapabilityProfile capability, float forwardSpeed)
            => capability.MaximumLateralVelocity * ComfortVelocityUsage / Math.Max(1f, forwardSpeed);

        public static float ComfortableCurvature(ShipCapabilityProfile capability, float forwardSpeed)
            => capability.LateralAcceleration * ComfortAccelerationUsage
                / Math.Max(1f, forwardSpeed * forwardSpeed);

        public static float ReachFromRest(
            float availableSeconds,
            float lateralAcceleration,
            float maximumLateralVelocity)
        {
            float t = Math.Max(0f, availableSeconds);
            float acceleration = Math.Max(.001f, lateralAcceleration);
            float maximumVelocity = Math.Max(.001f, maximumLateralVelocity);
            float timeToCap = maximumVelocity / acceleration;
            if (t <= timeToCap) return .5f * acceleration * t * t;
            return maximumVelocity * t - maximumVelocity * maximumVelocity / (2f * acceleration);
        }

        public static float RequiredForwardDistanceFromRest(
            float lateralDistance,
            float forwardSpeed,
            ShipCapabilityProfile capability,
            float reactionSeconds = MobileReactionSeconds)
        {
            float distance = Math.Max(0f, lateralDistance);
            float acceleration = capability.LateralAcceleration * ComfortAccelerationUsage;
            float maximumVelocity = capability.MaximumLateralVelocity * ComfortVelocityUsage;
            float distanceAtCap = maximumVelocity * maximumVelocity / (2f * acceleration);
            float movementSeconds = distance <= distanceAtCap
                ? (float)Math.Sqrt(2f * distance / acceleration)
                : distance / maximumVelocity + maximumVelocity / (2f * acceleration);
            return Math.Max(1f, forwardSpeed) * (Math.Max(0f, reactionSeconds) + movementSeconds);
        }
    }

    public readonly struct TraversalEnvelopeResult
    {
        public bool Reachable { get; }
        public bool Comfortable { get; }
        public bool RejectsNeutral { get; }
        public bool RejectsConstantLeft { get; }
        public bool RejectsConstantRight { get; }
        public float ForwardSpeed { get; }
        public float MinimumRouteClearance { get; }
        public float FailureDistance { get; }
        public float MaximumCenterlineLateralVelocity { get; }
        public float MaximumCenterlineLateralAcceleration { get; }
        public float ComfortableLateralVelocityLimit { get; }
        public float ComfortableLateralAccelerationLimit { get; }
        public bool IsAdmissible => Reachable
            && Comfortable
            && RejectsNeutral
            && RejectsConstantLeft
            && RejectsConstantRight;

        internal TraversalEnvelopeResult(
            bool reachable,
            bool comfortable,
            bool rejectsNeutral,
            bool rejectsConstantLeft,
            bool rejectsConstantRight,
            float forwardSpeed,
            float minimumRouteClearance,
            float failureDistance,
            float maximumCenterlineLateralVelocity,
            float maximumCenterlineLateralAcceleration,
            float comfortableLateralVelocityLimit,
            float comfortableLateralAccelerationLimit)
        {
            Reachable = reachable;
            Comfortable = comfortable;
            RejectsNeutral = rejectsNeutral;
            RejectsConstantLeft = rejectsConstantLeft;
            RejectsConstantRight = rejectsConstantRight;
            ForwardSpeed = forwardSpeed;
            MinimumRouteClearance = minimumRouteClearance;
            FailureDistance = failureDistance;
            MaximumCenterlineLateralVelocity = maximumCenterlineLateralVelocity;
            MaximumCenterlineLateralAcceleration = maximumCenterlineLateralAcceleration;
            ComfortableLateralVelocityLimit = comfortableLateralVelocityLimit;
            ComfortableLateralAccelerationLimit = comfortableLateralAccelerationLimit;
        }
    }

    /// <summary>
    /// Dense engine-neutral route validation. Unlike the older opening-only test,
    /// this propagates position and lateral velocity through the complete shoreline
    /// and removes states blocked by waterline formations at every spatial sample.
    /// </summary>
    public sealed class TraversalEnvelopeValidator
    {
        const float IntegrationStep = 1f / 60f;
        const int MaximumStates = 256;
        const int MaximumCandidates = 1536;
        static readonly int[] Inputs = { 0, -1, 1 };

        readonly struct MotionState
        {
            public float X { get; }
            public float Velocity { get; }
            public float Clearance { get; }

            public MotionState(float x, float velocity, float clearance)
            {
                X = x;
                Velocity = velocity;
                Clearance = clearance;
            }
        }

        public TraversalEnvelopeResult Validate(
            TerrainWorldPlan world,
            ShipCapabilityProfile capability,
            float forwardSpeed)
        {
            if (world == null) throw new ArgumentNullException(nameof(world));
            if (forwardSpeed <= 0f) throw new ArgumentOutOfRangeException(nameof(forwardSpeed));

            MeasureCenterline(
                world,
                forwardSpeed,
                out float maximumCenterVelocity,
                out float maximumCenterAcceleration);
            float comfortableVelocity = capability.MaximumLateralVelocity
                * TraversalEnvelopeRules.ComfortVelocityUsage;
            float comfortableAcceleration = capability.LateralAcceleration
                * TraversalEnvelopeRules.ComfortAccelerationUsage;
            bool comfortable = maximumCenterVelocity <= comfortableVelocity * 1.01f
                && maximumCenterAcceleration <= comfortableAcceleration * 1.01f;

            bool reachable = IsReachable(
                world,
                capability,
                forwardSpeed,
                out float minimumClearance,
                out float failureDistance);
            bool rejectsNeutral = !SurvivesFixedPolicy(world, capability, forwardSpeed, 0);
            bool rejectsConstantLeft = !SurvivesFixedPolicy(world, capability, forwardSpeed, -1);
            bool rejectsConstantRight = !SurvivesFixedPolicy(world, capability, forwardSpeed, 1);
            return new TraversalEnvelopeResult(
                reachable,
                comfortable,
                rejectsNeutral,
                rejectsConstantLeft,
                rejectsConstantRight,
                forwardSpeed,
                minimumClearance,
                failureDistance,
                maximumCenterVelocity,
                maximumCenterAcceleration,
                comfortableVelocity,
                comfortableAcceleration);
        }

        static bool SurvivesFixedPolicy(
            TerrainWorldPlan world,
            ShipCapabilityProfile capability,
            float forwardSpeed,
            int input)
        {
            var state = new MotionState(0f, 0f, float.MaxValue);
            float priorDistance = 0f;
            for (float distance = TraversalEnvelopeRules.SpatialSampleDistance;
                distance <= world.Length + .01f;
                distance += TraversalEnvelopeRules.SpatialSampleDistance)
            {
                float sampledDistance = Math.Min(distance, world.Length);
                state = Integrate(
                    state,
                    capability,
                    (sampledDistance - priorDistance) / forwardSpeed,
                    input);
                if (!TryMeasureClearance(
                    world,
                    sampledDistance,
                    state.X,
                    capability.CollisionHalfWidth,
                    out _))
                    return false;
                priorDistance = sampledDistance;
                if (sampledDistance >= world.Length) break;
            }
            return true;
        }

        static void MeasureCenterline(
            TerrainWorldPlan world,
            float forwardSpeed,
            out float maximumVelocity,
            out float maximumAcceleration)
        {
            maximumVelocity = 0f;
            maximumAcceleration = 0f;
            float priorSlope = 0f;
            bool hasPriorSlope = false;
            for (int i = 1; i < world.SectionCount; i++)
            {
                TerrainWorldSection a = world.GetSection(i - 1);
                TerrainWorldSection b = world.GetSection(i);
                if (a.Region != TerrainRegionKind.CrystallineCanyon
                    || b.Region != TerrainRegionKind.CrystallineCanyon)
                {
                    hasPriorSlope = false;
                    continue;
                }
                float dz = Math.Max(.001f, b.Distance - a.Distance);
                float slope = (b.WaterCenterX - a.WaterCenterX) / dz;
                maximumVelocity = Math.Max(maximumVelocity, Math.Abs(slope) * forwardSpeed);
                if (hasPriorSlope)
                {
                    float curvature = (slope - priorSlope) / dz;
                    maximumAcceleration = Math.Max(
                        maximumAcceleration,
                        Math.Abs(curvature) * forwardSpeed * forwardSpeed);
                }
                priorSlope = slope;
                hasPriorSlope = true;
            }
        }

        static bool IsReachable(
            TerrainWorldPlan world,
            ShipCapabilityProfile capability,
            float forwardSpeed,
            out float minimumClearance,
            out float failureDistance)
        {
            var states = new List<MotionState>(MaximumStates)
            {
                new MotionState(0f, 0f, float.MaxValue)
            };
            minimumClearance = float.MaxValue;
            failureDistance = 0f;
            float priorDistance = 0f;
            for (float distance = TraversalEnvelopeRules.SpatialSampleDistance;
                distance <= world.Length + .01f;
                distance += TraversalEnvelopeRules.SpatialSampleDistance)
            {
                float sampledDistance = Math.Min(distance, world.Length);
                float seconds = (sampledDistance - priorDistance) / forwardSpeed;
                var candidates = new List<MotionState>(Math.Min(MaximumCandidates, states.Count * 3));
                var occupied = new HashSet<long>();
                for (int stateIndex = 0; stateIndex < states.Count; stateIndex++)
                {
                    for (int inputIndex = 0; inputIndex < Inputs.Length; inputIndex++)
                    {
                        MotionState candidate = Integrate(
                            states[stateIndex],
                            capability,
                            seconds,
                            Inputs[inputIndex]);
                        if (!TryMeasureClearance(
                            world,
                            sampledDistance,
                            candidate.X,
                            capability.CollisionHalfWidth,
                            out float clearance))
                            continue;
                        long key = QuantizedKey(candidate.X, candidate.Velocity);
                        if (!occupied.Add(key)) continue;
                        candidates.Add(new MotionState(
                            candidate.X,
                            candidate.Velocity,
                            Math.Min(states[stateIndex].Clearance, clearance)));
                        if (candidates.Count >= MaximumCandidates) break;
                    }
                    if (candidates.Count >= MaximumCandidates) break;
                }
                if (candidates.Count == 0)
                {
                    minimumClearance = -1f;
                    failureDistance = sampledDistance;
                    return false;
                }
                states = ReduceDeterministically(candidates);
                float bestClearance = -1f;
                for (int i = 0; i < states.Count; i++)
                    bestClearance = Math.Max(bestClearance, states[i].Clearance);
                minimumClearance = Math.Min(minimumClearance, bestClearance);
                priorDistance = sampledDistance;
                if (sampledDistance >= world.Length) break;
            }
            return true;
        }

        static MotionState Integrate(
            MotionState start,
            ShipCapabilityProfile capability,
            float seconds,
            int input)
        {
            int steps = Math.Max(1, (int)Math.Ceiling(seconds / IntegrationStep));
            float dt = seconds / steps;
            float x = start.X;
            float velocity = start.Velocity;
            for (int i = 0; i < steps; i++)
            {
                if (input == 0)
                {
                    velocity *= Math.Max(0f, 1f - capability.NeutralSettleRate * dt);
                }
                else
                {
                    float acceleration = capability.LateralAcceleration;
                    if (velocity * input < 0f) acceleration *= capability.CounterSteerMultiplier;
                    velocity += input * acceleration * dt;
                    velocity = Math.Max(
                        -capability.MaximumLateralVelocity,
                        Math.Min(capability.MaximumLateralVelocity, velocity));
                }
                x += velocity * dt;
            }
            return new MotionState(x, velocity, start.Clearance);
        }

        static bool TryMeasureClearance(
            TerrainWorldPlan world,
            float distance,
            float shipX,
            float shipHalfWidth,
            out float clearance)
        {
            if (world.HasRoutePassagesAt(distance))
            {
                bool insideAnyPassage = false;
                float bestClearance = -1f;
                TryRoute(TerrainRouteKind.SafeCanyon);
                TryRoute(TerrainRouteKind.KnifeEdgeTunnel);
                TryRoute(TerrainRouteKind.CargoChannel);
                if (!insideAnyPassage)
                {
                    clearance = -1f;
                    return false;
                }
                clearance = bestClearance;
                return true;

                void TryRoute(TerrainRouteKind kind)
                {
                    if (!world.TryGetRoutePassage(kind, distance, out float routeLeft, out float routeRight, out _))
                        return;
                    float left = routeLeft + shipHalfWidth + TraversalEnvelopeRules.SafetyMargin;
                    float right = routeRight - shipHalfWidth - TraversalEnvelopeRules.SafetyMargin;
                    if (shipX < left || shipX > right) return;
                    insideAnyPassage = true;
                    bestClearance = Math.Max(bestClearance, Math.Min(shipX - left, right - shipX));
                }
            }
            SampleShore(world, distance, out float leftShore, out float rightShore);
            float left = leftShore + shipHalfWidth + TraversalEnvelopeRules.SafetyMargin;
            float right = rightShore - shipHalfWidth - TraversalEnvelopeRules.SafetyMargin;
            if (shipX < left || shipX > right)
            {
                clearance = -1f;
                return false;
            }
            clearance = Math.Min(shipX - left, right - shipX);
            for (int i = 0; i < world.FeatureCount; i++)
            {
                TerrainWorldFeature feature = world.GetFeature(i);
                if (!TerrainWorldFeatureRules.IsWaterFormation(feature.Kind)) continue;
                float radiusZ = feature.CollisionHalfDepth
                    + shipHalfWidth
                    + TraversalEnvelopeRules.SafetyMargin;
                float normalizedZ = (distance - feature.Distance) / radiusZ;
                if (Math.Abs(normalizedZ) >= 1f) continue;
                float radiusX = feature.HalfWidth
                    * (float)Math.Sqrt(Math.Max(0f, 1f - normalizedZ * normalizedZ))
                    + shipHalfWidth
                    + TraversalEnvelopeRules.SafetyMargin;
                float blockedLeft = feature.CenterX - radiusX;
                float blockedRight = feature.CenterX + radiusX;
                if (shipX >= blockedLeft && shipX <= blockedRight)
                {
                    clearance = -1f;
                    return false;
                }
                float featureClearance = shipX < blockedLeft
                    ? blockedLeft - shipX
                    : shipX - blockedRight;
                clearance = Math.Min(clearance, featureClearance);
            }
            return true;
        }

        static void SampleShore(
            TerrainWorldPlan world,
            float distance,
            out float leftShore,
            out float rightShore)
        {
            int index = 0;
            while (index < world.SectionCount - 1
                && distance >= world.GetSection(index + 1).Distance)
                index++;
            TerrainWorldSection a = world.GetSection(index);
            if (index >= world.SectionCount - 1)
            {
                leftShore = a.LeftShoreX;
                rightShore = a.RightShoreX;
                return;
            }
            TerrainWorldSection b = world.GetSection(index + 1);
            float t = Math.Max(0f, Math.Min(1f,
                (distance - a.Distance) / Math.Max(.001f, b.Distance - a.Distance)));
            leftShore = a.LeftShoreX + (b.LeftShoreX - a.LeftShoreX) * t;
            rightShore = a.RightShoreX + (b.RightShoreX - a.RightShoreX) * t;
        }

        static List<MotionState> ReduceDeterministically(List<MotionState> candidates)
        {
            if (candidates.Count <= MaximumStates) return candidates;
            candidates.Sort((a, b) =>
            {
                int x = a.X.CompareTo(b.X);
                return x != 0 ? x : a.Velocity.CompareTo(b.Velocity);
            });
            var reduced = new List<MotionState>(MaximumStates);
            float stride = (candidates.Count - 1f) / (MaximumStates - 1f);
            for (int i = 0; i < MaximumStates; i++)
                reduced.Add(candidates[(int)Math.Round(i * stride)]);
            return reduced;
        }

        static long QuantizedKey(float x, float velocity)
        {
            long qx = (long)Math.Round(x * 2f);
            long qv = (long)Math.Round(velocity * 2f);
            return (qx << 32) ^ (qv & 0xffffffffL);
        }
    }
}
