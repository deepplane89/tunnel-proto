using System;

namespace JetHorizon.Simulation
{
    public readonly struct GateRouteNode
    {
        public int Id { get; }
        public SpeedGateKind Kind { get; }
        public float Distance { get; }
        public float CenterX { get; }
        public float HalfWidth { get; }

        public GateRouteNode(int id, SpeedGateKind kind, float distance, float centerX, float halfWidth)
        {
            if (id <= 0) throw new ArgumentOutOfRangeException(nameof(id));
            if (distance < 0f) throw new ArgumentOutOfRangeException(nameof(distance));
            if (halfWidth <= 0f) throw new ArgumentOutOfRangeException(nameof(halfWidth));
            Id = id;
            Kind = kind;
            Distance = distance;
            CenterX = centerX;
            HalfWidth = halfWidth;
        }
    }

    public sealed class GateRoutePlan
    {
        readonly GateRouteNode[] _nodes;

        public int Sector { get; }
        public float StartDistance { get; }
        public float EndDistance { get; }
        public int Count => _nodes.Length;

        public GateRoutePlan(int sector, float startDistance, GateRouteNode[] nodes)
        {
            if (sector < 0) throw new ArgumentOutOfRangeException(nameof(sector));
            if (startDistance < 0f) throw new ArgumentOutOfRangeException(nameof(startDistance));
            if (nodes == null || nodes.Length < 8) throw new ArgumentException("A sector route needs at least eight gates.", nameof(nodes));
            float prior = startDistance;
            _nodes = new GateRouteNode[nodes.Length];
            for (int i = 0; i < nodes.Length; i++)
            {
                if (nodes[i].Distance <= prior)
                    throw new ArgumentException("Gate distances must be strictly increasing.", nameof(nodes));
                _nodes[i] = nodes[i];
                prior = nodes[i].Distance;
            }
            Sector = sector;
            StartDistance = startDistance;
            EndDistance = _nodes[_nodes.Length - 1].Distance;
        }

        public GateRouteNode Get(int index) => index >= 0 && index < _nodes.Length
            ? _nodes[index]
            : throw new ArgumentOutOfRangeException(nameof(index));
    }

    public sealed class GateRoutePlanner
    {
        const int GateCount = 42;
        const float CheckpointHitRadius = 4.25f;
        static readonly float[] CheckpointPattern = { 0f, -9f, 9f, -11f, 11f, -9f, 9f };
        static readonly float[] CheckpointCadenceSeconds = { .88f, .94f, .90f, .98f, .86f, .93f, .96f };

        public GateRoutePlan Build(
            int sector,
            float startDistance,
            float projectedStartSpeed,
            ShipCapabilityProfile capability,
            DeterministicRandom random)
        {
            if (random == null) throw new ArgumentNullException(nameof(random));
            float speed = Math.Max(30f, projectedStartSpeed);
            float distance = startDistance;
            float center = 0f;
            var nodes = new GateRouteNode[GateCount];

            for (int i = 0; i < GateCount; i++)
            {
                // Author the route in reaction time, not raw metres. Faster ships see
                // the same readable rhythm with proportionally more world distance.
                // Keep the distant opening readable, then use a denser varied rhythm.
                // At the Unity proof speed this produces roughly the same world-space
                // density as the lower-speed Three.js prototype instead of long empty gaps.
                float cadence = i == 0
                    ? 3.20f
                    : CheckpointCadenceSeconds[(i - 1 + sector) % CheckpointCadenceSeconds.Length];
                distance += Math.Max(48f, speed * cadence);

                SpeedGateKind kind = GateKindFor(sector, i);
                float target = RouteTarget(sector, i);
                float seconds = Math.Max(.45f, (distance - (i == 0 ? startDistance : nodes[i - 1].Distance)) / speed);
                float reachable = capability.MaximumLateralVelocity * seconds * .72f
                    + capability.LateralAcceleration * seconds * seconds * .16f;
                center += Clamp(target - center, -reachable, reachable);
                center = Clamp(center, -32f, 32f);
                float halfWidth = kind == SpeedGateKind.Extraction
                    ? 9.5f
                    : CheckpointHitRadius + capability.CollisionHalfWidth;
                if (kind == SpeedGateKind.Extraction)
                    center = (sector & 1) == 0 ? -18f : 18f;

                nodes[i] = new GateRouteNode(
                    sector * 1000 + i + 1,
                    kind,
                    distance,
                    center,
                    halfWidth);

                if (kind != SpeedGateKind.Extraction)
                    speed += GateProgressionModel.GainFor(kind, speed);
            }

            return new GateRoutePlan(sector, startDistance, nodes);
        }

        static SpeedGateKind GateKindFor(int sector, int index)
        {
            if (index == GateCount - 1) return SpeedGateKind.Extraction;
            if (sector > 0 && index == 0) return SpeedGateKind.Surge;
            if (sector == 3 && index == 23) return SpeedGateKind.CanyonTransition;
            if (sector == 4 && index == 21) return SpeedGateKind.PrismaticTransition;
            return index > 0 && index % 9 == 0 ? SpeedGateKind.Surge : SpeedGateKind.Common;
        }

        static float RouteTarget(int sector, int index)
        {
            return CheckpointPattern[(index + sector) % CheckpointPattern.Length];
        }

        static float Clamp(float value, float minimum, float maximum)
            => value < minimum ? minimum : value > maximum ? maximum : value;
    }

    public readonly struct GateRouteValidation
    {
        public bool Reachable { get; }
        public bool HasMeaningfulLateralVariation { get; }
        public float MinimumReactionSeconds { get; }
        public bool IsValid => Reachable && HasMeaningfulLateralVariation;

        public GateRouteValidation(bool reachable, bool hasMeaningfulLateralVariation, float minimumReactionSeconds)
        {
            Reachable = reachable;
            HasMeaningfulLateralVariation = hasMeaningfulLateralVariation;
            MinimumReactionSeconds = minimumReactionSeconds;
        }
    }

    public sealed class GateRouteValidator
    {
        public GateRouteValidation Validate(GateRoutePlan plan, ShipCapabilityProfile capability, float speed)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            float previousDistance = plan.StartDistance;
            float previousX = 0f;
            float minimumSeconds = float.MaxValue;
            float variation = 0f;
            for (int i = 0; i < plan.Count - 1; i++)
            {
                GateRouteNode node = plan.Get(i);
                float seconds = (node.Distance - previousDistance) / Math.Max(1f, speed);
                minimumSeconds = Math.Min(minimumSeconds, seconds);
                float delta = Math.Abs(node.CenterX - previousX);
                variation += delta;
                float reachable = capability.MaximumLateralVelocity * seconds
                    + .5f * capability.LateralAcceleration * seconds * seconds;
                if (delta > reachable + node.HalfWidth)
                    return new GateRouteValidation(false, variation >= 20f, minimumSeconds);
                previousDistance = node.Distance;
                previousX = node.CenterX;
            }
            return new GateRouteValidation(true, variation >= 20f, minimumSeconds);
        }
    }
}
