using JetHorizon.Simulation;
using NUnit.Framework;

namespace JetHorizon.Tests.Architecture
{
    public sealed class TerrainWorldArchitectureTests
    {
        [Test]
        public void WorldTopology_IsNavigableAtEveryHeatAndCoversTheFullRun()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });

            for (int sector = 0; sector <= 5; sector++)
            {
                TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(
                    sector,
                    sector * 4000f,
                    capability);
                TerrainWorldValidation validation = new TerrainWorldValidator().Validate(
                    world,
                    capability,
                    sector);

                Assert.That(validation.IsValid, Is.True, $"sector {sector}");
                Assert.That(validation.Traversal.Reachable, Is.True, $"sector {sector} reachable");
                Assert.That(validation.Traversal.Comfortable, Is.True, $"sector {sector} comfortable");
                Assert.That(validation.Traversal.RejectsNeutral, Is.True, $"sector {sector} neutral");
                Assert.That(validation.Traversal.RejectsConstantLeft, Is.True, $"sector {sector} left");
                Assert.That(validation.Traversal.RejectsConstantRight, Is.True, $"sector {sector} right");
                Assert.That(validation.Traversal.ForwardSpeed,
                    Is.EqualTo(TerrainWorldPaceRules.MaximumSpeedForHeat(sector)).Within(.01f));
                Assert.That(world.GetRegion(0).Kind, Is.EqualTo(TerrainRegionKind.OpenSea));
                Assert.That(world.GetRegion(world.RegionCount - 1).Kind,
                    Is.EqualTo(TerrainRegionKind.ExtractionBreather));
                Assert.That(world.GetSection(0).Distance, Is.Zero);
                Assert.That(world.GetSection(world.SectionCount - 1).Distance,
                    Is.EqualTo(world.Length));
                Assert.That(world.GetFeature(0).Requirement, Is.EqualTo(TraversalRequirement.None));
            }
        }

        [Test]
        public void NaturalArch_DoesNotCreateAnInvisibleRollOnlyCollisionPlane()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            var runtime = new TerrainWorldRuntime(capability);
            TerrainWorldFeature feature = runtime.World.GetFeature(0);
            var eventOwner = new JetHorizonSimulation(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            }, 49u);
            SimulationEventBuffer events = eventOwner.Events;

            TerrainWorldTickResult result = runtime.Tick(
                feature.Distance,
                feature.CenterX,
                0f,
                (float)(System.Math.PI * .5),
                false,
                events);

            Assert.That(result.CollisionEntered, Is.False);
        }

        [Test]
        public void ConsecutiveWorlds_UseDifferentCourseSentencesAndRouteGeometry()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            TerrainWorldPlan first = TerrainWorldCatalog.CreateProofWorld(0, 0f, capability);
            TerrainWorldPlan second = TerrainWorldCatalog.CreateProofWorld(1, first.Length, capability);
            TerrainWorldPlan third = TerrainWorldCatalog.CreateProofWorld(2, first.Length + second.Length, capability);

            Assert.That(first.Course, Is.EqualTo(TerrainCourseKind.ThreeHoleApproach));
            Assert.That(second.Course, Is.EqualTo(TerrainCourseKind.InvertedKnifeRun));
            Assert.That(third.Course, Is.EqualTo(TerrainCourseKind.BasinSwitchback));
            Assert.That(first.GetRegion(1).Kind, Is.EqualTo(TerrainRegionKind.CoastalWeave));
            Assert.That(second.GetRegion(1).Kind, Is.EqualTo(TerrainRegionKind.OpenSea));
            Assert.That(third.GetRegion(1).Kind, Is.EqualTo(TerrainRegionKind.StormChannel));
            Assert.That(first.RouteSectionCount, Is.EqualTo(33));
            Assert.That(second.RouteSectionCount, Is.EqualTo(33));
            first.TryGetRoutePassage(TerrainRouteKind.KnifeEdgeTunnel, 2120f, out float firstLeft, out _, out _);
            second.TryGetRoutePassage(TerrainRouteKind.KnifeEdgeTunnel, 2120f, out float secondLeft, out _, out _);
            third.TryGetRoutePassage(TerrainRouteKind.KnifeEdgeTunnel, 2120f, out float thirdLeft, out _, out _);
            Assert.That(firstLeft, Is.Not.EqualTo(secondLeft).Within(.01f));
            Assert.That(secondLeft, Is.Not.EqualTo(thirdLeft).Within(.01f));
        }

        [Test]
        public void CourseCatalog_RotatesSixAuthoredArchetypesBeforeChangingCircuit()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            var observed = new System.Collections.Generic.HashSet<TerrainCourseKind>();
            for (int sector = 0; sector < 6; sector++)
                observed.Add(TerrainWorldCatalog.CreateProofWorld(sector, sector * 4120f, capability).Course);

            Assert.That(observed.Count, Is.EqualTo(6));
            TerrainWorldPlan firstCircuitEnd = TerrainWorldCatalog.CreateProofWorld(5, 0f, capability);
            TerrainWorldPlan nextCircuitStart = TerrainWorldCatalog.CreateProofWorld(6, firstCircuitEnd.Length, capability);
            Assert.That(nextCircuitStart.Course, Is.Not.EqualTo(TerrainCourseKind.ThreeHoleApproach));
        }

        [Test]
        public void TerrainWorld_PublishesOnePersistentTopologyAndNoLegacyGates()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            SimulationSnapshot start = simulation.Snapshot;

            Assert.That(start.TerrainWorldMode, Is.True);
            Assert.That(start.TerrainWorldId, Is.EqualTo("terrain-world-00"));
            Assert.That(start.TerrainWorldSectionCount, Is.GreaterThan(24));
            Assert.That(start.TerrainWorldFeatureCount, Is.EqualTo(8));
            Assert.That(start.TerrainRouteSectionCount, Is.EqualTo(33));
            Assert.That(start.GateCount, Is.Zero);
            Assert.That(start.ActiveTerrainRegion, Is.EqualTo(TerrainRegionKind.OpenSea));

            int sectionCount = start.TerrainWorldSectionCount;
            float firstDistance = start.GetTerrainWorldSection(0).Distance;
            for (int i = 0; i < 240; i++) simulation.Step(default);

            Assert.That(simulation.Snapshot.TerrainWorldSectionCount, Is.EqualTo(sectionCount));
            Assert.That(simulation.Snapshot.GetTerrainWorldSection(0).Distance,
                Is.EqualTo(firstDistance));
            Assert.That(simulation.Snapshot.GateCount, Is.Zero);
        }

        [Test]
        public void TerrainWorld_ProgressesThroughStormOpenWaterAndAutomaticBreather()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            float startingSpeed = simulation.Snapshot.Speed;
            bool sawStorm = false;
            bool sawReturnToOpenWater = false;
            bool sawBreather = false;
            string firstWorld = simulation.Snapshot.TerrainWorldId;

            for (int i = 0; i < 9000 && simulation.Snapshot.TerrainWorldId == firstWorld; i++)
            {
                simulation.Step(default);
                sawStorm |= simulation.Snapshot.ActiveTerrainRegion == TerrainRegionKind.StormChannel;
                sawReturnToOpenWater |= simulation.Snapshot.Distance >= 3190f
                    && simulation.Snapshot.ActiveTerrainRegion == TerrainRegionKind.OpenSea;
                sawBreather |= simulation.Snapshot.ActiveTerrainRegion == TerrainRegionKind.ExtractionBreather;
                Assert.That(simulation.Snapshot.ExtractionDecisionOpen, Is.False);
                Assert.That(simulation.Snapshot.CorridorSliceCount, Is.Zero);
                Assert.That(simulation.Snapshot.SineCorridorActive, Is.False);
            }

            Assert.That(sawStorm, Is.True);
            Assert.That(sawReturnToOpenWater, Is.True);
            Assert.That(sawBreather, Is.True);
            Assert.That(simulation.Snapshot.TerrainWorldId, Is.EqualTo("terrain-world-01"));
            Assert.That(simulation.Snapshot.GateCount, Is.Zero);
            Assert.That(simulation.Snapshot.GateEarnedSpeed, Is.GreaterThan(0f));
            Assert.That(simulation.Snapshot.Speed, Is.GreaterThan(startingSpeed));
        }

        [Test]
        public void AutomaticBreather_KeepsCurrentWorldUntilItsOpenWaterSeam()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            string currentWorld = simulation.Snapshot.TerrainWorldId;
            float currentWorldEnd = simulation.Snapshot.TerrainWorldStartDistance
                + simulation.Snapshot.TerrainWorldLength;
            while (string.IsNullOrEmpty(simulation.Snapshot.QueuedTerrainWorldId))
                simulation.Step(default);
            Assert.That(simulation.Snapshot.ActiveTerrainRegion,
                Is.Not.EqualTo(TerrainRegionKind.ExtractionBreather));
            Assert.That(simulation.Snapshot.QueuedTerrainWorldId, Is.EqualTo("terrain-world-01"));
            Assert.That(simulation.Snapshot.QueuedTerrainWorldStartDistance,
                Is.EqualTo(currentWorldEnd).Within(.01f));
            Assert.That(simulation.Snapshot.QueuedTerrainWorldSectionCount, Is.GreaterThan(24));
            Assert.That(simulation.Snapshot.QueuedTerrainRouteSectionCount, Is.EqualTo(33));
            while (simulation.Snapshot.ActiveTerrainRegion != TerrainRegionKind.ExtractionBreather)
                simulation.Step(default);
            Assert.That(simulation.Snapshot.ExtractionDecisionOpen, Is.False);
            Assert.That(simulation.Snapshot.HazardCount, Is.Zero);
            Assert.That(simulation.Snapshot.PickupCount, Is.Zero);
            Assert.That(simulation.Snapshot.CorridorSliceCount, Is.Zero);
            Assert.That(simulation.TryResolveExtractionDecision(false, out _), Is.False);
            while (simulation.Snapshot.TerrainWorldId == currentWorld) simulation.Step(default);

            Assert.That(simulation.Snapshot.Distance, Is.GreaterThanOrEqualTo(currentWorldEnd));
            Assert.That(simulation.Snapshot.TerrainWorldId, Is.EqualTo("terrain-world-01"));
            Assert.That(simulation.Snapshot.ActiveTerrainRegion, Is.EqualTo(TerrainRegionKind.OpenSea));
        }

        [Test]
        public void StormChannel_UsesGithubShipRelativeRandomLoopAtStrongFrequency()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            while (simulation.Snapshot.ActiveTerrainRegion != TerrainRegionKind.StormChannel)
                simulation.Step(default);

            int maximumConcurrentLightning = 0;
            for (int frame = 0; frame < 75; frame++)
            {
                simulation.Step(default);
                int lightning = 0;
                for (int i = 0; i < simulation.Snapshot.HazardCount; i++)
                {
                    HazardSnapshot hazard = simulation.Snapshot.GetHazard(i);
                    if (hazard.Kind != HazardKind.Lightning) continue;
                    lightning++;
                    Assert.That(System.Math.Abs(hazard.X), Is.LessThanOrEqualTo(1.51f));
                }
                maximumConcurrentLightning = System.Math.Max(maximumConcurrentLightning, lightning);
            }

            // Source PRE_T4A runs at one strike every .3 seconds. Over this
            // 1.25-second sample it must clearly exceed the old tiny burst cadence.
            Assert.That(maximumConcurrentLightning, Is.GreaterThanOrEqualTo(3));
        }

        [Test]
        public void OpenWaterFormations_HaveVisibleFootprintCollisionAndLeaveAWideRoute()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            var runtime = new TerrainWorldRuntime(capability);
            var eventOwner = new JetHorizonSimulation(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            }, 67u);
            TerrainWorldFeature mass = runtime.World.GetFeature(1);

            TerrainWorldTickResult hit = runtime.Tick(
                mass.Distance,
                mass.CenterX,
                0f,
                (float)(System.Math.PI * .5),
                false,
                eventOwner.Events);
            TerrainWorldTickResult safe = runtime.Tick(
                mass.Distance,
                -40f,
                0f,
                (float)(System.Math.PI * .5),
                false,
                eventOwner.Events);

            Assert.That(TerrainWorldFeatureRules.IsWaterFormation(mass.Kind), Is.True);
            Assert.That(hit.CollisionEntered, Is.True);
            Assert.That(safe.CollisionEntered, Is.False);
        }

        [Test]
        public void RouteJunction_ProvidesThreePhysicalPassagesAndBlocksTheTerrainBetweenThem()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            var runtime = new TerrainWorldRuntime(capability);
            TerrainWorldPlan world = runtime.World;
            const float distance = 2120f;
            Assert.That(world.TryGetRoutePassage(TerrainRouteKind.SafeCanyon, distance, out _, out float safeRight, out _), Is.True);
            Assert.That(world.TryGetRoutePassage(TerrainRouteKind.KnifeEdgeTunnel, distance, out float knifeLeft, out float knifeRight, out float ceiling), Is.True);
            Assert.That(world.TryGetRoutePassage(TerrainRouteKind.CargoChannel, distance, out float cargoLeft, out _, out _), Is.True);
            Assert.That(knifeRight - knifeLeft, Is.LessThan(22f));
            Assert.That(ceiling, Is.GreaterThan(40f));
            Assert.That(knifeLeft - safeRight, Is.GreaterThan(4f));
            Assert.That(cargoLeft - knifeRight, Is.GreaterThan(4f));

            var eventOwner = new JetHorizonSimulation(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            }, 91u);
            TerrainWorldTickResult safe = runtime.Tick(
                distance,
                (knifeLeft + knifeRight) * .5f,
                0f,
                (float)(System.Math.PI * .5),
                false,
                eventOwner.Events);
            TerrainWorldTickResult blocked = runtime.Tick(
                distance,
                (safeRight + knifeLeft) * .5f,
                0f,
                (float)(System.Math.PI * .5),
                false,
                eventOwner.Events);
            Assert.That(safe.CollisionEntered, Is.False);
            Assert.That(blocked.CollisionEntered, Is.True);
        }

        [Test]
        public void FormationCadence_IsAuthoredInTimeAcrossSectorSpeeds()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            for (int sector = 0; sector <= 5; sector++)
            {
                TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(sector, sector * 4120f, capability);
                float speed = TerrainWorldPaceRules.MaximumSpeedForHeat(sector);
                float previousDistance = -1f;
                int formationCount = 0;
                for (int i = 0; i < world.FeatureCount; i++)
                {
                    TerrainWorldFeature feature = world.GetFeature(i);
                    if (!TerrainWorldFeatureRules.IsWaterFormation(feature.Kind)) continue;
                    if (previousDistance >= 0f)
                    {
                        float seconds = (feature.Distance - previousDistance) / speed;
                        Assert.That(seconds, Is.InRange(.95f, 1.20f), $"sector {sector}, beat {i}");
                    }
                    previousDistance = feature.Distance;
                    formationCount++;
                }
                Assert.That(formationCount, Is.GreaterThanOrEqualTo(6), $"sector {sector}");
            }
        }

        [Test]
        public void TraversalMath_ConvertsHandlingAndReactionIntoForwardWarningDistance()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            float shortReach = TraversalEnvelopeRules.ReachFromRest(
                .5f,
                capability.LateralAcceleration,
                capability.MaximumLateralVelocity);
            float warningDistance = TraversalEnvelopeRules.RequiredForwardDistanceFromRest(
                10f,
                140f,
                capability);

            Assert.That(shortReach, Is.EqualTo(5.39f).Within(.1f));
            Assert.That(warningDistance, Is.GreaterThan(165f));
            Assert.That(warningDistance, Is.LessThan(185f));
        }

        static JetHorizonSimulation CreateTerrainSimulation()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                TerrainWorldMode = true,
                GateRunMode = false,
                ProofEncounterMode = false,
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f,
                CollisionEnabled = false,
                HazardSpawningEnabled = true,
                HazardSimulationEnabled = true,
                PickupSimulationEnabled = true,
                MaxHazards = 600,
                MaxPickups = 128,
                MaxCorridorSlices = 128,
                MaxTerrainWorldSections = 64,
                MaxTerrainWorldFeatures = 8,
                MaxTerrainRouteSections = 48
            }, 16072026u);
            simulation.StartRun(16072026L);
            return simulation;
        }
    }
}
