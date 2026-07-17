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
        CrystallineCanyon,
        PrismaticReach,
        ExtractionBreather
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

        public string Id { get; }
        public int Sector { get; }
        public float StartDistance { get; }
        public float Length { get; }
        public float EndDistance => StartDistance + Length;
        public int RegionCount => _regions.Length;
        public int SectionCount => _sections.Length;
        public int FeatureCount => _features.Length;

        public TerrainWorldPlan(
            string id,
            int sector,
            float startDistance,
            float length,
            TerrainWorldRegion[] regions,
            TerrainWorldSection[] sections,
            TerrainWorldFeature[] features)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("World id is required.", nameof(id));
            if (sector < 0 || startDistance < 0f || length <= 0f) throw new ArgumentOutOfRangeException(nameof(length));
            if (regions == null || regions.Length < 3) throw new ArgumentException("Terrain world needs regions.", nameof(regions));
            if (sections == null || sections.Length < 8) throw new ArgumentException("Terrain world needs cross-sections.", nameof(sections));
            if (features == null) throw new ArgumentNullException(nameof(features));

            _regions = (TerrainWorldRegion[])regions.Clone();
            _sections = (TerrainWorldSection[])sections.Clone();
            _features = (TerrainWorldFeature[])features.Clone();
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
            Id = id;
            Sector = sector;
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
            int layout = sector % 3;
            float designSpeed = TerrainWorldPaceRules.MaximumSpeedForHeat(heat);
            const float openWaterReturnStart = 2980f;
            const float openWaterReturnLength = 640f;
            const float breatherLength = 500f;
            const float breatherStart = openWaterReturnStart + openWaterReturnLength;
            float worldLength = breatherStart + breatherLength;
            TerrainWorldRegion[] regions;
            if (layout == 1)
            {
                // The storm arrives immediately after open water, then releases
                // into a long geological weave. This is a different encounter
                // sentence, not the same sentence with different prop seeds.
                regions = new[]
                {
                    new TerrainWorldRegion(1, TerrainRegionKind.OpenSea,              0f, 220f, 0f),
                    new TerrainWorldRegion(2, TerrainRegionKind.StormChannel,       220f, 440f, 6f),
                    new TerrainWorldRegion(3, TerrainRegionKind.CoastalWeave,       660f, 960f, 8f),
                    new TerrainWorldRegion(4, TerrainRegionKind.NaturalArch,       1620f, 260f, 5f),
                    new TerrainWorldRegion(5, TerrainRegionKind.CrystallineCanyon, 1880f, 1100f, 11f),
                    new TerrainWorldRegion(6, TerrainRegionKind.OpenSea,
                        openWaterReturnStart, openWaterReturnLength, 7f),
                    new TerrainWorldRegion(7, TerrainRegionKind.ExtractionBreather,
                        breatherStart, breatherLength, 0f)
                };
            }
            else if (layout == 2)
            {
                // A shorter opening weave is interrupted by a mid-field storm,
                // followed by a second terrain push before the arch and canyon.
                regions = new[]
                {
                    new TerrainWorldRegion(1, TerrainRegionKind.OpenSea,              0f, 220f, 0f),
                    new TerrainWorldRegion(2, TerrainRegionKind.CoastalWeave,       220f, 500f, 5f),
                    new TerrainWorldRegion(3, TerrainRegionKind.StormChannel,       720f, 420f, 6f),
                    new TerrainWorldRegion(4, TerrainRegionKind.CoastalWeave,      1140f, 480f, 5f),
                    new TerrainWorldRegion(5, TerrainRegionKind.NaturalArch,       1620f, 260f, 5f),
                    new TerrainWorldRegion(6, TerrainRegionKind.CrystallineCanyon, 1880f, 1100f, 11f),
                    new TerrainWorldRegion(7, TerrainRegionKind.OpenSea,
                        openWaterReturnStart, openWaterReturnLength, 7f),
                    new TerrainWorldRegion(8, TerrainRegionKind.ExtractionBreather,
                        breatherStart, breatherLength, 0f)
                };
            }
            else
            {
                regions = new[]
                {
                    new TerrainWorldRegion(1, TerrainRegionKind.OpenSea,              0f, 220f, 0f),
                    new TerrainWorldRegion(2, TerrainRegionKind.CoastalWeave,       220f, 980f, 8f),
                    new TerrainWorldRegion(3, TerrainRegionKind.StormChannel,      1200f, 420f, 6f),
                    new TerrainWorldRegion(4, TerrainRegionKind.NaturalArch,       1620f, 260f, 5f),
                    new TerrainWorldRegion(5, TerrainRegionKind.CrystallineCanyon, 1880f, 1100f, 11f),
                    new TerrainWorldRegion(6, TerrainRegionKind.OpenSea,
                        openWaterReturnStart, openWaterReturnLength, 7f),
                    new TerrainWorldRegion(7, TerrainRegionKind.ExtractionBreather,
                        breatherStart, breatherLength, 0f)
                };
            }
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
                if (distance >= 220f && distance < 1620f)
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

            Shore(   0f, TerrainRegionKind.OpenSea,             -150f, 150f, 10f, 11f, 180f);
            Shore( 160f, TerrainRegionKind.OpenSea,             -136f, 130f, 13f, 15f, 175f);
            Shore( 220f, TerrainRegionKind.CoastalWeave,        -112f, 116f, 17f, 20f, 165f);
            Shore( 300f, TerrainRegionKind.CoastalWeave,         -82f,  78f, 23f, 27f);
            Shore( 390f, TerrainRegionKind.CoastalWeave,         -58f,  70f, 31f, 25f);
            Shore( 480f, TerrainRegionKind.CoastalWeave,         -52f,  34f, 37f, 30f);
            Shore( 570f, TerrainRegionKind.CoastalWeave,         -20f,  62f, 32f, 41f);
            Shore( 665f, TerrainRegionKind.CoastalWeave,         -60f,  10f, 43f, 34f);
            Shore( 765f, TerrainRegionKind.CoastalWeave,         -12f,  56f, 35f, 46f);
            Shore( 870f, TerrainRegionKind.CoastalWeave,         -60f,  -8f, 48f, 34f);
            Shore( 980f, TerrainRegionKind.CoastalWeave,         -22f,  60f, 36f, 44f);
            Shore(1100f, TerrainRegionKind.CoastalWeave,         -66f,  42f, 33f, 29f);
            Shore(1200f, TerrainRegionKind.StormChannel,         -76f,  76f, 25f, 28f, 155f);
            Shore(1310f, TerrainRegionKind.StormChannel,         -66f,  70f, 30f, 24f);
            Shore(1430f, TerrainRegionKind.StormChannel,         -72f,  58f, 27f, 33f);
            Shore(1540f, TerrainRegionKind.StormChannel,         -58f,  68f, 34f, 28f);
            Shore(1620f, TerrainRegionKind.NaturalArch,          -54f,  52f, 44f, 48f);
            Shore(1700f, TerrainRegionKind.NaturalArch,          -34f,  20f, 56f, 60f);
            Shore(1760f, TerrainRegionKind.NaturalArch,          -22f,   6f, 68f, 64f);
            Shore(1840f, TerrainRegionKind.NaturalArch,          -34f,  20f, 61f, 58f);

            float previousCanyonCenter = sections[sections.Count - 1].WaterCenterX;
            float previousCanyonDistance = sections[sections.Count - 1].Distance;
            float previousCanyonSlope = 0f;
            for (int i = 0; i <= 22; i++)
            {
                float t = i / 22f;
                float distance = 1880f + t * 1100f;
                float primaryFrequency = layout == 0 ? 2.65f : layout == 1 ? 3.25f : 2.05f;
                float primaryAmplitude = layout == 0 ? 18f : layout == 1 ? 14f : 22f;
                float primaryPhase = layout == 0 ? 0f : layout == 1 ? .55f : -.35f;
                float secondaryFrequency = layout == 0 ? 5.4f : layout == 1 ? 7.1f : 4.6f;
                float secondaryAmplitude = layout == 0 ? 3.5f : layout == 1 ? 5f : 4.5f;
                float desiredCenter = ((float)Math.Sin(t * Math.PI * primaryFrequency + primaryPhase)
                        * primaryAmplitude
                    + (float)Math.Sin(t * Math.PI * secondaryFrequency + .35f + layout * .32f)
                        * secondaryAmplitude) * mirror;
                // Return toward open water before the final cross-section. The
                // curve is then rate-limited by the same velocity and acceleration
                // envelope used by admission, so higher-speed sectors become longer,
                // broader turns rather than physically impossible lateral snaps.
                float exitT = Math.Max(0f, Math.Min(1f, (t - .70f) / .30f));
                exitT = exitT * exitT * (3f - 2f * exitT);
                desiredCenter *= 1f - exitT;
                float dz = Math.Max(.001f, distance - previousCanyonDistance);
                float desiredSlope = (desiredCenter - previousCanyonCenter) / dz;
                desiredSlope = Math.Max(-comfortableSlope, Math.Min(comfortableSlope, desiredSlope));
                float maximumSlopeChange = comfortableCurvature * dz;
                float slope = Math.Max(
                    previousCanyonSlope - maximumSlopeChange,
                    Math.Min(previousCanyonSlope + maximumSlopeChange, desiredSlope));
                float center = previousCanyonCenter + slope * dz;
                float baseHalfWidth = layout == 0 ? 25f : layout == 1 ? 27f : 24.5f;
                float halfWidth = baseHalfWidth
                    + (float)Math.Sin(t * Math.PI * (3.1f + layout * .45f) + .6f) * 3f;
                float heightWave = (float)Math.Sin(t * Math.PI * (2.2f + layout * .3f) + .4f) * 7f;
                sections.Add(new TerrainWorldSection(
                    id++,
                    TerrainRegionKind.CrystallineCanyon,
                    distance,
                    center - halfWidth,
                    center + halfWidth,
                    62f + heightWave,
                    67f - heightWave * .65f,
                    175f,
                    175f));
                previousCanyonCenter = center;
                previousCanyonDistance = distance;
                previousCanyonSlope = slope;
            }
            previousAuthoredCenter = previousCanyonCenter;
            previousAuthoredDistance = previousCanyonDistance;
            previousAuthoredSlope = previousCanyonSlope;

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

            var features = new List<TerrainWorldFeature>(8)
            {
                new TerrainWorldFeature(
                    500,
                    TerrainWorldFeatureKind.NaturalArch,
                    1760f,
                    -8f * mirror,
                    14f,
                    68f,
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
                if (distance > 1540f) continue;
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
                    float innerTip = waterCenter - side * .5f;
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
                features.ToArray());
            // Dense envelope validation is intentionally an authoring/test gate,
            // not work performed inside the live simulation tick. The generator
            // constructs from the same limits, while TerrainWorldArchitectureTests
            // prove every speed/heat template before shipping. This avoids a route
            // search hitch when the next deterministic world is preloaded on mobile.
            return world;
        }
    }
}
