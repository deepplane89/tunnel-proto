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
        public bool RegionCoverageValid { get; }
        public bool TopologyValid { get; }
        public bool IsValid => Navigation.IsAdmissible && RegionCoverageValid && TopologyValid;

        public TerrainWorldValidation(
            EncounterValidationResult navigation,
            bool regionCoverageValid,
            bool topologyValid)
        {
            Navigation = navigation;
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
                capability,
                heat);
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
            return new TerrainWorldValidation(navigation, regionsValid, topologyValid);
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
            const float openWaterReturnStart = 2980f;
            const float openWaterReturnLength = 640f;
            const float breatherLength = 500f;
            const float breatherStart = openWaterReturnStart + openWaterReturnLength;
            float worldLength = breatherStart + breatherLength;
            var regions = new[]
            {
                new TerrainWorldRegion(1, TerrainRegionKind.OpenSea,              0f,  220f, 0f),
                new TerrainWorldRegion(2, TerrainRegionKind.CoastalWeave,       220f,  980f, 8f),
                new TerrainWorldRegion(3, TerrainRegionKind.StormChannel,      1200f,  420f, 6f),
                new TerrainWorldRegion(4, TerrainRegionKind.NaturalArch,       1620f,  260f, 5f),
                new TerrainWorldRegion(5, TerrainRegionKind.CrystallineCanyon, 1880f, 1100f, 11f),
                new TerrainWorldRegion(6, TerrainRegionKind.OpenSea,
                    openWaterReturnStart, openWaterReturnLength, 7f),
                new TerrainWorldRegion(7, TerrainRegionKind.ExtractionBreather,
                    breatherStart, breatherLength, 0f)
            };
            var sections = new List<TerrainWorldSection>(48);
            int id = 1000;

            void Shore(
                float distance,
                TerrainRegionKind region,
                float left,
                float right,
                float leftHeight,
                float rightHeight,
                float depth = 150f)
            {
                float worldLeft = mirror > 0f ? left : -right;
                float worldRight = mirror > 0f ? right : -left;
                float worldLeftHeight = mirror > 0f ? leftHeight : rightHeight;
                float worldRightHeight = mirror > 0f ? rightHeight : leftHeight;
                sections.Add(new TerrainWorldSection(
                    id++, region, distance, worldLeft, worldRight,
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

            for (int i = 0; i <= 22; i++)
            {
                float t = i / 22f;
                float distance = 1880f + t * 1100f;
                float primaryFrequency = layout == 0 ? 2.65f : layout == 1 ? 3.25f : 2.05f;
                float primaryAmplitude = layout == 0 ? 18f : layout == 1 ? 14f : 22f;
                float primaryPhase = layout == 0 ? 0f : layout == 1 ? .55f : -.35f;
                float secondaryFrequency = layout == 0 ? 5.4f : layout == 1 ? 7.1f : 4.6f;
                float secondaryAmplitude = layout == 0 ? 3.5f : layout == 1 ? 5f : 4.5f;
                float center = ((float)Math.Sin(t * Math.PI * primaryFrequency + primaryPhase)
                        * primaryAmplitude
                    + (float)Math.Sin(t * Math.PI * secondaryFrequency + .35f + layout * .32f)
                        * secondaryAmplitude) * mirror;
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
            }

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

            var features = new List<TerrainWorldFeature>(5)
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

            void Formation(
                int id,
                TerrainWorldFeatureKind kind,
                float distance,
                float center,
                float halfWidth,
                float height,
                float halfDepth,
                int seed)
            {
                features.Add(new TerrainWorldFeature(
                    id, kind, distance, center * mirror, halfWidth, height, halfDepth,
                    TraversalRequirement.None, seed + sector * 67));
            }

            // Three authored terrain rhythms repeat only after three complete worlds.
            // The feature kind is core data; Unity merely presents the requested
            // source-faceted monolith, ridge or connected cluster.
            if (layout == 0)
            {
                Formation(501, TerrainWorldFeatureKind.WaterlineRidge,    300f,  42f,  9f, 31f,  9f, 601);
                Formation(502, TerrainWorldFeatureKind.WaterlineMonolith, 390f, -34f, 10f, 38f, 10f, 701);
                Formation(503, TerrainWorldFeatureKind.WaterlineCluster, 1100f,  20f, 12f, 44f, 12f, 809);
                Formation(504, TerrainWorldFeatureKind.WaterlineRidge,   1310f, -28f, 11f, 36f, 11f, 907);
            }
            else if (layout == 1)
            {
                Formation(501, TerrainWorldFeatureKind.WaterlineCluster,  320f, -42f, 10f, 35f, 10f, 1009);
                Formation(502, TerrainWorldFeatureKind.WaterlineRidge,    610f,  28f, 11f, 32f, 10f, 1103);
                Formation(503, TerrainWorldFeatureKind.WaterlineMonolith,1040f,  -4f, 13f, 48f, 13f, 1201);
                Formation(504, TerrainWorldFeatureKind.WaterlineCluster, 1380f,  34f, 10f, 39f, 10f, 1301);
            }
            else
            {
                Formation(501, TerrainWorldFeatureKind.WaterlineMonolith, 360f,   0f, 14f, 52f, 13f, 1409);
                Formation(502, TerrainWorldFeatureKind.WaterlineCluster,  760f,  30f, 11f, 34f, 10f, 1511);
                Formation(503, TerrainWorldFeatureKind.WaterlineRidge,   1150f, -30f, 12f, 31f, 11f, 1601);
                Formation(504, TerrainWorldFeatureKind.WaterlineMonolith,1460f,  30f, 10f, 43f, 10f, 1709);
            }

            var world = new TerrainWorldPlan(
                $"terrain-world-{sector:00}",
                sector,
                startDistance,
                worldLength,
                regions,
                sections.ToArray(),
                features.ToArray());
            TerrainWorldValidation validation = new TerrainWorldValidator().Validate(world, capability, heat);
            if (!validation.IsValid)
                throw new InvalidOperationException(
                    $"Terrain world is not navigable: {world.Id}; "
                    + $"reachable={validation.Navigation.Reachable}, "
                    + $"neutral={validation.Navigation.RejectsNeutral}, "
                    + $"left={validation.Navigation.RejectsConstantLeft}, "
                    + $"right={validation.Navigation.RejectsConstantRight}, "
                    + $"margin={validation.Navigation.FeasibilityMargin:0.###}, "
                    + $"regions={validation.RegionCoverageValid}, topology={validation.TopologyValid}");
            return world;
        }
    }
}
