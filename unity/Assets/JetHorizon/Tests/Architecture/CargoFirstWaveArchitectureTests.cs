using JetHorizon.Simulation;
using NUnit.Framework;

namespace JetHorizon.Tests.Architecture
{
    public sealed class CargoFirstWaveArchitectureTests
    {
        [Test]
        public void Catalog_ProducesValidatedCoinRoutesForEverySupportedPace()
        {
            ShipCapabilityProfile capability = CreateCapability();
            float worldStart = 0f;
            for (int sector = 0; sector < 6; sector++)
            {
                TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(
                    sector,
                    worldStart,
                    capability);
                CargoWaveSequencePlan sequence = CargoFirstWaveCatalog.Create(world, capability);
                CargoWaveValidation validation = new CargoWaveValidator().Validate(
                    sequence,
                    world,
                    capability);

                Assert.That(validation.IsValid, Is.True, $"sector {sector}");
                Assert.That(sequence.WaveCount, Is.EqualTo(world.WaveCount));
                Assert.That(sequence.GetWave(0).StartDistance, Is.EqualTo(world.StartDistance));
                Assert.That(sequence.GetWave(sequence.WaveCount - 1).EndDistance,
                    Is.EqualTo(world.EndDistance).Within(.01f));
                for (int waveIndex = 0; waveIndex < sequence.WaveCount; waveIndex++)
                {
                    CargoWavePlan wave = sequence.GetWave(waveIndex);
                    Assert.That(wave.RoutePointCount,
                        Is.GreaterThanOrEqualTo(wave.IsBreather ? 3 : 5));
                    Assert.That(wave.CollectibleCount,
                        wave.IsBreather
                            ? Is.EqualTo(0)
                            : wave.Kind == TerrainWaveKind.OpenWaterFormation
                                ? Is.EqualTo(RandomConeFormationPlanner.AuthoredRowCount * 7)
                                : Is.InRange(1, wave.RoutePointCount));
                    Assert.That(wave.HorizonRevealDistance, Is.GreaterThan(wave.ApproachDistance));
                }
                worldStart = world.EndDistance;
            }
        }

        [Test]
        public void Runtime_QueuesTheCompleteNextWaveWorldBeforeTheTerrainSeam()
        {
            ShipCapabilityProfile capability = CreateCapability();
            var runtime = new TerrainWorldRuntime(capability);
            var eventOwner = new JetHorizonSimulation(new SimulationConfig(), 71u);

            Assert.That(runtime.CargoWaves, Is.Not.Null);
            Assert.That(runtime.CargoWaveState.Lifecycle, Is.EqualTo(CargoWaveLifecycle.Rest));

            runtime.Tick(
                runtime.World.EndDistance - 100f,
                0f,
                0f,
                (float)(System.Math.PI * .5),
                true,
                eventOwner.Events);

            Assert.That(runtime.QueuedWorld, Is.Not.Null);
            Assert.That(runtime.QueuedCargoWaves, Is.Not.Null);
            Assert.That(runtime.QueuedCargoWaves.WorldId, Is.EqualTo(runtime.QueuedWorld.Id));
            Assert.That(runtime.QueuedCargoWaves.WaveCount, Is.EqualTo(runtime.QueuedWorld.WaveCount));
        }

        [Test]
        public void Simulation_RegistersCoreAuthoredWaveCargoWithoutUnitySpawningRules()
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
                MaxTerrainWorldFeatures = 128,
                MaxTerrainRouteSections = 48
            }, 17072026u);
            simulation.StartRun(17072026L);
            // The first run has two seconds of orientation water. With the source
            // 160-unit preview, the formation enters horizon reveal at distance 96.
            while (simulation.Snapshot.Distance < 110f) simulation.Step(default);

            Assert.That(simulation.Snapshot.CargoWaveId, Is.Not.Empty);
            Assert.That(simulation.Snapshot.CargoWaveLifecycle,
                Is.EqualTo(CargoWaveLifecycle.HorizonReveal));
            Assert.That(simulation.Snapshot.PickupCount, Is.GreaterThanOrEqualTo(4));

            int coins = 0;
            for (int i = 0; i < simulation.Snapshot.PickupCount; i++)
            {
                PickupSnapshot pickup = simulation.Snapshot.GetPickup(i);
                if (pickup.Kind == PickupKind.Coin) coins++;
            }
            Assert.That(coins, Is.EqualTo(RandomConeFormationPlanner.AuthoredRowCount * 7));
        }

        static ShipCapabilityProfile CreateCapability()
        {
            return ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
        }
    }
}
