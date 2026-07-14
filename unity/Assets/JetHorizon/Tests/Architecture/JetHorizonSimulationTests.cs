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

        [Test]
        public void LiveMigrationModeAcceptsExternalSpeedWithoutOwningProgressionOrHazards()
        {
            var config = new SimulationConfig
            {
                ProgressionEnabled = false,
                HazardSpawningEnabled = false,
                CollisionEnabled = false
            };
            var simulation = new JetHorizonSimulation(config, 12u);
            simulation.StartRun();
            simulation.SetSpeed(90f);

            for (int i = 0; i < 120; i++)
                simulation.Step(new InputFrame(false, true));

            Assert.That(simulation.Snapshot.Speed, Is.EqualTo(90f));
            Assert.That(simulation.Snapshot.ShipX, Is.GreaterThan(0f));
            Assert.That(simulation.Snapshot.Distance, Is.Zero);
            Assert.That(simulation.Snapshot.Score, Is.Zero);
            Assert.That(simulation.Snapshot.HazardCount, Is.Zero);
        }

        [Test]
        public void PausingFreezesTheSimulationUntilResumed()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false
            }, 22u);
            simulation.StartRun();
            simulation.Step(new InputFrame(false, true));
            var tickBeforePause = simulation.Snapshot.Tick;
            var xBeforePause = simulation.Snapshot.ShipX;

            simulation.SetPaused(true);
            for (int i = 0; i < 30; i++) simulation.Step(new InputFrame(false, true));

            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Paused));
            Assert.That(simulation.Snapshot.Tick, Is.EqualTo(tickBeforePause));
            Assert.That(simulation.Snapshot.ShipX, Is.EqualTo(xBeforePause));

            simulation.SetPaused(false);
            simulation.Step(new InputFrame(false, true));
            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Playing));
            Assert.That(simulation.Snapshot.Tick, Is.EqualTo(tickBeforePause + 1));
            Assert.That(simulation.Snapshot.ShipX, Is.GreaterThan(xBeforePause));
        }

        [Test]
        public void WorldFrameSuspendsProgressAndAppliesOverdriveDistance()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false
            }, 31u);
            simulation.StartRun();

            simulation.Step(default, new WorldFrame(true, false));
            Assert.That(simulation.Snapshot.Elapsed, Is.GreaterThan(0f));
            Assert.That(simulation.Snapshot.Distance, Is.Zero);
            Assert.That(simulation.Snapshot.Score, Is.Zero);

            simulation.Step(default, new WorldFrame(false, true));
            float expectedDistance = simulation.Snapshot.Speed * 1.8f * simulation.FixedDeltaSeconds;
            Assert.That(simulation.Snapshot.EffectiveSpeed, Is.EqualTo(simulation.Snapshot.Speed * 1.8f));
            Assert.That(simulation.Snapshot.Distance, Is.EqualTo(expectedDistance).Within(0.0001f));
            Assert.That(simulation.Snapshot.Score, Is.GreaterThan(0f));
        }

        [Test]
        public void ExternalAwardsAndDeathMultiplierAreCoreOwned()
        {
            var config = new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false,
                DistanceBonusStep = 1f,
                DistanceBonusPerStep = 0.1f
            };
            var simulation = new JetHorizonSimulation(config, 44u);
            simulation.StartRun();
            simulation.SetSpeed(60f);
            simulation.Step(default); // one metre, giving a 1.1x final multiplier
            simulation.AwardScore(75f, ScoreSource.Pickup);
            float beforeDeath = simulation.Snapshot.Score;

            simulation.ForcePlayerDeath();

            Assert.That(beforeDeath, Is.GreaterThan(75f));
            Assert.That(simulation.Snapshot.Score, Is.EqualTo((float)System.Math.Floor(beforeDeath) * 1.1f).Within(0.0001f));
            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Dead));
        }

        [Test]
        public void StageDirectorAdvancesAndEmitsEngineCommands()
        {
            float dt = 1f / 60f;
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition("OPEN", StageKind.RandomCones, dt * 2f, 1.5f, 1, 0, density: DensityCurve.Ramp),
                new StageDefinition("CANYON", StageKind.Corridor, 1f, 2f, 2, 1, CorridorFamily.PreT4A, darkSlabs: true),
                new StageDefinition("REST", StageKind.Rest, 1f, 2f, 2, 1)
            });
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false
            }, 55u, run);
            simulation.StartRun();
            var world = new WorldFrame(false, false) { HazardsClear = true };

            simulation.Step(default, world);
            simulation.Step(default, world);

            Assert.That(simulation.Snapshot.StageIndex, Is.EqualTo(1));
            Assert.That(simulation.Snapshot.StageName, Is.EqualTo("CANYON"));
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.StageChanged), Is.True);

            simulation.Step(default, world);
            Assert.That(ContainsCommand(simulation.StageCommands, StageCommandType.WipeHazards), Is.True);
            Assert.That(ContainsCommand(simulation.StageCommands, StageCommandType.LaunchCorridor), Is.True);
            Assert.That(simulation.Snapshot.SpawnPattern, Is.EqualTo(SpawnPattern.None));

            world.CanyonActive = true;
            world.HazardsClear = false;
            simulation.Step(default, world);
            Assert.That(simulation.Snapshot.StageIndex, Is.EqualTo(1));
        }

        [Test]
        public void RunDefinitionCopiesItsStageArray()
        {
            var first = new StageDefinition("A", StageKind.RandomCones, 1f, 1f, 1, 0);
            var stages = new[] { first };
            var run = new RunDefinition(36f, stages);
            stages[0] = new StageDefinition("B", StageKind.Rest, 1f, 1f, 1, 0);

            Assert.That(run.GetStage(0), Is.SameAs(first));
            Assert.That(run.GetStage(0).Name, Is.EqualTo("A"));
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

        static bool ContainsCommand(StageCommandBuffer commands, StageCommandType type)
        {
            for (int i = 0; i < commands.Count; i++)
                if (commands[i].Type == type) return true;
            return false;
        }
    }
}
