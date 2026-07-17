using JetHorizon.Simulation;
using NUnit.Framework;

namespace JetHorizon.Tests.Architecture
{
    public sealed class TerrainCourseArchitectureTests
    {
        [Test]
        public void ProofCourse_IsTraversableAtEveryHeatAndRetainsPrismaticBeat()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 1.5f,
                MinimumOperationalSpeed = 50f
            });

            for (int sector = 0; sector <= 5; sector++)
            {
                TerrainCoursePlan course = TerrainCourseCatalog.CreateProofSector(
                    sector,
                    sector * 4000f,
                    capability);
                TerrainCourseValidation validation = new TerrainCourseValidator().Validate(
                    course,
                    capability,
                    sector);

                Assert.That(validation.IsValid, Is.True, $"sector {sector}");
                Assert.That(course.GetBeat(0).Kind, Is.EqualTo(TerrainBeatKind.OpenWater));
                Assert.That(course.GetBeat(6).Kind, Is.EqualTo(TerrainBeatKind.PrismaticCorridor));
                Assert.That(course.GetBeat(7).Kind, Is.EqualTo(TerrainBeatKind.ExtractionBreather));
            }
        }

        [Test]
        public void TerrainMode_PublishesTheCompletePersistentCourseAndNoLegacyGates()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            SimulationSnapshot start = simulation.Snapshot;

            Assert.That(start.TerrainRunMode, Is.True);
            Assert.That(start.TerrainCourseId, Is.EqualTo("terrain-sector-00"));
            Assert.That(start.TerrainFormationCount, Is.EqualTo(10));
            Assert.That(start.TerrainTraversalCount, Is.EqualTo(39));
            Assert.That(start.GateCount, Is.Zero);
            Assert.That(start.ActiveTerrainBeat, Is.EqualTo(TerrainBeatKind.OpenWater));

            float firstZ = start.GetTerrainFormation(0).Z;
            for (int i = 0; i < 240; i++) simulation.Step(default);

            Assert.That(simulation.Snapshot.TerrainFormationCount, Is.EqualTo(10));
            Assert.That(simulation.Snapshot.GetTerrainFormation(0).Z - firstZ,
                Is.EqualTo(simulation.Snapshot.Distance).Within(.02f));
            Assert.That(simulation.Snapshot.GateCount, Is.Zero);
        }

        [Test]
        public void TerrainMode_UsesAuthoredCadenceAndEarnsSpeedBeforeExtraction()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            float startingSpeed = simulation.Snapshot.Speed;
            bool sawLightning = false;
            bool sawPrismatic = false;

            for (int i = 0; i < 9000 && !simulation.Snapshot.ExtractionDecisionOpen; i++)
            {
                simulation.Step(default);
                sawLightning |= simulation.Snapshot.ActiveTerrainBeat == TerrainBeatKind.LightningPassage;
                sawPrismatic |= simulation.Snapshot.ActiveTerrainBeat == TerrainBeatKind.PrismaticCorridor;
            }

            Assert.That(sawLightning, Is.True);
            Assert.That(sawPrismatic, Is.True);
            Assert.That(simulation.Snapshot.ExtractionDecisionOpen, Is.True);
            Assert.That(simulation.Snapshot.GateCount, Is.Zero);
            Assert.That(simulation.Snapshot.GateEarnedSpeed, Is.GreaterThan(0f));
            Assert.That(simulation.Snapshot.Speed, Is.GreaterThan(startingSpeed));
        }

        static JetHorizonSimulation CreateTerrainSimulation()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                TerrainRunMode = true,
                GateRunMode = false,
                ProofEncounterMode = false,
                StartSpeedMultiplier = 1.5f,
                MinimumOperationalSpeed = 50f,
                CollisionEnabled = false,
                HazardSpawningEnabled = true,
                HazardSimulationEnabled = true,
                PickupSimulationEnabled = true,
                MaxHazards = 600,
                MaxPickups = 128,
                MaxCorridorSlices = 128,
                MaxTerrainFormations = 24,
                MaxTerrainTraversalSamples = 64
            }, 16072026u);
            simulation.StartRun(16072026L);
            return simulation;
        }
    }
}
