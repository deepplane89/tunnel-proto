using JetHorizon.Simulation;
using NUnit.Framework;

namespace JetHorizon.Tests.Architecture
{
    public sealed class GateRunArchitectureTests
    {
        [Test]
        public void GateProgression_IsAdditiveAndRespectsHeatCap()
        {
            var progression = new GateProgressionModel();
            progression.Reset();
            float first = progression.Cross(SpeedGateKind.Common, 36f, 0);
            float second = progression.Cross(SpeedGateKind.Common, 36f, 0);

            Assert.That(first, Is.EqualTo(1f).Within(.001f));
            Assert.That(second, Is.EqualTo(1f).Within(.001f));
            Assert.That(progression.EarnedSpeedBonus, Is.EqualTo(2f).Within(.001f));

            for (int i = 0; i < 80; i++)
                progression.Cross(SpeedGateKind.Surge, 36f, 0);
            GateProgressionState snapshot = progression.Snapshot(36f, 0);
            Assert.That(snapshot.CurrentCruiseSpeed, Is.LessThanOrEqualTo(90f));
            Assert.That(snapshot.SoftCap, Is.EqualTo(90f));
        }

        [Test]
        public void GateRoute_IsPreplannedReachableAndNontrivial()
        {
            var config = new SimulationConfig
            {
                StartSpeedMultiplier = 1f,
                MinimumOperationalSpeed = 36f
            };
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(config);
            var planner = new GateRoutePlanner();
            GateRoutePlan plan = planner.Build(
                0,
                0f,
                capability.CruiseSpeed,
                capability,
                new DeterministicRandom(123u));
            GateRouteValidation validation = new GateRouteValidator().Validate(
                plan,
                capability,
                capability.CruiseSpeed);

            Assert.That(plan.Count, Is.EqualTo(42));
            Assert.That(validation.IsValid, Is.True);
            Assert.That(plan.Get(plan.Count - 1).Kind, Is.EqualTo(SpeedGateKind.Extraction));
        }

        [Test]
        public void GateRunSimulation_StartsSlowAndEarnsSpeedByCrossingGates()
        {
            var simulation = new JetHorizonSimulation(
                new SimulationConfig
                {
                    GateRunMode = true,
                    ProofEncounterMode = false,
                    StartSpeedMultiplier = 1f,
                    MinimumOperationalSpeed = 36f,
                    CollisionEnabled = false,
                    HazardSpawningEnabled = true,
                    MaxHazards = 600,
                    MaxPickups = 128,
                    MaxCorridorSlices = 128,
                    MaxGates = 16
                },
                456u);
            simulation.StartRun(1L);
            float startingSpeed = simulation.Snapshot.Speed;
            for (int i = 0; i < 180; i++)
                simulation.Step(default);

            Assert.That(startingSpeed, Is.EqualTo(36f).Within(.01f));
            Assert.That(simulation.Snapshot.GateRunMode, Is.True);
            Assert.That(simulation.Snapshot.GatesCrossed, Is.GreaterThanOrEqualTo(1));
            Assert.That(simulation.Snapshot.Speed, Is.GreaterThan(startingSpeed));
            Assert.That(simulation.Snapshot.HeatSpeedMultiplier, Is.EqualTo(1f));
            Assert.That(simulation.Snapshot.GateCount, Is.GreaterThan(0));
        }

        [TestCase(AsteroidSequenceKind.Random, 4)]
        [TestCase(AsteroidSequenceKind.Sweep, 5)]
        [TestCase(AsteroidSequenceKind.Stagger, 5)]
        [TestCase(AsteroidSequenceKind.Salvo, 5)]
        [TestCase(AsteroidSequenceKind.Pinch, 11)]
        [TestCase(AsteroidSequenceKind.Chase, 3)]
        public void AsteroidPatterns_PreserveSourceCounts(AsteroidSequenceKind kind, int expected)
        {
            var runtime = new AsteroidSequenceRuntime();
            var output = new AsteroidImpactRequestBuffer(16);
            runtime.Build(kind, 0f, 2f, new DeterministicRandom(77u), output);
            Assert.That(output.Count, Is.EqualTo(expected));
        }

        [Test]
        public void HazardScheduler_ProducesStrongLightningClusterWithoutMixingFamilies()
        {
            var scheduler = new HazardPatternScheduler();
            var output = new ScheduledHazardPatternRequestBuffer(4);
            scheduler.BeginLightning(LightningSequenceKind.Random, 0, 4f, 8f);
            int emitted = 0;
            for (int i = 0; i < 240; i++)
            {
                scheduler.Tick(1f / 60f, output);
                emitted += output.Count;
                for (int request = 0; request < output.Count; request++)
                    Assert.That(output[request].Family, Is.EqualTo(ScheduledHazardFamily.Lightning));
            }
            Assert.That(emitted, Is.EqualTo(4));
            Assert.That(scheduler.ActiveFamily, Is.EqualTo(ScheduledHazardFamily.None));
        }
    }
}
