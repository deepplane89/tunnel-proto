using System;
using System.Collections.Generic;

namespace JetHorizon.Simulation
{
    /// <summary>
    /// Composes a run from complete finite parcels. The compatibility TerrainWorldPlan
    /// remains the transport for existing snapshots, but its parcel sentence is the
    /// authority for envelope, lifecycle, routes, cargo, threats and presentation.
    /// </summary>
    public static class TrueWaveWorldCatalog
    {
        const float InitialWaterLength = 340f;
        const float BreatherLength = 430f;
        const float MajorLength = 960f;
        const float FinalBreatherLength = 520f;
        static readonly IWorldParcelSelector Selector = new DeterministicWorldParcelSelector();

        public static TerrainWorldPlan Create(
            int sector,
            float worldStartDistance,
            ShipCapabilityProfile capability)
        {
            if (sector < 0) throw new ArgumentOutOfRangeException(nameof(sector));
            if (worldStartDistance < 0f) throw new ArgumentOutOfRangeException(nameof(worldStartDistance));
            float speed = TerrainWorldPaceRules.MaximumSpeedForHeat(Math.Min(5, sector));
            int seed = 1709 + sector * 7919;
            WorldParcelSelection selection = Selector.Select(sector);
            int formationVariant = selection.FormationVariant;
            WorldParcelKind firstMajor = selection.FirstMajor;
            WorldParcelKind secondMajor = selection.SecondMajor;
            var parcels = new List<WorldParcelPlan>(7);
            float cursor = worldStartDistance;

            parcels.Add(CreateBreather("opening-water", cursor, InitialWaterLength, worldStartDistance, capability, seed));
            cursor += InitialWaterLength;
            WorldParcelPlan formation = CreateFormation(
                cursor,
                worldStartDistance,
                capability,
                speed,
                seed + 101,
                formationVariant);
            parcels.Add(formation);
            cursor += formation.Length;
            parcels.Add(CreateBreather("formation-release", cursor, BreatherLength, worldStartDistance, capability, seed + 201));
            cursor += BreatherLength;
            parcels.Add(CreateMajor(firstMajor, cursor, MajorLength, worldStartDistance, capability, speed, seed + 307, selection.FirstVariant));
            cursor += MajorLength;
            parcels.Add(CreateBreather("mid-run-water", cursor, BreatherLength, worldStartDistance, capability, seed + 401));
            cursor += BreatherLength;
            parcels.Add(CreateMajor(secondMajor, cursor, MajorLength, worldStartDistance, capability, speed, seed + 503, selection.SecondVariant));
            cursor += MajorLength;
            parcels.Add(CreateBreather("long-water-settlement", cursor, FinalBreatherLength, worldStartDistance, capability, seed + 607));
            cursor += FinalBreatherLength;

            var sequence = new WorldParcelSequencePlan(
                $"parcel-sentence-{sector:00}",
                seed,
                worldStartDistance,
                cursor,
                parcels.ToArray());
            WorldParcelValidation validation = new WorldParcelValidator().Validate(sequence, capability, speed);
            if (!validation.IsValid)
            {
                string failingParcel = string.Empty;
                for (int i = 0; i < sequence.ParcelCount; i++)
                {
                    WorldParcelPlan candidate = sequence.GetParcel(i);
                    if (candidate.IsBreather) continue;
                    if (!WorldParcelValidator.HasReachableSafeRoute(candidate, capability, speed))
                    {
                        failingParcel = candidate.Id;
                        break;
                    }
                }
                throw new InvalidOperationException(
                    "True-wave parcel sentence is not admissible: ordered=" + validation.Ordered
                    + ", breathers=" + validation.BreathersAreEmpty
                    + ", separated=" + validation.BreathersSeparateMajorWaves
                    + ", routes=" + validation.RoutesArePhysical
                    + ", variants=" + validation.VariantsDoNotRepeat
                    + ", failingParcel=" + failingParcel);
            }

            var regions = new List<TerrainWorldRegion>(parcels.Count);
            var sections = new List<TerrainWorldSection>(40);
            var features = new List<TerrainWorldFeature>(24);
            var routes = new List<TerrainRouteSection>(48);
            var waves = new List<TerrainWorldWave>(parcels.Count);
            int sectionId = 1000;
            float lastSectionDistance = -1f;

            for (int i = 0; i < parcels.Count; i++)
            {
                WorldParcelPlan parcel = parcels[i];
                // Accumulate region starts locally instead of subtracting two large
                // absolute floats. That keeps strict non-overlap stable in deep runs.
                float localStart = regions.Count == 0
                    ? 0f
                    : regions[regions.Count - 1].EndDistance;
                regions.Add(new TerrainWorldRegion(
                    i + 1,
                    RegionFor(parcel, i == parcels.Count - 1),
                    localStart,
                    parcel.Length,
                    parcel.IsBreather ? 0f : 4f + i));
                waves.Add(new TerrainWorldWave(WaveFor(parcel.Kind), localStart, parcel.Length));

                if (parcel.ShoreSectionCount == 0)
                {
                    AddTransportSection(localStart, RegionFor(parcel, false));
                    AddTransportSection(parcel.LocalEndDistance, RegionFor(parcel, i == parcels.Count - 1));
                }
                else
                {
                    for (int sectionIndex = 0; sectionIndex < parcel.ShoreSectionCount; sectionIndex++)
                    {
                        TerrainWorldSection source = parcel.GetShoreSection(sectionIndex);
                        if (source.Distance <= lastSectionDistance + .01f) continue;
                        sections.Add(new TerrainWorldSection(
                            sectionId++, source.Region, source.Distance,
                            source.LeftShoreX, source.RightShoreX,
                            source.LeftHeight, source.RightHeight,
                            source.LeftDepth, source.RightDepth));
                        lastSectionDistance = source.Distance;
                    }
                }
                for (int featureIndex = 0; featureIndex < parcel.FeatureCount; featureIndex++)
                    features.Add(parcel.GetFeature(featureIndex));
                for (int routeIndex = 0; routeIndex < parcel.RouteSectionCount; routeIndex++)
                    routes.Add(parcel.GetRouteSection(routeIndex));
            }

            return new TerrainWorldPlan(
                $"terrain-world-{sector:00}",
                sector,
                worldStartDistance,
                cursor - worldStartDistance,
                regions.ToArray(),
                sections.ToArray(),
                features.ToArray(),
                routes.ToArray(),
                (TerrainCourseKind)(sector % 6),
                waves.ToArray(),
                sequence);

            void AddTransportSection(float distance, TerrainRegionKind region)
            {
                if (distance <= lastSectionDistance + .01f) return;
                sections.Add(new TerrainWorldSection(
                    sectionId++, region, distance,
                    -150f, 150f, 10f, 11f, 180f, 180f));
                lastSectionDistance = distance;
            }
        }

        static TerrainRegionKind RegionFor(WorldParcelPlan parcel, bool final)
        {
            if (final && parcel.IsBreather) return TerrainRegionKind.ExtractionBreather;
            switch (parcel.Kind)
            {
                case WorldParcelKind.OpenWaterLightning: return TerrainRegionKind.StormChannel;
                case WorldParcelKind.CrystallineCanyon: return TerrainRegionKind.CrystallineCanyon;
                case WorldParcelKind.RoutePortal:
                case WorldParcelKind.KnifeEdgeTunnel: return TerrainRegionKind.RouteJunction;
                case WorldParcelKind.PrismaticCorridor: return TerrainRegionKind.PrismaticReach;
                default: return TerrainRegionKind.OpenSea;
            }
        }

        static TerrainWaveKind WaveFor(WorldParcelKind kind)
        {
            switch (kind)
            {
                case WorldParcelKind.OpenWaterFormation: return TerrainWaveKind.OpenWaterFormation;
                case WorldParcelKind.OpenWaterLightning: return TerrainWaveKind.OpenWaterLightning;
                case WorldParcelKind.OpenWaterBreather: return TerrainWaveKind.OpenWaterBreather;
                case WorldParcelKind.CrystallineCanyon: return TerrainWaveKind.CrystallineCanyon;
                case WorldParcelKind.PrismaticCorridor: return TerrainWaveKind.PrismaticCorridor;
                default: return TerrainWaveKind.RoutePortal;
            }
        }

        static WorldParcelPlan CreateBreather(
            string variant,
            float start,
            float length,
            float worldStart,
            ShipCapabilityProfile capability,
            int seed)
        {
            WorldParcelRoutePlan safe = Route(
                variant + ".safe",
                CargoWaveRouteRole.Safe,
                start,
                length,
                0f, 0f, 0f,
                18f);
            CargoWavePlan cargo = Cargo(
                variant + ".cargo",
                TerrainWaveKind.OpenWaterBreather,
                start,
                length,
                capability,
                new[] { safe },
                Array.Empty<CargoWaveCollectible>());
            return new WorldParcelPlan(
                variant,
                variant,
                WorldParcelKind.OpenWaterBreather,
                WorldEnvelopeKind.None,
                WorldFormationArchetype.None,
                worldStart,
                start,
                length,
                Reveal(capability),
                Approach(capability),
                RearCull(capability),
                Array.Empty<TerrainWorldSection>(),
                Array.Empty<TerrainWorldFeature>(),
                Array.Empty<TerrainRouteSection>(),
                new[] { safe },
                new WorldThreatPlan(WorldThreatKind.None, 0, seed),
                cargo);
        }

        static WorldParcelPlan CreateFormation(
            float start,
            float worldStart,
            ShipCapabilityProfile capability,
            float speed,
            int seed,
            int variant)
        {
            string variantId = "random-cone-formation-" + variant;
            RandomConeFormationPlan plan = new RandomConeFormationPlanner().Create(
                start,
                worldStart,
                speed,
                capability,
                seed,
                variant);
            WorldParcelRoutePlan[] routes = plan.CopyRoutes();
            CargoWaveCollectible[] collectibles = Collectibles(routes, seed * 10, false);
            CargoWavePlan cargo = Cargo(variantId + ".cargo", TerrainWaveKind.OpenWaterFormation,
                start, plan.Length, capability, routes, collectibles,
                plan.RevealDistance, plan.ApproachDistance);
            WorldFormationArchetype archetype = (WorldFormationArchetype)(1 + variant % 8);
            return new WorldParcelPlan(
                variantId,
                variantId,
                WorldParcelKind.OpenWaterFormation,
                WorldEnvelopeKind.None,
                archetype,
                worldStart,
                start,
                plan.Length,
                plan.RevealDistance, plan.ApproachDistance, RearCull(capability),
                Array.Empty<TerrainWorldSection>(),
                plan.CopyFeatures(),
                Array.Empty<TerrainRouteSection>(),
                routes,
                new WorldThreatPlan(WorldThreatKind.None, 0, seed),
                cargo);
        }

        static WorldParcelPlan CreateMajor(
            WorldParcelKind kind,
            float start,
            float length,
            float worldStart,
            ShipCapabilityProfile capability,
            float speed,
            int seed,
            int variant)
        {
            if (kind == WorldParcelKind.OpenWaterLightning)
                return CreateLightning(start, length, worldStart, capability, seed, variant);
            if (kind == WorldParcelKind.CrystallineCanyon)
                return CreateCanyon(start, length, worldStart, capability, seed, variant);
            return CreateRouteMass(kind, start, length, worldStart, capability, seed, variant);
        }

        static WorldParcelPlan CreateLightning(
            float start,
            float length,
            float worldStart,
            ShipCapabilityProfile capability,
            int seed,
            int variant)
        {
            string id = "lightning-weave-" + (variant % 3);
            WorldParcelRoutePlan safe = Route(id + ".safe", CargoWaveRouteRole.Safe,
                start, length, -22f, 18f, -12f, 12f);
            WorldParcelRoutePlan valuable = Route(id + ".valuable", CargoWaveRouteRole.Valuable,
                start, length, 16f, -25f, 26f, 8f);
            WorldParcelRoutePlan[] routes = { safe, valuable };
            CargoWavePlan cargo = Cargo(id + ".cargo", TerrainWaveKind.OpenWaterLightning,
                start, length, capability, routes, Collectibles(routes, seed * 10, false));
            return new WorldParcelPlan(
                id, id, WorldParcelKind.OpenWaterLightning, WorldEnvelopeKind.None,
                WorldFormationArchetype.None, worldStart, start, length,
                Reveal(capability), Approach(capability), RearCull(capability),
                Array.Empty<TerrainWorldSection>(), Array.Empty<TerrainWorldFeature>(),
                Array.Empty<TerrainRouteSection>(), routes,
                new WorldThreatPlan(WorldThreatKind.LightningWeave, 7, seed), cargo);
        }

        static WorldParcelPlan CreateCanyon(
            float start,
            float length,
            float worldStart,
            ShipCapabilityProfile capability,
            int seed,
            int variant)
        {
            string id = "canyon-switchback-" + (variant % 3);
            float localStart = start - worldStart;
            var sections = new TerrainWorldSection[9];
            for (int i = 0; i < sections.Length; i++)
            {
                float t = i / (float)(sections.Length - 1);
                float distance = localStart + length * t;
                float mouth = (float)Math.Sin(t * Math.PI);
                float center = (float)Math.Sin(t * Math.PI * (1.35f + (variant % 3) * .18f) + variant * .41f)
                    * (13f + (variant % 2) * 5f) * mouth;
                float half = 145f - mouth * (62f + (variant % 3) * 5f);
                sections[i] = new TerrainWorldSection(
                    6000 + variant * 20 + i,
                    TerrainRegionKind.CrystallineCanyon,
                    distance,
                    center - half,
                    center + half,
                    18f + mouth * 48f,
                    20f + mouth * 52f,
                    175f - mouth * 18f,
                    175f - mouth * 18f);
            }
            WorldParcelRoutePlan safe = CurvedRoute(
                id + ".safe", CargoWaveRouteRole.Safe, start, length, variant, 0f, 13f);
            WorldParcelRoutePlan valuable = CurvedRoute(
                id + ".valuable", CargoWaveRouteRole.Valuable, start, length, variant, 24f, 9f);
            WorldParcelRoutePlan[] routes = { safe, valuable };
            CargoWavePlan cargo = Cargo(id + ".cargo", TerrainWaveKind.CrystallineCanyon,
                start, length, capability, routes, Collectibles(routes, seed * 10, false));
            return new WorldParcelPlan(
                id, id, WorldParcelKind.CrystallineCanyon, WorldEnvelopeKind.CanyonShoreline,
                WorldFormationArchetype.None, worldStart, start, length,
                Reveal(capability), Approach(capability), RearCull(capability),
                sections, Array.Empty<TerrainWorldFeature>(), Array.Empty<TerrainRouteSection>(),
                routes, new WorldThreatPlan(WorldThreatKind.None, 0, seed), cargo);
        }

        static WorldParcelPlan CreateRouteMass(
            WorldParcelKind kind,
            float start,
            float length,
            float worldStart,
            ShipCapabilityProfile capability,
            int seed,
            int variant)
        {
            string family = kind == WorldParcelKind.PrismaticCorridor ? "prismatic" :
                kind == WorldParcelKind.KnifeEdgeTunnel ? "knife-wall" : "route-wall";
            string id = family + "-" + (variant % 3);
            float localStart = start - worldStart;
            var sections = new TerrainWorldSection[8];
            var routeSections = new List<TerrainRouteSection>(24);
            for (int i = 0; i < sections.Length; i++)
            {
                float t = i / (float)(sections.Length - 1);
                float distance = localStart + length * t;
                float mouth = (float)Math.Sin(t * Math.PI);
                sections[i] = new TerrainWorldSection(
                    7000 + variant * 20 + i,
                    kind == WorldParcelKind.PrismaticCorridor
                        ? TerrainRegionKind.PrismaticReach
                        : TerrainRegionKind.RouteJunction,
                    distance,
                    -146f + mouth * 28f,
                    146f - mouth * 28f,
                    22f + mouth * 68f,
                    24f + mouth * 66f,
                    170f,
                    170f);
                float sway = (float)Math.Sin(t * Math.PI * 1.35f + variant * .31f) * 9f;
                AddPassage(TerrainRouteKind.SafeCanyon, -52f + sway, 19f, 0f);
                AddPassage(TerrainRouteKind.CargoChannel, 52f - sway * .45f, 17f, 0f);
                AddPassage(TerrainRouteKind.KnifeEdgeTunnel, sway * .60f,
                    10f + (1f - mouth) * 8f,
                    kind == WorldParcelKind.PrismaticCorridor ? 50f : 38f * mouth);

                void AddPassage(TerrainRouteKind routeKind, float center, float half, float ceiling)
                    => routeSections.Add(new TerrainRouteSection(
                        routeKind, distance, center - half, center + half, ceiling));
            }
            WorldParcelRoutePlan safe = MassRoute(id + ".safe", CargoWaveRouteRole.Safe,
                start, length, variant, TerrainRouteKind.SafeCanyon, 11f);
            WorldParcelRoutePlan valuable = MassRoute(id + ".valuable", CargoWaveRouteRole.Valuable,
                start, length, variant, TerrainRouteKind.CargoChannel, 9f);
            WorldParcelRoutePlan hero = MassRoute(id + ".hero", CargoWaveRouteRole.Hero,
                start, length, variant, TerrainRouteKind.KnifeEdgeTunnel, 7f);
            WorldParcelRoutePlan[] parcelRoutes = { safe, valuable, hero };
            TerrainWaveKind wave = kind == WorldParcelKind.PrismaticCorridor
                ? TerrainWaveKind.PrismaticCorridor
                : TerrainWaveKind.RoutePortal;
            CargoWavePlan cargo = Cargo(id + ".cargo", wave, start, length, capability,
                parcelRoutes, Collectibles(parcelRoutes, seed * 10, true));
            return new WorldParcelPlan(
                id, id, kind,
                kind == WorldParcelKind.PrismaticCorridor
                    ? WorldEnvelopeKind.PrismaticShell
                    : WorldEnvelopeKind.RouteMass,
                WorldFormationArchetype.None, worldStart, start, length,
                Reveal(capability), Approach(capability), RearCull(capability),
                sections, Array.Empty<TerrainWorldFeature>(), routeSections.ToArray(), parcelRoutes,
                new WorldThreatPlan(WorldThreatKind.None, 0, seed), cargo,
                kind == WorldParcelKind.KnifeEdgeTunnel
                    ? TraversalRequirement.KnifeEdge
                    : TraversalRequirement.None);
        }

        static WorldParcelRoutePlan Route(
            string id,
            CargoWaveRouteRole role,
            float start,
            float length,
            float firstX,
            float middleX,
            float lastX,
            float halfWidth)
        {
            return new WorldParcelRoutePlan(id, role, new[]
            {
                new CargoWaveRoutePoint(role, start + length * .18f, firstX, halfWidth),
                new CargoWaveRoutePoint(role, start + length * .42f, middleX, halfWidth),
                new CargoWaveRoutePoint(role, start + length * .68f, lastX, halfWidth),
                new CargoWaveRoutePoint(role, start + length * .84f, lastX * .35f, halfWidth)
            });
        }

        static WorldParcelRoutePlan CurvedRoute(
            string id,
            CargoWaveRouteRole role,
            float start,
            float length,
            int variant,
            float offset,
            float halfWidth)
        {
            var points = new CargoWaveRoutePoint[5];
            for (int i = 0; i < points.Length; i++)
            {
                float t = .12f + i * .19f;
                float curve = (float)Math.Sin(t * Math.PI * (1.25f + (variant % 3) * .12f)
                    + variant * .31f) * 10f;
                points[i] = new CargoWaveRoutePoint(
                    role, start + length * t, offset + curve, halfWidth);
            }
            return new WorldParcelRoutePlan(id, role, points);
        }

        static WorldParcelRoutePlan MassRoute(
            string id,
            CargoWaveRouteRole role,
            float start,
            float length,
            int variant,
            TerrainRouteKind kind,
            float halfWidth)
        {
            var points = new CargoWaveRoutePoint[5];
            for (int i = 0; i < points.Length; i++)
            {
                float t = .12f + i * .19f;
                float sway = (float)Math.Sin(t * Math.PI * 1.35f + variant * .31f) * 9f;
                float center = kind == TerrainRouteKind.SafeCanyon
                    ? -52f + sway
                    : kind == TerrainRouteKind.CargoChannel
                        ? 52f - sway * .45f
                        : sway * .60f;
                points[i] = new CargoWaveRoutePoint(
                    role, start + length * t, center, halfWidth);
            }
            return new WorldParcelRoutePlan(id, role, points);
        }

        static CargoWavePlan Cargo(
            string id,
            TerrainWaveKind kind,
            float start,
            float length,
            ShipCapabilityProfile capability,
            WorldParcelRoutePlan[] routes,
            CargoWaveCollectible[] collectibles,
            float revealDistance = 0f,
            float approachDistance = 0f)
        {
            var points = new List<CargoWaveRoutePoint>(16);
            for (int routeIndex = 0; routeIndex < routes.Length; routeIndex++)
                for (int pointIndex = 0; pointIndex < routes[routeIndex].PointCount; pointIndex++)
                    points.Add(routes[routeIndex].GetPoint(pointIndex));
            return new CargoWavePlan(
                id, kind, start, length,
                revealDistance > 0f ? revealDistance : Reveal(capability),
                approachDistance > 0f ? approachDistance : Approach(capability),
                RearCull(capability),
                0f, points.ToArray(), collectibles);
        }

        static CargoWaveCollectible[] Collectibles(
            WorldParcelRoutePlan[] routes,
            int firstId,
            bool hero)
        {
            var result = new List<CargoWaveCollectible>(12);
            int id = Math.Abs(firstId) + 1;
            for (int routeIndex = 0; routeIndex < routes.Length; routeIndex++)
            {
                WorldParcelRoutePlan route = routes[routeIndex];
                for (int pointIndex = 0; pointIndex < route.PointCount; pointIndex++)
                {
                    if (pointIndex == 0 || pointIndex == route.PointCount - 1) continue;
                    CargoWaveRoutePoint point = route.GetPoint(pointIndex);
                    if (route.Role == CargoWaveRouteRole.Safe)
                    {
                        result.Add(new CargoWaveCollectible(
                            id++, CargoCollectibleFamily.Salvage, route.Role,
                            RunCargoKind.Salvage, PowerupType.None, 1,
                            point.Distance, point.CenterX, 1.25f));
                    }
                    else if (route.Role == CargoWaveRouteRole.Valuable)
                    {
                        result.Add(new CargoWaveCollectible(
                            id++, CargoCollectibleFamily.PowerCell, route.Role,
                            RunCargoKind.Alloy, PowerupType.None, 1,
                            point.Distance, point.CenterX, 1.4f));
                    }
                    else if (hero && pointIndex == route.PointCount / 2)
                    {
                        result.Add(new CargoWaveCollectible(
                            id++, CargoCollectibleFamily.Prism, route.Role,
                            RunCargoKind.Prism, PowerupType.None, 1,
                            point.Distance, point.CenterX, 1.55f));
                    }
                }
            }
            return result.ToArray();
        }

        static float Reveal(ShipCapabilityProfile capability)
            => Math.Max(220f, Math.Min(300f, capability.CruiseSpeed * 1.8f));

        static float Approach(ShipCapabilityProfile capability)
            => Math.Max(100f, Math.Min(150f, capability.CruiseSpeed * .75f));

        static float RearCull(ShipCapabilityProfile capability)
            => Math.Max(90f, capability.CruiseSpeed * .72f);
    }
}
