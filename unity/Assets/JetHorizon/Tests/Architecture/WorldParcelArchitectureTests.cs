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
                Is.EqualTo(
                    RandomConeFormationPlanner.AuthoredRowCount
                        * RandomConeFormationPlanner.FeatureCountPerRow));
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
            Assert.That(plan.Length, Is.InRange(815f, 880f));
            Assert.That(plan.RevealDistance, Is.EqualTo(RandomConeFormationPlanner.SourceSpawnDistance));
            for (int rowIndex = 0; rowIndex < plan.RowCount; rowIndex++)
            {
                RandomConeFormationRow row = plan.GetRow(rowIndex);
                Assert.That(row.BurstIndex, Is.EqualTo(rowIndex / RandomConeFormationPlanner.RowsPerBurst));
                Assert.That(row.RowInBurst, Is.EqualTo(rowIndex % RandomConeFormationPlanner.RowsPerBurst));
                Assert.That(row.BlockedCount,
                    Is.EqualTo(RandomConeFormationPlanner.MaximumBlockersPerRow));
                bool antiCampingTargetIsBlocked = false;
                for (int i = 0; i < row.BlockedCount; i++)
                {
                    int lane = row.GetBlockedLane(i);
                    antiCampingTargetIsBlocked |= lane == row.AntiCampingTargetLane;
                    Assert.That(lane, Is.Not.EqualTo(row.SafeGapStartLane));
                    Assert.That(lane, Is.Not.EqualTo(row.SafeGapStartLane + 1));
                    Assert.That(lane, Is.Not.EqualTo(row.ValuableGapStartLane));
                    Assert.That(lane, Is.Not.EqualTo(row.ValuableGapStartLane + 1));
                    for (int j = i + 1; j < row.BlockedCount; j++)
                        Assert.That(Math.Abs(lane - row.GetBlockedLane(j)),
                            Is.GreaterThanOrEqualTo(RandomConeFormationPlanner.MinimumLaneGap));
                }
                Assert.That(antiCampingTargetIsBlocked, Is.True,
                    "anti-camping target must be present on row " + rowIndex);

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
        public void RandomConeFormation_RejectsEveryStationaryHoldAcrossThePlayableWidth()
        {
            for (int variant = 0; variant < 4; variant++)
            {
                RandomConeFormationPlan plan = new RandomConeFormationPlanner().Create(
                    340f,
                    0f,
                    TerrainWorldPaceRules.MaximumSpeedForHeat(variant),
                    Capability,
                    1810 + variant * 97,
                    variant);
                for (float x = RandomConeFormationPlanner.StationaryHoldMinimumX;
                    x <= RandomConeFormationPlanner.StationaryHoldMaximumX + .01f;
                    x += .25f)
                {
                    Assert.That(plan.RejectsStationaryHold(x, Capability.CollisionHalfWidth),
                        Is.True,
                        "variant " + variant + " leaves stationary X=" + x.ToString("0.00"));
                }
            }
        }

        [Test]
        public void RandomConeFormation_BuildsCollidableArchipelagoShelvesAcrossTheVisibleWidth()
        {
            RandomConeFormationPlan plan = new RandomConeFormationPlanner().Create(
                340f,
                0f,
                TerrainWorldPaceRules.MaximumSpeedForHeat(0),
                Capability,
                1919,
                0);
            int shelfCount = 0;
            for (int rowIndex = 0; rowIndex < plan.RowCount; rowIndex++)
            {
                RandomConeFormationRow row = plan.GetRow(rowIndex);
                int leftCount = 0;
                int rightCount = 0;
                float leftOuterEdge = 0f;
                float leftInnerEdge = float.MinValue;
                float rightInnerEdge = float.MaxValue;
                float rightOuterEdge = 0f;
                for (int featureIndex = 0; featureIndex < plan.FeatureCount; featureIndex++)
                {
                    TerrainWorldFeature feature = plan.GetFeature(featureIndex);
                    if (feature.Kind != TerrainWorldFeatureKind.WaterlineArchipelagoShelf
                        || Math.Abs(feature.Distance - row.Distance) > 5f) continue;
                    shelfCount++;
                    if (feature.CenterX < 0f)
                    {
                        leftCount++;
                        leftOuterEdge = Math.Min(leftOuterEdge, feature.CenterX - feature.HalfWidth);
                        leftInnerEdge = Math.Max(leftInnerEdge, feature.CenterX + feature.HalfWidth);
                    }
                    else
                    {
                        rightCount++;
                        rightInnerEdge = Math.Min(rightInnerEdge, feature.CenterX - feature.HalfWidth);
                        rightOuterEdge = Math.Max(rightOuterEdge, feature.CenterX + feature.HalfWidth);
                    }
                }

                Assert.That(leftCount, Is.EqualTo(RandomConeFormationPlanner.OuterShelfClustersPerSide));
                Assert.That(rightCount, Is.EqualTo(RandomConeFormationPlanner.OuterShelfClustersPerSide));
                Assert.That(leftOuterEdge, Is.LessThanOrEqualTo(-73f));
                Assert.That(rightOuterEdge, Is.GreaterThanOrEqualTo(73f));
                Assert.That(leftInnerEdge, Is.GreaterThanOrEqualTo(-32f));
                Assert.That(rightInnerEdge, Is.LessThanOrEqualTo(32f));
            }

            Assert.That(shelfCount,
                Is.EqualTo(
                    RandomConeFormationPlanner.AuthoredRowCount
                        * RandomConeFormationPlanner.OuterShelfFeatureCountPerRow));
        }

        [Test]
        public void ObstacleAlgorithmBank_IndexesGithubPatternsWithoutActivatingThem()
        {
            Assert.That(ObstacleAlgorithmBank.Count, Is.GreaterThanOrEqualTo(20));
            var ids = new System.Collections.Generic.HashSet<ObstacleAlgorithmId>();
            int active = 0;
            for (int i = 0; i < ObstacleAlgorithmBank.Count; i++)
            {
                ObstacleAlgorithmDescriptor algorithm = ObstacleAlgorithmBank.Get(i);
                Assert.That(ids.Add(algorithm.Id), Is.True, "duplicate " + algorithm.Id);
                Assert.That(algorithm.SourceFile, Does.StartWith("src/"));
                Assert.That(algorithm.PatternRule, Is.Not.Empty);
                Assert.That(algorithm.AntiCampingRule, Is.Not.Empty);
                if (algorithm.ActiveInRockProof) active++;
            }

            ObstacleAlgorithmDescriptor randomCones = ObstacleAlgorithmBank.Get(
                ObstacleAlgorithmId.RandomConeRows);
            Assert.That(randomCones.Targeting, Is.EqualTo(ObstacleTargetingMode.ShipRelativePredicted));
            Assert.That(randomCones.CoreOwner, Is.EqualTo("RandomConeFormationPlanner"));
            Assert.That(active, Is.EqualTo(1));
            Assert.That(randomCones.ActiveInRockProof, Is.True);
            Assert.That(ObstacleAlgorithmBank.Get(ObstacleAlgorithmId.LightningPinch).ActiveInRockProof,
                Is.False);
            Assert.That(ObstacleAlgorithmBank.Get(ObstacleAlgorithmId.ZipperAlternatingGates).ActiveInRockProof,
                Is.False);
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
        public void RockProof_UsesAReadableBurstAndARealEmptyWaterBreatherAtEveryPace()
        {
            for (int heat = 0; heat <= 5; heat++)
            {
                float speed = TerrainWorldPaceRules.MaximumSpeedForHeat(heat);
                TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(heat, heat * 5000f, Capability);
                WorldParcelPlan formation = world.GetParcel(1);
                WorldParcelPlan release = world.GetParcel(2);

                Assert.That(formation.Length / speed, Is.InRange(5.4f, 6.9f), "rock pattern seconds at heat " + heat);
                Assert.That(release.Length / speed,
                    Is.EqualTo(TrueWaveWorldCatalog.EmptyWaterBetweenFormationsSeconds).Within(.01f));
                Assert.That(release.FeatureCount, Is.Zero);
                Assert.That(release.Threats.Kind, Is.EqualTo(WorldThreatKind.None));
                Assert.That(release.Cargo.CollectibleCount, Is.Zero);
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
        public void ProofCatalog_ContainsNoCanyonParcel()
        {
            TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability);
            for (int i = 0; i < world.ParcelCount; i++)
                Assert.That(world.GetParcel(i).Kind, Is.Not.EqualTo(WorldParcelKind.CrystallineCanyon));
        }

        [Test]
        public void OpenWaterHasNoInheritedShoreAndRockRemainsPhysical()
        {
            var runtime = new TerrainWorldRuntime(Capability);
            var eventOwner = new JetHorizonSimulation(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f,
                TerrainWorldMode = true
            }, 77u);
            WorldParcelPlan opening = runtime.World.GetParcel(0);
            TerrainWorldFeature rock = runtime.World.GetFeature(0);

            TerrainWorldTickResult water = runtime.Tick(
                opening.StartDistance + opening.Length * .5f,
                149f,
                0f,
                1f,
                false,
                eventOwner.Events);
            Assert.That(water.CollisionEntered, Is.False, "open water must not inherit transport shores");

            TerrainWorldTickResult wall = runtime.Tick(
                rock.Distance,
                rock.CenterX,
                0f,
                1f,
                false,
                eventOwner.Events);
            Assert.That(wall.CollisionEntered, Is.True, "rock formation must remain physical");
        }

        [Test]
        public void ProofCatalog_ContainsNoRoutePortal()
        {
            TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability);
            Assert.That(world.RouteSectionCount, Is.Zero);
            for (int i = 0; i < world.ParcelCount; i++)
                Assert.That(world.GetParcel(i).Kind, Is.Not.EqualTo(WorldParcelKind.RoutePortal));
        }

        [Test]
        public void EveryActiveObstacleParcelIsTheSmallRockFormation()
        {
            for (int sector = 0; sector < 12; sector++)
            {
                TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(sector, sector * 1800f, Capability);
                for (int i = 0; i < world.ParcelCount; i++)
                    if (!world.GetParcel(i).IsBreather)
                        Assert.That(world.GetParcel(i).Kind, Is.EqualTo(WorldParcelKind.OpenWaterFormation));
            }
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
        public void ConsecutiveRockProofsChangeFormationVariantOnly()
        {
            WorldParcelSequencePlan a = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability).Parcels;
            WorldParcelSequencePlan b = TerrainWorldCatalog.CreateProofWorld(1, a.EndDistance, Capability).Parcels;

            Assert.That(a.ParcelCount, Is.EqualTo(3));
            Assert.That(b.ParcelCount, Is.EqualTo(3));
            Assert.That(a.GetParcel(1).Kind, Is.EqualTo(WorldParcelKind.OpenWaterFormation));
            Assert.That(b.GetParcel(1).Kind, Is.EqualTo(WorldParcelKind.OpenWaterFormation));
            Assert.That(a.GetParcel(1).VariantId, Is.Not.EqualTo(b.GetParcel(1).VariantId));
        }

        [Test]
        public void EverySectorKeepsOtherFamiliesDormant()
        {
            for (int sector = 0; sector < 18; sector++)
            {
                TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(sector, sector * 1800f, Capability);
                Assert.That(world.ParcelCount, Is.EqualTo(3));
                Assert.That(world.GetParcel(1).Kind, Is.EqualTo(WorldParcelKind.OpenWaterFormation));
                Assert.That(world.GetParcel(0).IsBreather, Is.True);
                Assert.That(world.GetParcel(2).IsBreather, Is.True);
            }
        }

        [Test]
        public void RuntimeTrace_IsWaveThenBehindThenEmptyWaterThenRevealThenWave()
        {
            WorldParcelSequencePlan sequence = TerrainWorldCatalog.CreateProofWorld(0, 0f, Capability).Parcels;
            WorldParcelPlan formation = sequence.GetParcel(1);
            WorldParcelPlan water = sequence.GetParcel(2);
            var runtime = new WorldParcelRuntime();

            runtime.Reset(sequence, formation.StartDistance + formation.Length * .5f);
            Assert.That(runtime.Snapshot.Active, Is.SameAs(formation));
            Assert.That(runtime.Snapshot.ActiveLifecycle, Is.EqualTo(WorldParcelLifecycle.Active));

            runtime.Sync(formation.EndDistance + 1f);
            Assert.That(runtime.Snapshot.Previous, Is.SameAs(formation));
            Assert.That(runtime.Snapshot.PreviousLifecycle, Is.EqualTo(WorldParcelLifecycle.PassingBehind));
            Assert.That(runtime.Snapshot.Active, Is.SameAs(water));
            Assert.That(runtime.Snapshot.Active.Envelope, Is.EqualTo(WorldEnvelopeKind.None));

            Assert.That(runtime.Snapshot.Next, Is.Null);
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
