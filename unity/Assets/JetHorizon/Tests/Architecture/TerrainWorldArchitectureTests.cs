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
                WorldParcelValidation validation = new WorldParcelValidator().Validate(
                    world.Parcels,
                    capability,
                    TerrainWorldPaceRules.MaximumSpeedForHeat(sector));

                Assert.That(validation.IsValid, Is.True, $"sector {sector}");
                Assert.That(validation.BreathersAreEmpty, Is.True, $"sector {sector} breathers");
                Assert.That(validation.BreathersSeparateMajorWaves, Is.True, $"sector {sector} cadence");
                Assert.That(validation.RoutesArePhysical, Is.True, $"sector {sector} routes");
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
        public void FirstWaterlineFormation_HasARealCollisionFootprint()
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

            Assert.That(result.CollisionEntered, Is.True);
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
            Assert.That(first.GetParcel(3).Kind, Is.EqualTo(WorldParcelKind.CrystallineCanyon));
            Assert.That(second.GetParcel(3).Kind, Is.EqualTo(WorldParcelKind.OpenWaterLightning));
            Assert.That(third.GetParcel(3).Kind, Is.EqualTo(WorldParcelKind.RoutePortal));
            Assert.That(first.Parcels.Id, Is.Not.EqualTo(second.Parcels.Id));
            Assert.That(second.GetParcel(5).VariantId, Is.Not.EqualTo(third.GetParcel(5).VariantId));
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
            var selector = new DeterministicWorldParcelSelector();
            Assert.That(selector.Select(5).Signature, Is.Not.EqualTo(selector.Select(6).Signature));
        }

        [Test]
        public void WorldWaveSentence_ResetsBeforeItsPortalAndUsesARealTunnelChoice()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(0, 0f, capability);

            Assert.That(world.WaveCount, Is.EqualTo(7));
            Assert.That(world.GetWave(0).Kind, Is.EqualTo(TerrainWaveKind.OpenWaterBreather));
            Assert.That(world.GetWave(1).Kind, Is.EqualTo(TerrainWaveKind.OpenWaterFormation));
            Assert.That(world.GetWave(2).Kind, Is.EqualTo(TerrainWaveKind.OpenWaterBreather));
            Assert.That(world.GetWave(3).Kind, Is.EqualTo(TerrainWaveKind.CrystallineCanyon));
            Assert.That(world.GetWave(4).Kind, Is.EqualTo(TerrainWaveKind.OpenWaterBreather));
            Assert.That(world.GetWave(3).EndDistance,
                Is.LessThanOrEqualTo(world.GetWave(5).StartDistance));
            WorldParcelPlan portal = world.GetParcel(5);
            float portalMid = portal.LocalStartDistance + portal.Length * .5f;
            Assert.That(world.TryGetRoutePassage(TerrainRouteKind.SafeCanyon, portalMid,
                out float safeLeft, out float safeRight, out _), Is.True);
            Assert.That(world.TryGetRoutePassage(TerrainRouteKind.KnifeEdgeTunnel, portalMid,
                out float knifeLeft, out float knifeRight, out _), Is.True);
            Assert.That(knifeLeft - safeRight, Is.GreaterThan(8f));
        }

        [Test]
        public void L3KnifeTunnel_UsesTheCanonicalLongSineRatherThanRandomWander()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(0, 0f, capability);
            WorldParcelPlan portal = world.GetParcel(5);
            world.TryGetRoutePassage(TerrainRouteKind.KnifeEdgeTunnel, portal.LocalStartDistance + portal.Length * .08f,
                out float entryLeft, out float entryRight, out _);
            world.TryGetRoutePassage(TerrainRouteKind.KnifeEdgeTunnel, portal.LocalStartDistance + portal.Length * .50f,
                out float bendLeft, out float bendRight, out float bendCeiling);
            world.TryGetRoutePassage(TerrainRouteKind.KnifeEdgeTunnel, portal.LocalStartDistance + portal.Length * .92f,
                out float returnLeft, out float returnRight, out _);

            float entryCenter = (entryLeft + entryRight) * .5f;
            float bendCenter = (bendLeft + bendRight) * .5f;
            float returnCenter = (returnLeft + returnRight) * .5f;
            Assert.That(bendRight - bendLeft, Is.LessThan(entryRight - entryLeft));
            Assert.That(bendRight - bendLeft, Is.LessThan(returnRight - returnLeft));
            Assert.That(bendCeiling, Is.GreaterThan(20f));
        }

        [Test]
        public void TerrainWorld_PublishesOnePersistentTopologyAndNoLegacyGates()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            SimulationSnapshot start = simulation.Snapshot;

            Assert.That(start.TerrainWorldMode, Is.True);
            Assert.That(start.TerrainWorldId, Is.EqualTo("terrain-world-00"));
            Assert.That(start.TerrainWorldSectionCount, Is.GreaterThan(12));
            Assert.That(start.TerrainWorldFeatureCount, Is.GreaterThanOrEqualTo(8));
            Assert.That(start.TerrainRouteSectionCount, Is.EqualTo(24));
            Assert.That(start.WorldParcelCount, Is.EqualTo(7));
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

            for (int i = 0; i < 18000 && simulation.Snapshot.TerrainWorldId != "terrain-world-02"; i++)
            {
                simulation.Step(default);
                sawStorm |= simulation.Snapshot.ActiveTerrainRegion == TerrainRegionKind.StormChannel;
                sawReturnToOpenWater |= simulation.Snapshot.ActiveWorldParcelKind == WorldParcelKind.OpenWaterBreather;
                sawBreather |= simulation.Snapshot.ActiveTerrainRegion == TerrainRegionKind.ExtractionBreather;
                Assert.That(simulation.Snapshot.ExtractionDecisionOpen, Is.False);
                Assert.That(simulation.Snapshot.CorridorSliceCount, Is.Zero);
                Assert.That(simulation.Snapshot.SineCorridorActive, Is.False);
            }

            Assert.That(sawStorm, Is.True);
            Assert.That(sawReturnToOpenWater, Is.True);
            Assert.That(sawBreather, Is.True);
            Assert.That(simulation.Snapshot.TerrainWorldId, Is.EqualTo("terrain-world-02"));
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
            Assert.That(simulation.Snapshot.QueuedTerrainWorldSectionCount, Is.GreaterThan(12));
            Assert.That(simulation.Snapshot.QueuedWorldParcelCount, Is.EqualTo(7));
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
                mass.CenterX > 0f ? -60f : 60f,
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
            WorldParcelPlan portal = world.GetParcel(5);
            float distance = portal.LocalStartDistance + portal.Length * .5f;
            Assert.That(world.TryGetRoutePassage(TerrainRouteKind.SafeCanyon, distance, out _, out float safeRight, out _), Is.True);
            Assert.That(world.TryGetRoutePassage(TerrainRouteKind.KnifeEdgeTunnel, distance, out float knifeLeft, out float knifeRight, out float ceiling), Is.True);
            Assert.That(world.TryGetRoutePassage(TerrainRouteKind.CargoChannel, distance, out float cargoLeft, out _, out _), Is.True);
            Assert.That(knifeRight - knifeLeft, Is.LessThan(22f));
            Assert.That(ceiling, Is.GreaterThan(20f));
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
        public void FormationCadence_UsesSourceDistanceRhythmSoHigherSpeedFeelsFaster()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            var planner = new RandomConeFormationPlanner();
            RandomConeFormationPlan slow = planner.Create(
                340f, 0f, TerrainWorldPaceRules.MaximumSpeedForHeat(0), capability, 1810, 0);
            RandomConeFormationPlan fast = planner.Create(
                340f, 0f, TerrainWorldPaceRules.MaximumSpeedForHeat(5), capability, 1810, 0);

            float slowSeconds = 0f;
            float fastSeconds = 0f;
            for (int row = 1; row < slow.RowCount; row++)
            {
                float slowSpacing = slow.GetRow(row).Distance - slow.GetRow(row - 1).Distance;
                float fastSpacing = fast.GetRow(row).Distance - fast.GetRow(row - 1).Distance;
                Assert.That(slowSpacing, Is.InRange(21f, 37f), "source 26-32 spacing plus ±5 jitter");
                Assert.That(fastSpacing, Is.EqualTo(slowSpacing).Within(.001f));
                slowSeconds += slowSpacing / TerrainWorldPaceRules.MaximumSpeedForHeat(0);
                fastSeconds += fastSpacing / TerrainWorldPaceRules.MaximumSpeedForHeat(5);
            }
            Assert.That(fastSeconds, Is.LessThan(slowSeconds * .75f));
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
                MaxTerrainWorldFeatures = 48,
                MaxTerrainRouteSections = 48
            }, 16072026u);
            simulation.StartRun(16072026L);
            return simulation;
        }
    }
}
