using System;
using System.Collections.Generic;

namespace JetHorizon.Simulation
{
    public enum TerrainRegionKind
    {
        OpenSea,
        CoastalWeave,
        StormChannel,
        NaturalArch,
        RouteJunction,
        CrystallineCanyon,
        ConvergenceBasin,
        PrismaticReach,
        ExtractionBreather
    }

    /// <summary>
    /// A physical passage through a terrain junction. This is deliberately core
    /// topology rather than a Unity lane or a visual tag: collision, traversal
    /// validation, cargo routing and the renderer all consume the same passages.
    /// </summary>
    public enum TerrainRouteKind
    {
        None,
        SafeCanyon,
        CargoChannel,
        KnifeEdgeTunnel
    }

    public enum TerrainCourseKind
    {
        ThreeHoleApproach,
        InvertedKnifeRun,
        BasinSwitchback,
        StormFrontFork,
        OuterRimSlalom,
        LongKnifePass
    }

    public enum TerrainWorldFeatureKind
    {
        NaturalArch,
        WaterlineMonolith,
        WaterlineRidge,
        WaterlineCluster
    }

    public static class TerrainWorldFeatureRules
    {
        public static bool IsWaterFormation(TerrainWorldFeatureKind kind)
            => kind == TerrainWorldFeatureKind.WaterlineMonolith
                || kind == TerrainWorldFeatureKind.WaterlineRidge
                || kind == TerrainWorldFeatureKind.WaterlineCluster;
    }

    /// <summary>
    /// One cross-section through the actual terrain topology. LeftShoreX and
    /// RightShoreX are world geometry boundaries, not a prescribed player route.
    /// Navigation constraints are derived from these shores after the world exists.
    /// </summary>
    public readonly struct TerrainWorldSection
    {
        public int Id { get; }
        public TerrainRegionKind Region { get; }
        public float Distance { get; }
        public float LeftShoreX { get; }
        public float RightShoreX { get; }
        public float LeftHeight { get; }
        public float RightHeight { get; }
        public float LeftDepth { get; }
        public float RightDepth { get; }
        public float WaterCenterX => (LeftShoreX + RightShoreX) * .5f;
        public float WaterHalfWidth => (RightShoreX - LeftShoreX) * .5f;

        public TerrainWorldSection(
            int id,
            TerrainRegionKind region,
            float distance,
            float leftShoreX,
            float rightShoreX,
            float leftHeight,
            float rightHeight,
            float leftDepth,
            float rightDepth)
        {
            if (id <= 0) throw new ArgumentOutOfRangeException(nameof(id));
            if (distance < 0f) throw new ArgumentOutOfRangeException(nameof(distance));
            if (rightShoreX - leftShoreX <= 8f)
                throw new ArgumentException("Terrain shores must leave navigable water.");
            if (leftHeight <= 0f || rightHeight <= 0f || leftDepth <= 0f || rightDepth <= 0f)
                throw new ArgumentOutOfRangeException(nameof(leftHeight));
            Id = id;
            Region = region;
            Distance = distance;
            LeftShoreX = leftShoreX;
            RightShoreX = rightShoreX;
            LeftHeight = leftHeight;
            RightHeight = rightHeight;
            LeftDepth = leftDepth;
            RightDepth = rightDepth;
        }
    }

    public readonly struct TerrainWorldRegion
    {
        public int Id { get; }
        public TerrainRegionKind Kind { get; }
        public float StartDistance { get; }
        public float Length { get; }
        public float CompletionSpeedReward { get; }
        public float EndDistance => StartDistance + Length;

        public TerrainWorldRegion(
            int id,
            TerrainRegionKind kind,
            float startDistance,
            float length,
            float completionSpeedReward)
        {
            if (id <= 0) throw new ArgumentOutOfRangeException(nameof(id));
            if (startDistance < 0f || length <= 0f) throw new ArgumentOutOfRangeException(nameof(length));
            if (completionSpeedReward < 0f) throw new ArgumentOutOfRangeException(nameof(completionSpeedReward));
            Id = id;
            Kind = kind;
            StartDistance = startDistance;
            Length = length;
            CompletionSpeedReward = completionSpeedReward;
        }
    }

    /// <summary>
    /// One cross-section of one playable passage. Multiple route sections at the
    /// same distance describe the holes in a connected landmass; the unoccupied
    /// intervals are terrain, not invisible gameplay walls.
    /// </summary>
    public readonly struct TerrainRouteSection
    {
        public TerrainRouteKind Kind { get; }
        public float Distance { get; }
        public float LeftX { get; }
        public float RightX { get; }
        public float CeilingHeight { get; }

        public TerrainRouteSection(
            TerrainRouteKind kind,
            float distance,
            float leftX,
            float rightX,
            float ceilingHeight)
        {
            if (kind == TerrainRouteKind.None) throw new ArgumentOutOfRangeException(nameof(kind));
            if (distance < 0f || rightX - leftX <= 8f)
                throw new ArgumentOutOfRangeException(nameof(distance));
            if (ceilingHeight < 0f) throw new ArgumentOutOfRangeException(nameof(ceilingHeight));
            Kind = kind;
            Distance = distance;
            LeftX = leftX;
            RightX = rightX;
            CeilingHeight = ceilingHeight;
        }
    }

    public readonly struct TerrainWorldFeature
    {
        public int Id { get; }
        public TerrainWorldFeatureKind Kind { get; }
        public float Distance { get; }
        public float CenterX { get; }
        public float HalfWidth { get; }
        public float Height { get; }
        public float CollisionHalfDepth { get; }
        public TraversalRequirement Requirement { get; }
        public int Seed { get; }

        public TerrainWorldFeature(
            int id,
            TerrainWorldFeatureKind kind,
            float distance,
            float centerX,
            float halfWidth,
            float height,
            float collisionHalfDepth,
            TraversalRequirement requirement,
            int seed)
        {
            if (id <= 0) throw new ArgumentOutOfRangeException(nameof(id));
            if (distance < 0f || halfWidth <= 0f || height <= 0f || collisionHalfDepth <= 0f)
                throw new ArgumentOutOfRangeException(nameof(distance));
            Id = id;
            Kind = kind;
            Distance = distance;
            CenterX = centerX;
            HalfWidth = halfWidth;
            Height = height;
            CollisionHalfDepth = collisionHalfDepth;
            Requirement = requirement;
            Seed = seed;
        }
    }

    public sealed class TerrainWorldPlan
    {
        readonly TerrainWorldRegion[] _regions;
        readonly TerrainWorldSection[] _sections;
        readonly TerrainWorldFeature[] _features;
        readonly TerrainRouteSection[] _routeSections;

        public string Id { get; }
        public int Sector { get; }
        public TerrainCourseKind Course { get; }
        public float StartDistance { get; }
        public float Length { get; }
        public float EndDistance => StartDistance + Length;
        public int RegionCount => _regions.Length;
        public int SectionCount => _sections.Length;
        public int FeatureCount => _features.Length;
        public int RouteSectionCount => _routeSections.Length;

        public TerrainWorldPlan(
            string id,
            int sector,
            float startDistance,
            float length,
            TerrainWorldRegion[] regions,
            TerrainWorldSection[] sections,
            TerrainWorldFeature[] features,
            TerrainRouteSection[] routeSections = null,
            TerrainCourseKind course = TerrainCourseKind.ThreeHoleApproach)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("World id is required.", nameof(id));
            if (sector < 0 || startDistance < 0f || length <= 0f) throw new ArgumentOutOfRangeException(nameof(length));
            if (regions == null || regions.Length < 3) throw new ArgumentException("Terrain world needs regions.", nameof(regions));
            if (sections == null || sections.Length < 8) throw new ArgumentException("Terrain world needs cross-sections.", nameof(sections));
            if (features == null) throw new ArgumentNullException(nameof(features));

            _regions = (TerrainWorldRegion[])regions.Clone();
            _sections = (TerrainWorldSection[])sections.Clone();
            _features = (TerrainWorldFeature[])features.Clone();
            _routeSections = routeSections == null
                ? Array.Empty<TerrainRouteSection>()
                : (TerrainRouteSection[])routeSections.Clone();
            float previousEnd = 0f;
            for (int i = 0; i < _regions.Length; i++)
            {
                if (i > 0 && _regions[i].StartDistance < previousEnd)
                    throw new ArgumentException("Terrain regions cannot overlap.", nameof(regions));
                if (_regions[i].EndDistance > length + .01f)
                    throw new ArgumentException("Terrain region exceeds world length.", nameof(regions));
                previousEnd = _regions[i].EndDistance;
            }
            float priorDistance = -1f;
            for (int i = 0; i < _sections.Length; i++)
            {
                if (_sections[i].Distance <= priorDistance || _sections[i].Distance > length)
                    throw new ArgumentException("Terrain sections must be strictly ordered inside the world.", nameof(sections));
                priorDistance = _sections[i].Distance;
            }
            for (int i = 0; i < _routeSections.Length; i++)
            {
                TerrainRouteSection route = _routeSections[i];
                if (route.Distance > length)
                    throw new ArgumentException("Terrain route exceeds world length.", nameof(routeSections));
            }
            Id = id;
            Sector = sector;
            Course = course;
            StartDistance = startDistance;
            Length = length;
        }

        public TerrainWorldRegion GetRegion(int index) => index >= 0 && index < _regions.Length
            ? _regions[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public TerrainWorldSection GetSection(int index) => index >= 0 && index < _sections.Length
            ? _sections[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public TerrainWorldFeature GetFeature(int index) => index >= 0 && index < _features.Length
            ? _features[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public TerrainRouteSection GetRouteSection(int index) => index >= 0 && index < _routeSections.Length
            ? _routeSections[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public bool HasRoutePassagesAt(float distance)
        {
            for (int i = 0; i < _routeSections.Length; i++)
                if (Math.Abs(_routeSections[i].Distance - distance) < .01f
                    || TryGetRoutePassage(_routeSections[i].Kind, distance, out _, out _, out _))
                    return true;
            return false;
        }

        public bool TryGetRoutePassage(
            TerrainRouteKind kind,
            float distance,
            out float leftX,
            out float rightX,
            out float ceilingHeight)
        {
            int first = -1;
            int previous = -1;
            int next = -1;
            for (int i = 0; i < _routeSections.Length; i++)
            {
                TerrainRouteSection section = _routeSections[i];
                if (section.Kind != kind) continue;
                if (first < 0) first = i;
                if (section.Distance <= distance) previous = i;
                if (section.Distance >= distance)
                {
                    next = i;
                    break;
                }
            }
            if (first < 0 || previous < 0 || next < 0)
            {
                leftX = rightX = ceilingHeight = 0f;
                return false;
            }
            TerrainRouteSection a = _routeSections[previous];
            TerrainRouteSection b = _routeSections[next];
            float t = previous == next ? 0f : Math.Max(0f, Math.Min(1f,
                (distance - a.Distance) / Math.Max(.001f, b.Distance - a.Distance)));
            leftX = a.LeftX + (b.LeftX - a.LeftX) * t;
            rightX = a.RightX + (b.RightX - a.RightX) * t;
            ceilingHeight = a.CeilingHeight + (b.CeilingHeight - a.CeilingHeight) * t;
            return true;
        }
    }

    public readonly struct TerrainWorldValidation
    {
        public EncounterValidationResult Navigation { get; }
        public TraversalEnvelopeResult Traversal { get; }
        public bool RegionCoverageValid { get; }
        public bool TopologyValid { get; }
        public bool IsValid => Navigation.Reachable
            && Traversal.IsAdmissible
            && RegionCoverageValid
            && TopologyValid;

        public TerrainWorldValidation(
            EncounterValidationResult navigation,
            TraversalEnvelopeResult traversal,
            bool regionCoverageValid,
            bool topologyValid)
        {
            Navigation = navigation;
            Traversal = traversal;
            RegionCoverageValid = regionCoverageValid;
            TopologyValid = topologyValid;
        }
    }

    /// <summary>
    /// Validates navigation after terrain topology has been authored. The validator
    /// never places terrain and cannot mutate the world to manufacture a route.
    /// </summary>
    public sealed class TerrainWorldValidator
    {
        public TerrainWorldValidation Validate(
            TerrainWorldPlan world,
            ShipCapabilityProfile capability,
            int heat)
        {
            if (world == null) throw new ArgumentNullException(nameof(world));
            float maximumForwardSpeed = TerrainWorldPaceRules.MaximumSpeedForHeat(heat);
            ShipCapabilityProfile maximumSpeedCapability = capability.AtCruiseSpeed(maximumForwardSpeed);
            // The first section anchors the world's starting cross-section at
            // distance zero. Navigation validation begins at the next authored
            // section so the validator has real travel time before its first target.
            var derivedWater = new EncounterOpening[world.SectionCount - 1];
            for (int i = 0; i < derivedWater.Length; i++)
            {
                TerrainWorldSection section = world.GetSection(i + 1);
                TraversalRequirement requirement = TraversalRequirement.None;
                for (int featureIndex = 0; featureIndex < world.FeatureCount; featureIndex++)
                {
                    TerrainWorldFeature feature = world.GetFeature(featureIndex);
                    if (Math.Abs(feature.Distance - section.Distance) < .01f)
                    {
                        requirement = feature.Requirement;
                        break;
                    }
                }
                derivedWater[i] = new EncounterOpening(
                    section.Distance,
                    section.WaterCenterX,
                    section.WaterHalfWidth,
                    traversalRequirement: requirement);
            }
            var contract = new EncounterCapabilityContract(20f, 240f, .25f, .35f, 0, 5);
            var navigationPlan = new EncounterPlan(
                world.Id + ".derived-navigation",
                EncounterKind.MonumentalBroadWeave,
                world.Length,
                1f,
                contract,
                derivedWater);
            EncounterValidationResult navigation = new EncounterCapabilityValidator().Validate(
                navigationPlan,
                maximumSpeedCapability,
                heat);
            TraversalEnvelopeResult traversal = new TraversalEnvelopeValidator().Validate(
                world,
                capability,
                maximumForwardSpeed);
            bool regionsValid = world.GetRegion(0).Kind == TerrainRegionKind.OpenSea
                && world.GetRegion(world.RegionCount - 1).Kind == TerrainRegionKind.ExtractionBreather;
            bool topologyValid = true;
            for (int i = 0; i < world.SectionCount; i++)
            {
                TerrainWorldSection section = world.GetSection(i);
                if (section.WaterHalfWidth <= capability.CollisionHalfWidth + .35f)
                {
                    topologyValid = false;
                    break;
                }
            }
            float requiredFormationPassage = capability.CollisionHalfWidth * 2f + 4f;
            for (int i = 0; topologyValid && i < world.FeatureCount; i++)
            {
                TerrainWorldFeature feature = world.GetFeature(i);
                if (!TerrainWorldFeatureRules.IsWaterFormation(feature.Kind)) continue;
                SampleShore(world, feature.Distance, out float leftShore, out float rightShore);
                float leftPassage = feature.CenterX - feature.HalfWidth - leftShore;
                float rightPassage = rightShore - feature.CenterX - feature.HalfWidth;
                topologyValid = Math.Max(leftPassage, rightPassage) >= requiredFormationPassage;
            }
            return new TerrainWorldValidation(navigation, traversal, regionsValid, topologyValid);
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
    }

    public static class TerrainWorldCatalog
    {
        public static TerrainWorldPlan CreateProofWorld(
            int sector,
            float startDistance,
            ShipCapabilityProfile capability)
        {
            int heat = Math.Max(0, Math.Min(5, sector));
            float mirror = (sector & 1) == 0 ? 1f : -1f;
            // Six authored course archetypes rotate with a changing offset each
            // circuit. There is no one-world loop hidden behind new random seeds.
            int courseCircuit = Math.Max(0, sector) / 6;
            int courseIndex = (Math.Max(0, sector) + courseCircuit * 2) % 6;
            int layout = courseIndex % 3;
            TerrainCourseKind course = (TerrainCourseKind)courseIndex;
            float designSpeed = TerrainWorldPaceRules.MaximumSpeedForHeat(heat);
            const float openWaterReturnStart = 3190f;
            const float openWaterReturnLength = 430f;
            const float breatherLength = 500f;
            const float breatherStart = openWaterReturnStart + openWaterReturnLength;
            float worldLength = breatherStart + breatherLength;
            // One complete world sentence: a genuine open-water breather, a
            // coastline approach, a monumental three-hole formation, distinct
            // passages, a convergence basin, then water again. Layout only mirrors
            // and lightly varies the geography; it never changes the contract.
            TerrainWorldRegion[] regions = layout == 1
                ? new[]
                {
                    new TerrainWorldRegion(1, TerrainRegionKind.OpenSea,          0f, 620f, 0f),
                    new TerrainWorldRegion(2, TerrainRegionKind.CoastalWeave,   620f, 300f, 6f),
                    new TerrainWorldRegion(3, TerrainRegionKind.StormChannel,   920f, 300f, 5f),
                    new TerrainWorldRegion(4, TerrainRegionKind.NaturalArch,   1220f, 200f, 4f),
                    new TerrainWorldRegion(5, TerrainRegionKind.RouteJunction, 1420f, 430f, 7f),
                    new TerrainWorldRegion(6, TerrainRegionKind.CrystallineCanyon, 1850f, 1020f, 12f),
                    new TerrainWorldRegion(7, TerrainRegionKind.ConvergenceBasin, 2870f, 320f, 7f),
                    new TerrainWorldRegion(8, TerrainRegionKind.OpenSea, openWaterReturnStart, openWaterReturnLength, 5f),
                    new TerrainWorldRegion(9, TerrainRegionKind.ExtractionBreather, breatherStart, breatherLength, 0f)
                }
                : layout == 2
                ? new[]
                {
                    new TerrainWorldRegion(1, TerrainRegionKind.OpenSea,          0f, 300f, 0f),
                    new TerrainWorldRegion(2, TerrainRegionKind.StormChannel,   300f, 240f, 5f),
                    new TerrainWorldRegion(3, TerrainRegionKind.CoastalWeave,   540f, 680f, 6f),
                    new TerrainWorldRegion(4, TerrainRegionKind.NaturalArch,   1220f, 200f, 4f),
                    new TerrainWorldRegion(5, TerrainRegionKind.RouteJunction, 1420f, 430f, 7f),
                    new TerrainWorldRegion(6, TerrainRegionKind.CrystallineCanyon, 1850f, 1020f, 12f),
                    new TerrainWorldRegion(7, TerrainRegionKind.ConvergenceBasin, 2870f, 320f, 7f),
                    new TerrainWorldRegion(8, TerrainRegionKind.OpenSea, openWaterReturnStart, openWaterReturnLength, 5f),
                    new TerrainWorldRegion(9, TerrainRegionKind.ExtractionBreather, breatherStart, breatherLength, 0f)
                }
                : new[]
            {
                new TerrainWorldRegion(1, TerrainRegionKind.OpenSea,          0f, 420f, 0f),
                new TerrainWorldRegion(2, TerrainRegionKind.CoastalWeave,   420f, 500f, 6f),
                new TerrainWorldRegion(3, TerrainRegionKind.StormChannel,   920f, 300f, 5f),
                new TerrainWorldRegion(4, TerrainRegionKind.NaturalArch,   1220f, 200f, 4f),
                new TerrainWorldRegion(5, TerrainRegionKind.RouteJunction, 1420f, 430f, 7f),
                new TerrainWorldRegion(6, TerrainRegionKind.CrystallineCanyon, 1850f, 1020f, 12f),
                new TerrainWorldRegion(7, TerrainRegionKind.ConvergenceBasin, 2870f, 320f, 7f),
                new TerrainWorldRegion(8, TerrainRegionKind.OpenSea,
                    openWaterReturnStart, openWaterReturnLength, 5f),
                new TerrainWorldRegion(9, TerrainRegionKind.ExtractionBreather,
                    breatherStart, breatherLength, 0f)
            };
            var sections = new List<TerrainWorldSection>(48);
            int id = 1000;
            float comfortableSlope = TraversalEnvelopeRules.ComfortableSlope(capability, designSpeed);
            float comfortableCurvature = TraversalEnvelopeRules.ComfortableCurvature(capability, designSpeed);
            float previousAuthoredCenter = 0f;
            float previousAuthoredDistance = 0f;
            float previousAuthoredSlope = 0f;

            TerrainRegionKind RegionAt(float distance)
            {
                for (int regionIndex = 0; regionIndex < regions.Length; regionIndex++)
                    if (distance < regions[regionIndex].EndDistance + .01f)
                        return regions[regionIndex].Kind;
                return regions[regions.Length - 1].Kind;
            }

            void Shore(
                float distance,
                TerrainRegionKind _,
                float left,
                float right,
                float leftHeight,
                float rightHeight,
                float depth = 150f)
            {
                if (distance >= 420f && distance < 1220f)
                {
                    float center = (left + right) * .5f;
                    float halfWidth = (right - left) * .5f;
                    if (layout == 1)
                    {
                        center += (float)Math.Sin(distance * .0071f + .4f) * 11f;
                        halfWidth += (float)Math.Sin(distance * .0049f + 1.1f) * 4f;
                        leftHeight *= .88f;
                        rightHeight *= 1.12f;
                    }
                    else if (layout == 2)
                    {
                        center += (float)Math.Sin(distance * .0048f - .7f) * 15f;
                        halfWidth += (float)Math.Sin(distance * .0082f - .2f) * 5f;
                        leftHeight *= 1.15f;
                        rightHeight *= .86f;
                    }
                    left = center - Math.Max(22f, halfWidth);
                    right = center + Math.Max(22f, halfWidth);
                }
                float worldLeft = mirror > 0f ? left : -right;
                float worldRight = mirror > 0f ? right : -left;
                float desiredCenter = (worldLeft + worldRight) * .5f;
                float authoredHalfWidth = (worldRight - worldLeft) * .5f;
                if (distance > previousAuthoredDistance)
                {
                    float dz = distance - previousAuthoredDistance;
                    float desiredSlope = (desiredCenter - previousAuthoredCenter) / dz;
                    desiredSlope = Math.Max(-comfortableSlope, Math.Min(comfortableSlope, desiredSlope));
                    float maximumSlopeChange = comfortableCurvature * dz;
                    float slope = Math.Max(
                        previousAuthoredSlope - maximumSlopeChange,
                        Math.Min(previousAuthoredSlope + maximumSlopeChange, desiredSlope));
                    desiredCenter = previousAuthoredCenter + slope * dz;
                    previousAuthoredSlope = slope;
                }
                previousAuthoredCenter = desiredCenter;
                previousAuthoredDistance = distance;
                worldLeft = desiredCenter - authoredHalfWidth;
                worldRight = desiredCenter + authoredHalfWidth;
                float worldLeftHeight = mirror > 0f ? leftHeight : rightHeight;
                float worldRightHeight = mirror > 0f ? rightHeight : leftHeight;
                sections.Add(new TerrainWorldSection(
                    id++, RegionAt(distance), distance, worldLeft, worldRight,
                    worldLeftHeight, worldRightHeight, depth, depth));
            }

            Shore(   0f, TerrainRegionKind.OpenSea,       -150f, 150f, 10f, 11f, 180f);
            Shore( 220f, TerrainRegionKind.OpenSea,       -145f, 140f, 11f, 12f, 180f);
            Shore( 420f, TerrainRegionKind.CoastalWeave,  -132f, 130f, 16f, 18f, 175f);
            Shore( 540f, TerrainRegionKind.CoastalWeave,   -98f, 100f, 26f, 29f, 170f);
            Shore( 680f, TerrainRegionKind.CoastalWeave,   -84f,  92f, 35f, 38f, 165f);
            Shore( 820f, TerrainRegionKind.CoastalWeave,   -88f,  86f, 42f, 39f, 160f);
            Shore( 920f, TerrainRegionKind.StormChannel,   -96f,  94f, 45f, 48f, 160f);
            Shore(1080f, TerrainRegionKind.StormChannel,   -90f,  92f, 51f, 48f, 155f);
            Shore(1220f, TerrainRegionKind.NaturalArch,    -96f,  96f, 61f, 64f, 150f);
            Shore(1320f, TerrainRegionKind.NaturalArch,   -102f, 100f, 70f, 68f, 150f);
            Shore(1420f, TerrainRegionKind.RouteJunction, -104f, 104f, 78f, 76f, 150f);
            Shore(1540f, TerrainRegionKind.RouteJunction,  -98f,  98f, 84f, 82f, 150f);
            Shore(1660f, TerrainRegionKind.RouteJunction,  -94f,  94f, 88f, 86f, 150f);

            // The outer shoreline stays broad while the route sections below carve
            // holes through the inside of this landmass. That is the difference
            // between a canyon that exists in the world and props placed on water.
            for (int i = 0; i <= 8; i++)
            {
                float t = i / 8f;
                float distance = 1800f + t * 1070f;
                float center = (float)Math.Sin(t * Math.PI * (1.15f + layout * .08f)
                    + layout * .37f) * 8f * mirror;
                float halfWidth = 94f - (float)Math.Sin(t * Math.PI) * 7f;
                float heightWave = (float)Math.Sin(t * Math.PI * 2.1f + .4f) * 8f;
                TerrainRegionKind region = distance < 1850f
                    ? TerrainRegionKind.RouteJunction
                    : distance < 2870f
                        ? TerrainRegionKind.CrystallineCanyon
                        : TerrainRegionKind.ConvergenceBasin;
                Shore(distance, region,
                    center - halfWidth, center + halfWidth,
                    86f + heightWave, 89f - heightWave * .55f, 155f);
            }

            // A true release basin: walls fall away before the open-water region,
            // so a route exit reads as daylight and horizon returning, not another
            // arbitrary gap between scrolling canyon pieces.
            Shore(3000f, TerrainRegionKind.ConvergenceBasin,
                -118f, 120f, 45f, 47f, 165f);
            Shore(3100f, TerrainRegionKind.ConvergenceBasin,
                -138f, 140f, 24f, 27f, 175f);
            Shore(openWaterReturnStart, TerrainRegionKind.OpenSea,
                -148f, 150f, 12f, 14f, 180f);
            for (int i = 1; i <= 4; i++)
            {
                float t = i / 5f;
                float distance = openWaterReturnStart + openWaterReturnLength * t;
                float center = (float)Math.Sin(t * Math.PI * 1.4 + .25f) * 4f;
                float halfWidth = 48f + t * 20f;
                Shore(distance, TerrainRegionKind.OpenSea,
                    center - halfWidth, center + halfWidth,
                    35f - t * 10f, 37f - t * 10f, 160f + t * 5f);
            }
            Shore(breatherStart, TerrainRegionKind.ExtractionBreather,
                -82f, 84f, 21f, 23f, 170f);
            Shore(breatherStart + 160f, TerrainRegionKind.ExtractionBreather,
                -122f, 126f, 15f, 17f, 175f);
            Shore(breatherStart + 340f, TerrainRegionKind.ExtractionBreather,
                -150f, 150f, 10f, 11f, 180f);
            Shore(worldLength, TerrainRegionKind.ExtractionBreather,
                -150f, 150f, 10f, 11f, 180f);

            // This is a route graph, not a lane hint. At every sampled distance
            // these three intervals are literal holes through one connected wall of
            // terrain. Safe is broad, Cargo curves deeper into the landmass, and
            // Knife is the narrow L3-inspired tunnel with a low faceted crown.
            float[] routeDistances =
            {
                1420f, 1540f, 1660f, 1800f, 1960f, 2120f,
                2280f, 2440f, 2600f, 2760f, 2870f
            };
            float[] safeCenters =
            {
                -52f, -53f, -55f, -57f, -58f, -55f,
                -51f, -48f, -47f, -49f, -52f
            };
            float[] cargoCenters =
            {
                52f, 53f, 56f, 59f, 61f, 58f,
                54f, 50f, 48f, 49f, 52f
            };
            float[] knifeCenters =
            {
                0f, 2f, 5f, 8f, 11f, 12f,
                12f, 11f, 9f, 5f, 0f
            };
            float[] outerHalves =
            {
                52f, 31f, 27f, 24f, 22f, 21f,
                21f, 22f, 24f, 31f, 52f
            };
            float[] knifeHalves =
            {
                36f, 24f, 17f, 12f, 9.5f, 9.5f,
                9.5f, 9.5f, 12f, 24f, 36f
            };
            float[] knifeCeilings =
            {
                0f, 0f, 26f, 35f, 41f, 43f,
                43f, 41f, 35f, 26f, 0f
            };
            // Courses are authored variations, not seed noise. The opening rhythm
            // above changes by course; here the same connected formation offers a
            // different steering sentence and a different knife-side commitment.
            if (layout == 1)
            {
                for (int i = 0; i < routeDistances.Length; i++)
                {
                    float sway = (float)Math.Sin(i * .68f + .25f) * 5f;
                    safeCenters[i] -= sway;
                    cargoCenters[i] += sway * .85f;
                }
            }
            else if (layout == 2)
            {
                for (int i = 0; i < routeDistances.Length; i++)
                {
                    float t = i / (float)(routeDistances.Length - 1);
                    float switchback = (float)Math.Sin(t * Math.PI * 1.35f + .35f) * 6f;
                    knifeCenters[i] -= switchback;
                    safeCenters[i] += switchback * .70f;
                    cargoCenters[i] -= switchback * .90f;
                }
            }
            if (courseIndex == 3)
            {
                for (int i = 0; i < routeDistances.Length; i++)
                {
                    float stormSway = (float)Math.Sin(i * .52f + .45f) * 5f;
                    safeCenters[i] += stormSway;
                    cargoCenters[i] += stormSway * .45f;
                    knifeCenters[i] += stormSway * .35f;
                }
            }
            else if (courseIndex == 4)
            {
                for (int i = 0; i < routeDistances.Length; i++)
                {
                    float t = i / (float)(routeDistances.Length - 1);
                    float rimArc = (float)Math.Sin(t * Math.PI) * 9f;
                    safeCenters[i] -= rimArc;
                    cargoCenters[i] -= rimArc * .35f;
                    knifeCenters[i] += rimArc * .30f;
                }
            }
            else if (courseIndex == 5)
            {
                for (int i = 0; i < routeDistances.Length; i++)
                {
                    float t = i / (float)(routeDistances.Length - 1);
                    knifeCenters[i] += (float)Math.Sin(t * Math.PI * 1.1f) * 5f;
                    knifeCeilings[i] = Math.Min(48f, knifeCeilings[i] + 4f * (float)Math.Sin(t * Math.PI));
                }
            }
            var routeSections = new List<TerrainRouteSection>(routeDistances.Length * 3);
            void AddRoute(TerrainRouteKind kind, float[] centers, float[] halves, float[] ceilings)
            {
                for (int routeIndex = 0; routeIndex < routeDistances.Length; routeIndex++)
                {
                    float center = centers[routeIndex] * mirror;
                    routeSections.Add(new TerrainRouteSection(
                        kind,
                        routeDistances[routeIndex],
                        center - halves[routeIndex],
                        center + halves[routeIndex],
                        ceilings[routeIndex]));
                }
            }
            AddRoute(TerrainRouteKind.SafeCanyon, safeCenters, outerHalves, new float[routeDistances.Length]);
            AddRoute(TerrainRouteKind.KnifeEdgeTunnel, knifeCenters, knifeHalves, knifeCeilings);
            AddRoute(TerrainRouteKind.CargoChannel, cargoCenters, outerHalves, new float[routeDistances.Length]);

            var features = new List<TerrainWorldFeature>(8)
            {
                new TerrainWorldFeature(
                    500,
                    TerrainWorldFeatureKind.NaturalArch,
                    1360f,
                    -8f * mirror,
                    32f,
                    74f,
                    18f,
                    // Presentation currently places the crown above the ship. Do not
                    // attach an abstract roll-only collision plane to visible open air.
                    TraversalRequirement.None,
                    401 + sector * 47)
            };

            void SampleAuthoredShore(float distance, out float left, out float right)
            {
                int sectionIndex = 0;
                while (sectionIndex < sections.Count - 1
                    && distance >= sections[sectionIndex + 1].Distance)
                    sectionIndex++;
                TerrainWorldSection a = sections[sectionIndex];
                if (sectionIndex >= sections.Count - 1)
                {
                    left = a.LeftShoreX;
                    right = a.RightShoreX;
                    return;
                }
                TerrainWorldSection b = sections[sectionIndex + 1];
                float sectionT = Math.Max(0f, Math.Min(1f,
                    (distance - a.Distance) / Math.Max(.001f, b.Distance - a.Distance)));
                left = a.LeftShoreX + (b.LeftShoreX - a.LeftShoreX) * sectionT;
                right = a.RightShoreX + (b.RightShoreX - a.RightShoreX) * sectionT;
            }

            // Formation cadence is authored in seconds, then converted to world
            // distance using this sector's actual maximum speed. Side-attached
            // masses overlap the shoreline and alternate their inner tips around
            // the route, producing readable terrain weaves instead of loose props.
            float[] beatSeconds = layout == 0
                ? new[] { 1.80f, 2.90f, 4.00f, 5.15f, 6.25f, 7.40f, 8.55f }
                : layout == 1
                ? new[] { 1.90f, 3.00f, 4.15f, 5.20f, 6.35f, 7.45f, 8.55f }
                : new[] { 2.00f, 3.10f, 4.20f, 5.30f, 6.35f, 7.40f, 8.55f };
            int[] authoredSides = layout == 0
                ? new[] { 1, -1, 1, 0, -1, 1, -1 }
                : layout == 1
                ? new[] { -1, 1, 0, 1, -1, -1, 1 }
                : new[] { 0, 1, -1, 1, 1, -1, 0 };
            TerrainWorldFeatureKind[] kinds = layout == 0
                ? new[]
                {
                    TerrainWorldFeatureKind.WaterlineRidge,
                    TerrainWorldFeatureKind.WaterlineCluster,
                    TerrainWorldFeatureKind.WaterlineMonolith,
                    TerrainWorldFeatureKind.WaterlineCluster,
                    TerrainWorldFeatureKind.WaterlineRidge,
                    TerrainWorldFeatureKind.WaterlineCluster,
                    TerrainWorldFeatureKind.WaterlineRidge
                }
                : layout == 1
                ? new[]
                {
                    TerrainWorldFeatureKind.WaterlineCluster,
                    TerrainWorldFeatureKind.WaterlineRidge,
                    TerrainWorldFeatureKind.WaterlineMonolith,
                    TerrainWorldFeatureKind.WaterlineRidge,
                    TerrainWorldFeatureKind.WaterlineCluster,
                    TerrainWorldFeatureKind.WaterlineMonolith,
                    TerrainWorldFeatureKind.WaterlineRidge
                }
                : new[]
                {
                    TerrainWorldFeatureKind.WaterlineMonolith,
                    TerrainWorldFeatureKind.WaterlineCluster,
                    TerrainWorldFeatureKind.WaterlineRidge,
                    TerrainWorldFeatureKind.WaterlineCluster,
                    TerrainWorldFeatureKind.WaterlineRidge,
                    TerrainWorldFeatureKind.WaterlineMonolith,
                    TerrainWorldFeatureKind.WaterlineCluster
                };
            for (int beat = 0; beat < beatSeconds.Length; beat++)
            {
                float distance = beatSeconds[beat] * designSpeed;
                if (distance > 1400f) continue;
                SampleAuthoredShore(distance, out float leftShore, out float rightShore);
                float waterCenter = (leftShore + rightShore) * .5f;
                int side = authoredSides[beat] * (mirror > 0f ? 1 : -1);
                float center;
                float halfWidth;
                if (side == 0)
                {
                    center = waterCenter;
                    halfWidth = 7.5f + (beat % 3);
                }
                else
                {
                    // Leave a deliberate central transit lane through open-water
                    // formations. The mass remains shoreline-connected, but it no
                    // longer asks a high-speed ship to cross an entire channel in
                    // one one-second cadence beat.
                    float innerTip = waterCenter + side * 18f;
                    float outerEdge = side > 0 ? rightShore + 8f : leftShore - 8f;
                    center = (innerTip + outerEdge) * .5f;
                    halfWidth = Math.Abs(outerEdge - innerTip) * .5f;
                }
                features.Add(new TerrainWorldFeature(
                    501 + beat,
                    kinds[beat],
                    distance,
                    center,
                    halfWidth,
                    34f + (beat % 3) * 7f,
                    10f + (beat % 2) * 2f,
                    TraversalRequirement.None,
                    601 + layout * 400 + beat * 101 + sector * 67));
            }

            var world = new TerrainWorldPlan(
                $"terrain-world-{sector:00}",
                sector,
                startDistance,
                worldLength,
                regions,
                sections.ToArray(),
                features.ToArray(),
                routeSections.ToArray(),
                course);
            // Dense envelope validation is intentionally an authoring/test gate,
            // not work performed inside the live simulation tick. The generator
            // constructs from the same limits, while TerrainWorldArchitectureTests
            // prove every speed/heat template before shipping. This avoids a route
            // search hitch when the next deterministic world is preloaded on mobile.
            return world;
        }
    }
}
