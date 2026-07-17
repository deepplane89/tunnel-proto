using System;
using System.Collections.Generic;

namespace JetHorizon.Simulation
{
    public enum WorldParcelKind
    {
        OpenWaterFormation,
        OpenWaterLightning,
        OpenWaterBreather,
        CrystallineCanyon,
        RoutePortal,
        KnifeEdgeTunnel,
        PrismaticCorridor
    }

    public enum WorldEnvelopeKind
    {
        None,
        DistantBanks,
        CanyonShoreline,
        RouteMass,
        PrismaticShell
    }

    public enum WorldParcelLifecycle
    {
        None,
        Planned,
        FullyBuiltHidden,
        HorizonReveal,
        Approach,
        Active,
        PassingBehind,
        RearCull,
        Complete
    }

    public enum WorldFormationArchetype
    {
        None,
        CompactSpireCluster,
        SplitShardPair,
        LowReefRidge,
        SteppedRockChain,
        AsymmetricBoulderGroup,
        StaggeredSlalomIslands,
        NarrowCrackFormation,
        TwoRouteCluster
    }

    public enum WorldThreatKind
    {
        None,
        LightningWeave
    }

    public readonly struct WorldThreatPlan
    {
        public WorldThreatKind Kind { get; }
        public int BeatCount { get; }
        public int Seed { get; }

        public WorldThreatPlan(WorldThreatKind kind, int beatCount, int seed)
        {
            if (beatCount < 0) throw new ArgumentOutOfRangeException(nameof(beatCount));
            Kind = kind;
            BeatCount = beatCount;
            Seed = seed;
        }
    }

    public sealed class WorldParcelRoutePlan
    {
        readonly CargoWaveRoutePoint[] _points;

        public string Id { get; }
        public CargoWaveRouteRole Role { get; }
        public int PointCount => _points.Length;

        public WorldParcelRoutePlan(
            string id,
            CargoWaveRouteRole role,
            CargoWaveRoutePoint[] points)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("Route id is required.", nameof(id));
            if (points == null || points.Length < 3)
                throw new ArgumentException("A parcel route needs at least three points.", nameof(points));
            _points = (CargoWaveRoutePoint[])points.Clone();
            float priorDistance = -1f;
            for (int i = 0; i < _points.Length; i++)
            {
                if (_points[i].Role != role)
                    throw new ArgumentException("Route point role does not match its parcel route.", nameof(points));
                if (_points[i].Distance <= priorDistance)
                    throw new ArgumentException("Route points must be strictly ordered.", nameof(points));
                priorDistance = _points[i].Distance;
            }
            Id = id;
            Role = role;
        }

        public CargoWaveRoutePoint GetPoint(int index) => index >= 0 && index < _points.Length
            ? _points[index]
            : throw new ArgumentOutOfRangeException(nameof(index));
    }

    /// <summary>
    /// One complete physical piece of a run. Unlike the legacy TerrainWorldWave,
    /// the envelope is optional and therefore open water carries no implicit shore.
    /// </summary>
    public sealed class WorldParcelPlan
    {
        readonly TerrainWorldSection[] _shoreSections;
        readonly TerrainWorldFeature[] _features;
        readonly TerrainRouteSection[] _routeSections;
        readonly WorldParcelRoutePlan[] _routes;

        public string Id { get; }
        public string VariantId { get; }
        public WorldParcelKind Kind { get; }
        public WorldEnvelopeKind Envelope { get; }
        public WorldFormationArchetype Formation { get; }
        public float WorldStartDistance { get; }
        public float StartDistance { get; }
        public float LocalStartDistance => StartDistance - WorldStartDistance;
        public float Length { get; }
        public float EndDistance => StartDistance + Length;
        public float LocalEndDistance => LocalStartDistance + Length;
        public float RevealDistance { get; }
        public float ApproachDistance { get; }
        public float RearCullDistance { get; }
        public WorldThreatPlan Threats { get; }
        public CargoWavePlan Cargo { get; }
        public TraversalRequirement Requirement { get; }
        public int ShoreSectionCount => _shoreSections.Length;
        public int FeatureCount => _features.Length;
        public int RouteSectionCount => _routeSections.Length;
        public int RouteCount => _routes.Length;
        public bool IsBreather => Kind == WorldParcelKind.OpenWaterBreather;

        public WorldParcelPlan(
            string id,
            string variantId,
            WorldParcelKind kind,
            WorldEnvelopeKind envelope,
            WorldFormationArchetype formation,
            float worldStartDistance,
            float startDistance,
            float length,
            float revealDistance,
            float approachDistance,
            float rearCullDistance,
            TerrainWorldSection[] shoreSections,
            TerrainWorldFeature[] features,
            TerrainRouteSection[] routeSections,
            WorldParcelRoutePlan[] routes,
            WorldThreatPlan threats,
            CargoWavePlan cargo,
            TraversalRequirement requirement = TraversalRequirement.None)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("Parcel id is required.", nameof(id));
            if (string.IsNullOrWhiteSpace(variantId)) throw new ArgumentException("Variant id is required.", nameof(variantId));
            if (worldStartDistance < 0f || startDistance < worldStartDistance || length <= 0f)
                throw new ArgumentOutOfRangeException(nameof(length));
            if (revealDistance <= approachDistance || approachDistance <= 0f)
                throw new ArgumentOutOfRangeException(nameof(revealDistance));
            if (rearCullDistance <= 0f) throw new ArgumentOutOfRangeException(nameof(rearCullDistance));
            if (shoreSections == null || features == null || routeSections == null || routes == null)
                throw new ArgumentNullException(nameof(features));
            if (envelope == WorldEnvelopeKind.None && shoreSections.Length != 0)
                throw new ArgumentException("Envelope=None cannot carry shore topology.", nameof(shoreSections));
            if (kind == WorldParcelKind.OpenWaterBreather
                && (envelope != WorldEnvelopeKind.None
                    || features.Length != 0
                    || routeSections.Length != 0
                    || threats.Kind != WorldThreatKind.None
                    || cargo == null
                    || cargo.CollectibleCount != 0))
                throw new ArgumentException("A breather must be physically empty.", nameof(kind));

            _shoreSections = (TerrainWorldSection[])shoreSections.Clone();
            _features = (TerrainWorldFeature[])features.Clone();
            _routeSections = (TerrainRouteSection[])routeSections.Clone();
            _routes = (WorldParcelRoutePlan[])routes.Clone();
            for (int i = 0; i < _shoreSections.Length; i++)
                EnsureLocalInside(_shoreSections[i].Distance, nameof(shoreSections));
            for (int i = 0; i < _features.Length; i++)
                EnsureLocalInside(_features[i].Distance, nameof(features));
            for (int i = 0; i < _routeSections.Length; i++)
                EnsureLocalInside(_routeSections[i].Distance, nameof(routeSections));
            for (int routeIndex = 0; routeIndex < _routes.Length; routeIndex++)
                for (int pointIndex = 0; pointIndex < _routes[routeIndex].PointCount; pointIndex++)
                    EnsureAbsoluteInside(_routes[routeIndex].GetPoint(pointIndex).Distance, nameof(routes));
            if (cargo != null
                && (cargo.StartDistance < startDistance - .01f
                    || cargo.EndDistance > startDistance + length + .01f))
                throw new ArgumentException("Parcel cargo must remain inside the parcel.", nameof(cargo));

            Id = id;
            VariantId = variantId;
            Kind = kind;
            Envelope = envelope;
            Formation = formation;
            WorldStartDistance = worldStartDistance;
            StartDistance = startDistance;
            Length = length;
            RevealDistance = revealDistance;
            ApproachDistance = approachDistance;
            RearCullDistance = rearCullDistance;
            Threats = threats;
            Cargo = cargo;
            Requirement = requirement;

            void EnsureLocalInside(float distance, string parameter)
            {
                float localStart = startDistance - worldStartDistance;
                if (distance < localStart - .01f || distance > localStart + length + .01f)
                    throw new ArgumentException("Parcel content lies outside its finite bounds.", parameter);
            }

            void EnsureAbsoluteInside(float distance, string parameter)
            {
                if (distance < startDistance - .01f || distance > startDistance + length + .01f)
                    throw new ArgumentException("Parcel route lies outside its finite bounds.", parameter);
            }
        }

        public TerrainWorldSection GetShoreSection(int index) => index >= 0 && index < _shoreSections.Length
            ? _shoreSections[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public TerrainWorldFeature GetFeature(int index) => index >= 0 && index < _features.Length
            ? _features[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public TerrainRouteSection GetRouteSection(int index) => index >= 0 && index < _routeSections.Length
            ? _routeSections[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public WorldParcelRoutePlan GetRoute(int index) => index >= 0 && index < _routes.Length
            ? _routes[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public bool TryGetRoute(CargoWaveRouteRole role, out WorldParcelRoutePlan route)
        {
            for (int i = 0; i < _routes.Length; i++)
            {
                if (_routes[i].Role != role) continue;
                route = _routes[i];
                return true;
            }
            route = null;
            return false;
        }
    }

    public sealed class WorldParcelSequencePlan
    {
        readonly WorldParcelPlan[] _parcels;

        public string Id { get; }
        public int Seed { get; }
        public float StartDistance { get; }
        public float EndDistance { get; }
        public int ParcelCount => _parcels.Length;

        public WorldParcelSequencePlan(
            string id,
            int seed,
            float startDistance,
            float endDistance,
            WorldParcelPlan[] parcels)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("Sequence id is required.", nameof(id));
            if (startDistance < 0f || endDistance <= startDistance)
                throw new ArgumentOutOfRangeException(nameof(endDistance));
            if (parcels == null || parcels.Length < 3)
                throw new ArgumentException("A world sentence needs multiple parcels.", nameof(parcels));
            _parcels = (WorldParcelPlan[])parcels.Clone();
            float priorEnd = startDistance;
            for (int i = 0; i < _parcels.Length; i++)
            {
                WorldParcelPlan parcel = _parcels[i];
                if (Math.Abs(parcel.StartDistance - priorEnd) > .01f)
                    throw new ArgumentException("Parcels must form a contiguous sentence.", nameof(parcels));
                priorEnd = parcel.EndDistance;
            }
            if (Math.Abs(priorEnd - endDistance) > .01f)
                throw new ArgumentException("Parcel sentence does not cover its world.", nameof(parcels));
            Id = id;
            Seed = seed;
            StartDistance = startDistance;
            EndDistance = endDistance;
        }

        public WorldParcelPlan GetParcel(int index) => index >= 0 && index < _parcels.Length
            ? _parcels[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public int FindParcelIndex(float runDistance)
        {
            if (runDistance <= StartDistance) return 0;
            for (int i = 0; i < _parcels.Length; i++)
                if (runDistance < _parcels[i].EndDistance) return i;
            return _parcels.Length - 1;
        }
    }

    public readonly struct WorldParcelValidation
    {
        public bool Ordered { get; }
        public bool BreathersAreEmpty { get; }
        public bool BreathersSeparateMajorWaves { get; }
        public bool RoutesArePhysical { get; }
        public bool VariantsDoNotRepeat { get; }
        public bool IsValid => Ordered && BreathersAreEmpty && BreathersSeparateMajorWaves
            && RoutesArePhysical && VariantsDoNotRepeat;

        public WorldParcelValidation(
            bool ordered,
            bool breathersAreEmpty,
            bool breathersSeparateMajorWaves,
            bool routesArePhysical,
            bool variantsDoNotRepeat)
        {
            Ordered = ordered;
            BreathersAreEmpty = breathersAreEmpty;
            BreathersSeparateMajorWaves = breathersSeparateMajorWaves;
            RoutesArePhysical = routesArePhysical;
            VariantsDoNotRepeat = variantsDoNotRepeat;
        }
    }

    public sealed class WorldParcelValidator
    {
        public WorldParcelValidation Validate(
            WorldParcelSequencePlan sequence,
            ShipCapabilityProfile capability,
            float forwardSpeed)
        {
            if (sequence == null) throw new ArgumentNullException(nameof(sequence));
            if (forwardSpeed <= 0f) throw new ArgumentOutOfRangeException(nameof(forwardSpeed));
            bool ordered = true;
            bool emptyBreathers = true;
            bool separated = true;
            bool physicalRoutes = true;
            bool variants = true;
            float priorEnd = sequence.StartDistance;
            string priorMajorVariant = string.Empty;
            for (int i = 0; i < sequence.ParcelCount; i++)
            {
                WorldParcelPlan parcel = sequence.GetParcel(i);
                ordered &= Math.Abs(parcel.StartDistance - priorEnd) <= .01f;
                priorEnd = parcel.EndDistance;
                if (parcel.IsBreather)
                {
                    emptyBreathers &= parcel.Envelope == WorldEnvelopeKind.None
                        && parcel.ShoreSectionCount == 0
                        && parcel.FeatureCount == 0
                        && parcel.RouteSectionCount == 0
                        && parcel.Threats.Kind == WorldThreatKind.None
                        && parcel.Cargo != null
                        && parcel.Cargo.CollectibleCount == 0;
                    continue;
                }
                if (i > 0 && !sequence.GetParcel(i - 1).IsBreather) separated = false;
                if (!string.IsNullOrEmpty(priorMajorVariant))
                    variants &= priorMajorVariant != parcel.VariantId;
                priorMajorVariant = parcel.VariantId;
                physicalRoutes &= HasReachableSafeRoute(parcel, capability, forwardSpeed);
            }
            return new WorldParcelValidation(ordered, emptyBreathers, separated, physicalRoutes, variants);
        }

        internal static bool HasReachableSafeRoute(
            WorldParcelPlan parcel,
            ShipCapabilityProfile capability,
            float forwardSpeed)
        {
            if (!parcel.TryGetRoute(CargoWaveRouteRole.Safe, out WorldParcelRoutePlan safe)) return false;
            float priorX = safe.GetPoint(0).CenterX;
            float priorDistance = safe.GetPoint(0).Distance;
            for (int i = 0; i < safe.PointCount; i++)
            {
                CargoWaveRoutePoint point = safe.GetPoint(i);
                if (point.HalfWidth <= capability.CollisionHalfWidth + .35f) return false;
                if (i > 0)
                {
                    float travelTime = (point.Distance - priorDistance) / forwardSpeed;
                    float available = capability.MaximumLateralVelocity * Math.Max(0f, travelTime)
                        + .5f * capability.LateralAcceleration * travelTime * travelTime;
                    if (Math.Abs(point.CenterX - priorX) > available + 1f) return false;
                }
                priorX = point.CenterX;
                priorDistance = point.Distance;
            }
            return true;
        }
    }

    public readonly struct WorldParcelRuntimeState
    {
        public WorldParcelPlan Previous { get; }
        public WorldParcelLifecycle PreviousLifecycle { get; }
        public WorldParcelPlan Active { get; }
        public WorldParcelLifecycle ActiveLifecycle { get; }
        public WorldParcelPlan Next { get; }
        public WorldParcelLifecycle NextLifecycle { get; }

        internal WorldParcelRuntimeState(
            WorldParcelPlan previous,
            WorldParcelLifecycle previousLifecycle,
            WorldParcelPlan active,
            WorldParcelLifecycle activeLifecycle,
            WorldParcelPlan next,
            WorldParcelLifecycle nextLifecycle)
        {
            Previous = previous;
            PreviousLifecycle = previousLifecycle;
            Active = active;
            ActiveLifecycle = activeLifecycle;
            Next = next;
            NextLifecycle = nextLifecycle;
        }
    }

    /// <summary>Tracks physical parcel handoff while keeping previous geometry alive through rear cull.</summary>
    public sealed class WorldParcelRuntime
    {
        WorldParcelSequencePlan _sequence;
        WorldParcelRuntimeState _snapshot;

        public WorldParcelSequencePlan Sequence => _sequence;
        public WorldParcelRuntimeState Snapshot => _snapshot;

        public void Reset(WorldParcelSequencePlan sequence, float runDistance)
        {
            _sequence = sequence ?? throw new ArgumentNullException(nameof(sequence));
            Sync(runDistance);
        }

        public void Sync(float runDistance)
        {
            if (_sequence == null) return;
            int activeIndex = _sequence.FindParcelIndex(runDistance);
            WorldParcelPlan active = _sequence.GetParcel(activeIndex);
            WorldParcelLifecycle activeLifecycle = runDistance < active.StartDistance
                ? WorldParcelLifecycle.Approach
                : runDistance <= active.EndDistance
                    ? WorldParcelLifecycle.Active
                    : WorldParcelLifecycle.Complete;

            WorldParcelPlan previous = activeIndex > 0 ? _sequence.GetParcel(activeIndex - 1) : null;
            WorldParcelLifecycle previousLifecycle = WorldParcelLifecycle.None;
            if (previous != null)
            {
                if (runDistance <= previous.EndDistance + previous.RearCullDistance)
                    previousLifecycle = WorldParcelLifecycle.PassingBehind;
                else if (runDistance <= previous.EndDistance + previous.RearCullDistance * 1.25f)
                    previousLifecycle = WorldParcelLifecycle.RearCull;
                else previousLifecycle = WorldParcelLifecycle.Complete;
            }

            WorldParcelPlan next = activeIndex + 1 < _sequence.ParcelCount
                ? _sequence.GetParcel(activeIndex + 1)
                : null;
            WorldParcelLifecycle nextLifecycle = WorldParcelLifecycle.None;
            if (next != null)
            {
                if (runDistance < next.StartDistance - next.RevealDistance)
                    nextLifecycle = WorldParcelLifecycle.FullyBuiltHidden;
                else if (runDistance < next.StartDistance - next.ApproachDistance)
                    nextLifecycle = WorldParcelLifecycle.HorizonReveal;
                else nextLifecycle = WorldParcelLifecycle.Approach;
            }
            _snapshot = new WorldParcelRuntimeState(
                previous, previousLifecycle, active, activeLifecycle, next, nextLifecycle);
        }
    }
}
