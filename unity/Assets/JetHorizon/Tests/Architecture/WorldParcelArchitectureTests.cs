using System;
using JetHorizon.Simulation;
using NUnit.Framework;

namespace JetHorizon.Tests.Architecture
{
    public sealed class WorldParcelArchitectureTests
    {
        static ShipCapabilityProfile Capability => ShipCapabilityProfile.FromConfig(new SimulationConfig
        {
            StartSpeedMultiplier = 3f,
            MinimumOperationalSpeed = 100f
        });

        [Test]
        public void OpenWaterBreather_HasNoShoreTopologyThreatsOrCargo()
        {
            TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability);
            WorldParcelPlan breather = world.GetParcel(0);

            Assert.That(breather.Kind, Is.EqualTo(WorldParcelKind.OpenWaterBreather));
            Assert.That(breather.Envelope, Is.EqualTo(WorldEnvelopeKind.None));
            Assert.That(breather.ShoreSectionCount, Is.Zero);
            Assert.That(breather.FeatureCount, Is.Zero);
            Assert.That(breather.RouteSectionCount, Is.Zero);
            Assert.That(breather.Threats.Kind, Is.EqualTo(WorldThreatKind.None));
            Assert.That(breather.Cargo.CollectibleCount, Is.Zero);
        }

        [Test]
        public void OpenWaterFormation_HasFiniteFeaturesAndNoContinuousEnvelope()
        {
            TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability);
            WorldParcelPlan formation = world.GetParcel(1);

            Assert.That(formation.Kind, Is.EqualTo(WorldParcelKind.OpenWaterFormation));
            Assert.That(formation.Envelope, Is.EqualTo(WorldEnvelopeKind.None));
            Assert.That(formation.ShoreSectionCount, Is.Zero);
            Assert.That(formation.FeatureCount,
                Is.InRange(
                    RandomConeFormationPlanner.AuthoredRowCount
                        * RandomConeFormationPlanner.MinimumBlockersPerRow,
                    RandomConeFormationPlanner.AuthoredRowCount
                        * RandomConeFormationPlanner.MaximumBlockersPerRow));
            for (int i = 0; i < formation.FeatureCount; i++)
            {
                TerrainWorldFeature feature = formation.GetFeature(i);
                Assert.That(feature.Distance, Is.InRange(formation.LocalStartDistance, formation.LocalEndDistance));
                Assert.That(TerrainWorldFeatureRules.IsWaterFormation(feature.Kind), Is.True);
            }
        }

        [Test]
        public void RandomConeFormation_PortsSourceShuffleDensityGapAndAntiBunchRules()
        {
            float speed = TerrainWorldPaceRules.MaximumSpeedForHeat(0);
            RandomConeFormationPlan plan = new RandomConeFormationPlanner().Create(
                340f, 0f, speed, Capability, 1810, 0);

            Assert.That(plan.RowCount, Is.EqualTo(RandomConeFormationPlanner.AuthoredRowCount));
            Assert.That(plan.Length, Is.InRange(700f, 780f));
            Assert.That(plan.RevealDistance, Is.EqualTo(RandomConeFormationPlanner.SourceSpawnDistance));
            for (int rowIndex = 0; rowIndex < plan.RowCount; rowIndex++)
            {
                RandomConeFormationRow row = plan.GetRow(rowIndex);
                Assert.That(row.BurstIndex, Is.EqualTo(rowIndex / RandomConeFormationPlanner.RowsPerBurst));
                Assert.That(row.RowInBurst, Is.EqualTo(rowIndex % RandomConeFormationPlanner.RowsPerBurst));
                Assert.That(row.BlockedCount,
                    Is.EqualTo(RandomConeFormationPlanner.MaximumBlockersPerRow));
                bool centerIsBlocked = false;
                for (int i = 0; i < row.BlockedCount; i++)
                {
                    int lane = row.GetBlockedLane(i);
                    centerIsBlocked |= lane == (RandomConeFormationPlanner.LaneCount - 1) / 2;
                    Assert.That(lane, Is.Not.EqualTo(row.SafeGapStartLane));
                    Assert.That(lane, Is.Not.EqualTo(row.SafeGapStartLane + 1));
                    Assert.That(lane, Is.Not.EqualTo(row.ValuableGapStartLane));
                    Assert.That(lane, Is.Not.EqualTo(row.ValuableGapStartLane + 1));
                    for (int j = i + 1; j < row.BlockedCount; j++)
                        Assert.That(Math.Abs(lane - row.GetBlockedLane(j)),
                            Is.GreaterThanOrEqualTo(RandomConeFormationPlanner.MinimumLaneGap));
                }
                Assert.That(centerIsBlocked, Is.True, "neutral must fail on row " + rowIndex);

                for (int featureIndex = 0; featureIndex < plan.FeatureCount; featureIndex++)
                {
                    TerrainWorldFeature feature = plan.GetFeature(featureIndex);
                    if (Math.Abs(feature.Distance - row.Distance) > 4f) continue;
                    Assert.That(
                        Math.Abs(feature.CenterX - row.SafeCenterX),
                        Is.GreaterThan(feature.HalfWidth + Capability.CollisionHalfWidth),
                        "safe route clips formation row " + rowIndex);
                }
            }

            Assert.That(plan.GetRow(0).SafeCenterX, Is.LessThan(0f));
            Assert.That(plan.GetRow(3).SafeCenterX, Is.GreaterThan(0f));
            Assert.That(plan.GetRow(6).SafeCenterX, Is.LessThan(0f));
        }

        [Test]
        public void RandomConeFormation_IsDeterministicAndArrivesAtTheSourcePreviewDistance()
        {
            float speed = TerrainWorldPaceRules.MaximumSpeedForHeat(0);
            var planner = new RandomConeFormationPlanner();
            RandomConeFormationPlan a = planner.Create(340f, 0f, speed, Capability, 1810, 2);
            RandomConeFormationPlan b = planner.Create(340f, 0f, speed, Capability, 1810, 2);

            Assert.That(a.FeatureCount, Is.EqualTo(b.FeatureCount));
            for (int i = 0; i < a.FeatureCount; i++)
            {
                TerrainWorldFeature first = a.GetFeature(i);
                TerrainWorldFeature second = b.GetFeature(i);
                Assert.That(first.Kind, Is.EqualTo(second.Kind));
                Assert.That(first.Distance, Is.EqualTo(second.Distance).Within(.001f));
                Assert.That(first.CenterX, Is.EqualTo(second.CenterX).Within(.001f));
            }
            float firstRockDistance = float.MaxValue;
            for (int i = 0; i < a.FeatureCount; i++)
                firstRockDistance = Math.Min(firstRockDistance, a.GetFeature(i).Distance - 340f);
            Assert.That(a.RevealDistance + firstRockDistance, Is.InRange(185f, 195f));
        }

        [Test]
        public void FormationWave_UsesDenseCoinTrailsThroughEverySafeOpening()
        {
            WorldParcelPlan formation = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability).GetParcel(1);

            Assert.That(formation.Cargo.CollectibleCount,
                Is.EqualTo(RandomConeFormationPlanner.AuthoredRowCount * 7));
            for (int i = 0; i < formation.Cargo.CollectibleCount; i++)
            {
                CargoWaveCollectible coin = formation.Cargo.GetCollectible(i);
                Assert.That(coin.Family, Is.EqualTo(CargoCollectibleFamily.CreditCache));
                Assert.That(coin.RouteRole, Is.EqualTo(CargoWaveRouteRole.Safe));
                Assert.That(coin.Units, Is.EqualTo(1));
            }
        }

        [Test]
        public void FormationWave_PreservesAValidSafeRouteAtEverySupportedPace()
        {
            for (int heat = 0; heat <= 5; heat++)
            {
                TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(heat, heat * 5000f, Capability);
                WorldParcelValidation validation = new WorldParcelValidator().Validate(
                    world.Parcels,
                    Capability,
                    TerrainWorldPaceRules.MaximumSpeedForHeat(heat));
                Assert.That(validation.RoutesArePhysical, Is.True, "heat " + heat);
            }
        }

        [Test]
        public void FormationWave_ValuableRouteRequiresARealDetour()
        {
            WorldParcelPlan formation = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability).GetParcel(1);
            Assert.That(formation.TryGetRoute(CargoWaveRouteRole.Safe, out WorldParcelRoutePlan safe), Is.True);
            Assert.That(formation.TryGetRoute(CargoWaveRouteRole.Valuable, out WorldParcelRoutePlan valuable), Is.True);
            float maximumDetour = 0f;
            for (int i = 0; i < Math.Min(safe.PointCount, valuable.PointCount); i++)
                maximumDetour = Math.Max(maximumDetour,
                    Math.Abs(safe.GetPoint(i).CenterX - valuable.GetPoint(i).CenterX));
            Assert.That(maximumDetour, Is.GreaterThan(12f));
        }

        [Test]
        public void ParcelSequence_InsertsBreatherBetweenMajorWaves()
        {
            WorldParcelSequencePlan sequence = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability).Parcels;
            for (int i = 1; i < sequence.ParcelCount; i++)
                if (!sequence.GetParcel(i).IsBreather)
                    Assert.That(sequence.GetParcel(i - 1).IsBreather, Is.True, "parcel " + i);
        }

        [Test]
        public void ParcelSequence_DoesNotRepeatRecentFamilyOrVariant()
        {
            WorldParcelSequencePlan sequence = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability).Parcels;
            string priorVariant = string.Empty;
            for (int i = 0; i < sequence.ParcelCount; i++)
            {
                WorldParcelPlan parcel = sequence.GetParcel(i);
                if (parcel.IsBreather) continue;
                Assert.That(parcel.VariantId, Is.Not.EqualTo(priorVariant));
                priorVariant = parcel.VariantId;
            }
        }

        [Test]
        public void QueuedParcel_IsFullyPlannedBeforeReveal()
        {
            WorldParcelSequencePlan sequence = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability).Parcels;
            var runtime = new WorldParcelRuntime();
            WorldParcelPlan first = sequence.GetParcel(0);
            WorldParcelPlan next = sequence.GetParcel(1);
            runtime.Reset(sequence, first.StartDistance);

            Assert.That(runtime.Snapshot.Next, Is.SameAs(next));
            Assert.That(runtime.Snapshot.NextLifecycle, Is.EqualTo(WorldParcelLifecycle.FullyBuiltHidden));
            Assert.That(next.FeatureCount, Is.GreaterThan(0));
            Assert.That(next.TryGetRoute(CargoWaveRouteRole.Safe, out _), Is.True);
        }

        [Test]
        public void PreviousParcel_RemainsUntilRearCull()
        {
            WorldParcelSequencePlan sequence = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability).Parcels;
            WorldParcelPlan formation = sequence.GetParcel(1);
            var runtime = new WorldParcelRuntime();
            runtime.Reset(sequence, formation.EndDistance + formation.RearCullDistance * .5f);

            Assert.That(runtime.Snapshot.Previous, Is.SameAs(formation));
            Assert.That(runtime.Snapshot.PreviousLifecycle, Is.EqualTo(WorldParcelLifecycle.PassingBehind));
        }

        [Test]
        public void CanyonParcel_HasConnectedEntryInteriorAndExit()
        {
            TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability);
            WorldParcelPlan canyon = Find(world.Parcels, WorldParcelKind.CrystallineCanyon);

            Assert.That(canyon.Envelope, Is.EqualTo(WorldEnvelopeKind.CanyonShoreline));
            Assert.That(canyon.ShoreSectionCount, Is.GreaterThanOrEqualTo(8));
            Assert.That(canyon.GetShoreSection(0).Distance, Is.EqualTo(canyon.LocalStartDistance).Within(.01f));
            Assert.That(canyon.GetShoreSection(canyon.ShoreSectionCount - 1).Distance,
                Is.EqualTo(canyon.LocalEndDistance).Within(.01f));
        }

        [Test]
        public void OpenWaterAndCanyon_CollisionFollowsThePhysicalEnvelope()
        {
            var runtime = new TerrainWorldRuntime(Capability);
            var eventOwner = new JetHorizonSimulation(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f,
                TerrainWorldMode = true
            }, 77u);
            WorldParcelPlan opening = runtime.World.GetParcel(0);
            WorldParcelPlan canyon = Find(runtime.World.Parcels, WorldParcelKind.CrystallineCanyon);

            TerrainWorldTickResult water = runtime.Tick(
                opening.StartDistance + opening.Length * .5f,
                149f,
                0f,
                1f,
                false,
                eventOwner.Events);
            Assert.That(water.CollisionEntered, Is.False, "open water must not inherit transport shores");

            TerrainWorldTickResult wall = runtime.Tick(
                canyon.StartDistance + canyon.Length * .5f,
                140f,
                0f,
                1f,
                false,
                eventOwner.Events);
            Assert.That(wall.CollisionEntered, Is.True, "canyon shoreline must remain physical");
        }

        [Test]
        public void RoutePortal_HasMultipleContinuousOpeningsAndNoDeadEnds()
        {
            TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability);
            WorldParcelPlan portal = Find(world.Parcels, WorldParcelKind.RoutePortal);

            Assert.That(portal.Envelope, Is.EqualTo(WorldEnvelopeKind.RouteMass));
            Assert.That(portal.RouteSectionCount, Is.GreaterThanOrEqualTo(18));
            Assert.That(portal.TryGetRoute(CargoWaveRouteRole.Safe, out WorldParcelRoutePlan safe), Is.True);
            Assert.That(portal.TryGetRoute(CargoWaveRouteRole.Valuable, out WorldParcelRoutePlan valuable), Is.True);
            Assert.That(portal.TryGetRoute(CargoWaveRouteRole.Hero, out WorldParcelRoutePlan hero), Is.True);
            Assert.That(safe.PointCount, Is.EqualTo(valuable.PointCount));
            Assert.That(hero.PointCount, Is.EqualTo(safe.PointCount));
        }

        [Test]
        public void RoutePortal_BlocksMassBetweenItsAuthoredOpenings()
        {
            var runtime = new TerrainWorldRuntime(Capability);
            var eventOwner = new JetHorizonSimulation(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f,
                TerrainWorldMode = true
            }, 91u);
            WorldParcelPlan portal = Find(runtime.World.Parcels, WorldParcelKind.RoutePortal);
            float distance = portal.StartDistance + portal.Length * .5f;

            TerrainWorldTickResult passage = runtime.Tick(
                distance, -52f, 0f, 1f, false, eventOwner.Events);
            Assert.That(passage.CollisionEntered, Is.False);

            TerrainWorldTickResult mass = runtime.Tick(
                distance, 27f, 0f, 1f, false, eventOwner.Events);
            Assert.That(mass.CollisionEntered, Is.True);
        }

        [Test]
        public void CargoRoutes_ReferenceValidatedParcelRoutes()
        {
            WorldParcelSequencePlan sequence = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability).Parcels;
            for (int parcelIndex = 0; parcelIndex < sequence.ParcelCount; parcelIndex++)
            {
                WorldParcelPlan parcel = sequence.GetParcel(parcelIndex);
                for (int routeIndex = 0; routeIndex < parcel.RouteCount; routeIndex++)
                {
                    WorldParcelRoutePlan route = parcel.GetRoute(routeIndex);
                    for (int pointIndex = 0; pointIndex < route.PointCount; pointIndex++)
                    {
                        CargoWaveRoutePoint expected = route.GetPoint(pointIndex);
                        bool found = false;
                        for (int cargoIndex = 0; cargoIndex < parcel.Cargo.RoutePointCount; cargoIndex++)
                        {
                            CargoWaveRoutePoint actual = parcel.Cargo.GetRoutePoint(cargoIndex);
                            found |= actual.Role == expected.Role
                                && Math.Abs(actual.Distance - expected.Distance) < .01f
                                && Math.Abs(actual.CenterX - expected.CenterX) < .01f;
                        }
                        Assert.That(found, Is.True, parcel.Id + " route " + routeIndex);
                    }
                }
            }
        }

        [Test]
        public void Composer_ProducesMeaningfullyDifferentRunSentences()
        {
            WorldParcelSequencePlan a = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability).Parcels;
            WorldParcelSequencePlan b = TerrainWorldCatalog.CreateProofWorld(1, a.EndDistance, Capability).Parcels;

            Assert.That(a.GetParcel(3).Kind, Is.Not.EqualTo(b.GetParcel(3).Kind));
            Assert.That(a.GetParcel(5).VariantId, Is.Not.EqualTo(b.GetParcel(5).VariantId));
        }

        [Test]
        public void Composer_HeroFamilyHasCooldownAndEverySentenceChangesFamily()
        {
            var selector = new DeterministicWorldParcelSelector();
            int lastHeroSector = -99;
            string priorSignature = string.Empty;
            for (int sector = 0; sector < 18; sector++)
            {
                WorldParcelSelection selection = selector.Select(sector);
                Assert.That(selection.FirstMajor, Is.Not.EqualTo(selection.SecondMajor));
                Assert.That(selection.Signature, Is.Not.EqualTo(priorSignature));
                priorSignature = selection.Signature;
                bool hero = selection.FirstMajor == WorldParcelKind.PrismaticCorridor
                    || selection.SecondMajor == WorldParcelKind.PrismaticCorridor;
                if (!hero) continue;
                Assert.That(sector - lastHeroSector, Is.GreaterThanOrEqualTo(5));
                lastHeroSector = sector;
            }
        }

        [Test]
        public void RuntimeTrace_IsWaveThenBehindThenEmptyWaterThenRevealThenWave()
        {
            WorldParcelSequencePlan sequence = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability).Parcels;
            WorldParcelPlan formation = sequence.GetParcel(1);
            WorldParcelPlan water = sequence.GetParcel(2);
            WorldParcelPlan canyon = sequence.GetParcel(3);
            var runtime = new WorldParcelRuntime();

            runtime.Reset(sequence, formation.StartDistance + formation.Length * .5f);
            Assert.That(runtime.Snapshot.Active, Is.SameAs(formation));
            Assert.That(runtime.Snapshot.ActiveLifecycle, Is.EqualTo(WorldParcelLifecycle.Active));

            runtime.Sync(formation.EndDistance + 1f);
            Assert.That(runtime.Snapshot.Previous, Is.SameAs(formation));
            Assert.That(runtime.Snapshot.PreviousLifecycle, Is.EqualTo(WorldParcelLifecycle.PassingBehind));
            Assert.That(runtime.Snapshot.Active, Is.SameAs(water));
            Assert.That(runtime.Snapshot.Active.Envelope, Is.EqualTo(WorldEnvelopeKind.None));

            runtime.Sync(canyon.StartDistance - canyon.RevealDistance + 1f);
            Assert.That(runtime.Snapshot.Next, Is.SameAs(canyon));
            Assert.That(runtime.Snapshot.NextLifecycle, Is.EqualTo(WorldParcelLifecycle.HorizonReveal));

            runtime.Sync(canyon.StartDistance + 1f);
            Assert.That(runtime.Snapshot.Active, Is.SameAs(canyon));
            Assert.That(runtime.Snapshot.ActiveLifecycle, Is.EqualTo(WorldParcelLifecycle.Active));
        }

        static WorldParcelPlan Find(WorldParcelSequencePlan sequence, WorldParcelKind kind)
        {
            for (int i = 0; i < sequence.ParcelCount; i++)
                if (sequence.GetParcel(i).Kind == kind) return sequence.GetParcel(i);
            Assert.Fail("Missing parcel kind: " + kind);
            return null;
        }
    }
}
