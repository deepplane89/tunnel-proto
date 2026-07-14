using NUnit.Framework;

namespace JetHorizon.Simulation.Tests
{
    public sealed class JetHorizonSimulationTests
    {
        [Test]
        public void SameSeedAndInputFramesProduceTheSameRun()
        {
            var config = new SimulationConfig { CollisionEnabled = false };
            var a = new JetHorizonSimulation(config, 12345u);
            var b = new JetHorizonSimulation(config, 12345u);
            a.StartRun();
            b.StartRun();

            for (int tick = 0; tick < 900; tick++)
            {
                var input = InputForTick(tick);
                a.Step(input);
                b.Step(input);
            }

            Assert.That(a.Snapshot.Tick, Is.EqualTo(b.Snapshot.Tick));
            Assert.That(a.Snapshot.ShipX, Is.EqualTo(b.Snapshot.ShipX));
            Assert.That(a.Snapshot.Score, Is.EqualTo(b.Snapshot.Score));
            Assert.That(a.Snapshot.HazardCount, Is.EqualTo(b.Snapshot.HazardCount));
            for (int i = 0; i < a.Snapshot.HazardCount; i++)
            {
                var ah = a.Snapshot.GetHazard(i);
                var bh = b.Snapshot.GetHazard(i);
                Assert.That(ah.Id, Is.EqualTo(bh.Id));
                Assert.That(ah.X, Is.EqualTo(bh.X));
                Assert.That(ah.Z, Is.EqualTo(bh.Z));
            }
        }

        [Test]
        public void CounterSteerReversesTheShip()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig(), 7u);
            simulation.StartRun();

            for (int i = 0; i < 30; i++) simulation.Step(new InputFrame(false, true));
            Assert.That(simulation.Snapshot.ShipVelocityX, Is.GreaterThan(0f));

            for (int i = 0; i < 30; i++) simulation.Step(new InputFrame(true, false));
            Assert.That(simulation.Snapshot.ShipVelocityX, Is.LessThan(0f));
        }

        [Test]
        public void ForcedCenterHazardProducesAReproducibleDeathEvent()
        {
            var config = new SimulationConfig
            {
                LaneCount = 1,
                LaneWidth = 0f,
                SpawnZ = 3.9f,
                InitialSpawnDistance = 0f,
                SpawnIntervalDistance = 1000f
            };
            var simulation = new JetHorizonSimulation(config, 99u);
            simulation.StartRun();
            simulation.Step(default);

            Assert.That(simulation.Phase, Is.EqualTo(CoreGamePhase.Dead));
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.PlayerDied), Is.True);
        }

        [Test]
        public void ResettingARunRewindsTheSeedAndEntitySequence()
        {
            var config = new SimulationConfig
            {
                CollisionEnabled = false,
                InitialSpawnDistance = 0f,
                SpawnIntervalDistance = 1000f
            };
            var simulation = new JetHorizonSimulation(config, 541u);

            simulation.StartRun();
            simulation.Step(default);
            var first = simulation.Snapshot.GetHazard(0);

            simulation.StartRun();
            simulation.Step(default);
            var replayed = simulation.Snapshot.GetHazard(0);

            Assert.That(replayed.Id, Is.EqualTo(first.Id));
            Assert.That(replayed.X, Is.EqualTo(first.X));
            Assert.That(replayed.Z, Is.EqualTo(first.Z));
        }

        static InputFrame InputForTick(int tick)
        {
            if (tick < 180) return new InputFrame(false, true);
            if (tick < 360) return new InputFrame(true, false);
            if (tick >= 480 && tick < 540) return new InputFrame(false, false, 1);
            return default;
        }

        static bool ContainsEvent(SimulationEventBuffer events, SimulationEventType type)
        {
            for (int i = 0; i < events.Count; i++)
                if (events[i].Type == type) return true;
            return false;
        }
    }
}
