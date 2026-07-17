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
        public void TerrainWorld_PublishesOnePersistentTopologyAndNoLegacyGates()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            SimulationSnapshot start = simulation.Snapshot;

            Assert.That(start.TerrainWorldMode, Is.True);
            Assert.That(start.TerrainWorldId, Is.EqualTo("terrain-world-00"));
            Assert.That(start.TerrainWorldSectionCount, Is.GreaterThan(40));
            Assert.That(start.TerrainWorldFeatureCount, Is.EqualTo(1));
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
        public void TerrainWorld_ProgressesThroughStormPrismAndExtraction()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            float startingSpeed = simulation.Snapshot.Speed;
            bool sawStorm = false;
            bool sawPrismatic = false;

            for (int i = 0; i < 9000 && !simulation.Snapshot.ExtractionDecisionOpen; i++)
            {
                simulation.Step(default);
                sawStorm |= simulation.Snapshot.ActiveTerrainRegion == TerrainRegionKind.StormChannel;
                sawPrismatic |= simulation.Snapshot.ActiveTerrainRegion == TerrainRegionKind.PrismaticReach;
            }

            Assert.That(sawStorm, Is.True);
            Assert.That(sawPrismatic, Is.True);
            Assert.That(simulation.Snapshot.ExtractionDecisionOpen, Is.True);
            Assert.That(simulation.Snapshot.GateCount, Is.Zero);
            Assert.That(simulation.Snapshot.GateEarnedSpeed, Is.GreaterThan(0f));
            Assert.That(simulation.Snapshot.Speed, Is.GreaterThan(startingSpeed));
        }

        [Test]
        public void ContinueDeeper_KeepsCurrentWorldUntilItsOpenWaterSeam()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            while (!simulation.Snapshot.ExtractionDecisionOpen) simulation.Step(default);

            string currentWorld = simulation.Snapshot.TerrainWorldId;
            float currentWorldEnd = simulation.Snapshot.TerrainWorldStartDistance
                + simulation.Snapshot.TerrainWorldLength;
            Assert.That(simulation.TryResolveExtractionDecision(false, out _), Is.True);
            Assert.That(simulation.Snapshot.TerrainWorldId, Is.EqualTo(currentWorld));

            simulation.Step(default);
            Assert.That(simulation.Snapshot.TerrainWorldId, Is.EqualTo(currentWorld));
            while (simulation.Snapshot.TerrainWorldId == currentWorld) simulation.Step(default);

            Assert.That(simulation.Snapshot.Distance, Is.GreaterThanOrEqualTo(currentWorldEnd));
            Assert.That(simulation.Snapshot.TerrainWorldId, Is.EqualTo("terrain-world-01"));
            Assert.That(simulation.Snapshot.ActiveTerrainRegion, Is.EqualTo(TerrainRegionKind.OpenSea));
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
                MaxTerrainWorldFeatures = 8
            }, 16072026u);
            simulation.StartRun(16072026L);
            return simulation;
        }
    }
}
