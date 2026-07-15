using NUnit.Framework;
using JetHorizon.Application;
using JetHorizon.Meta;

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
        public void StockHandlingConstantsMatchProductionEquations()
        {
            var config = new SimulationConfig();

            Assert.That(config.Acceleration, Is.EqualTo(38.4375f).Within(0.0001f));
            Assert.That(config.Deceleration, Is.EqualTo(0.4925f).Within(0.0001f));
            Assert.That(config.MaxLateralVelocity, Is.EqualTo(16.3125f).Within(0.0001f));
            Assert.That(config.RollSpeed, Is.EqualTo((1.2f + 0.5625f * 2.3f) * (float)System.Math.PI).Within(0.0001f));
        }

        [Test]
        public void SimultaneousSteeringKeepsProductionLeftBias()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = false
            }, 71u);
            simulation.StartRun();

            simulation.Step(new InputFrame(true, true));

            Assert.That(simulation.Snapshot.ShipVelocityX, Is.LessThan(0f));
        }

        [Test]
        public void IntroSuppressionPinsLateralPhysicsWithoutBlockingRollInput()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = false
            }, 72u);
            simulation.StartRun();
            for (int i = 0; i < 10; i++) simulation.Step(new InputFrame(false, true));
            Assert.That(simulation.Snapshot.ShipX, Is.GreaterThan(0f));

            simulation.Step(new InputFrame(false, true, 1), new WorldFrame(false, false)
            {
                ShipMovementSuppressed = true
            });

            Assert.That(simulation.Snapshot.ShipX, Is.Zero);
            Assert.That(simulation.Snapshot.ShipVelocityX, Is.Zero);
            Assert.That(simulation.Snapshot.ShipRollRadians, Is.GreaterThan(0f));
        }

        [Test]
        public void RollBeginsAfterCurrentTickLateralIntegration()
        {
            var config = new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = false,
                TiltGraceSeconds = 0f
            };
            var rolling = new JetHorizonSimulation(config, 73u);
            var upright = new JetHorizonSimulation(config, 73u);
            rolling.StartRun();
            upright.StartRun();

            rolling.Step(new InputFrame(false, true, 1));
            upright.Step(new InputFrame(false, true));

            Assert.That(rolling.Snapshot.ShipVelocityX, Is.EqualTo(upright.Snapshot.ShipVelocityX));
            Assert.That(rolling.Snapshot.ShipRollRadians, Is.GreaterThan(0f));
        }

        [Test]
        public void SineCorridorDefinitionsMatchProductionRowMath()
        {
            var l4 = SineCorridorCatalog.L4;
            var l5 = SineCorridorCatalog.L5;

            Assert.That(l4.TotalRows, Is.EqualTo(518));
            Assert.That(l4.HalfWidthAtRow(0), Is.EqualTo(80f));
            Assert.That(l4.HalfWidthAtRow(l4.SineStartRow + 120), Is.EqualTo(4.5f).Within(0.0001f));
            Assert.That(l4.HalfWidthAtRow(l4.SineStartRow + 382), Is.EqualTo(3.06f).Within(0.001f));
            Assert.That(l5.TotalRows, Is.EqualTo(420));
            Assert.That(l5.HalfWidthAtRow(l5.SineStartRow + 180), Is.EqualTo(8f).Within(0.0001f));
            Assert.That(l5.ShouldSpawnCenterCone(l5.SineStartRow + 12), Is.True);
            Assert.That(l5.ShouldSpawnCenterCone(l5.SineStartRow + 11), Is.False);
            Assert.That(l5.ShouldSpawnCenterCone(l5.TotalRows - l5.ExitRows), Is.False);
        }

        [Test]
        public void L4SineCorridorUsesSourceDelayCadenceAndPortableHazards()
        {
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition("L4", StageKind.Corridor, 90f, 2.1f, 2, 3, CorridorFamily.L4Sine)
            });
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false
            }, 74u, run);
            simulation.StartRun();

            simulation.Step(default);
            Assert.That(simulation.Snapshot.SineCorridorActive, Is.True);
            Assert.That(simulation.Snapshot.HazardCount, Is.Zero);
            for (int i = 0; i < 89; i++) simulation.Step(default);
            Assert.That(simulation.Snapshot.HazardCount, Is.Zero);
            for (int i = 0; i < 12 && simulation.Snapshot.HazardCount == 0; i++) simulation.Step(default);

            Assert.That(simulation.Snapshot.HazardCount, Is.EqualTo(4));
            for (int i = 0; i < simulation.Snapshot.HazardCount; i++)
                Assert.That(simulation.Snapshot.GetHazard(i).Style, Is.EqualTo(HazardStyle.L4CorridorCone));
        }

        [Test]
        public void StructuredWallDefinitionMatchesProductionGridAndMeshCenter()
        {
            var field = StructuredWallFieldCatalog.Production;
            var first = field.CreateWall(0, 0, 0, 0, 0f, -160f);
            var last = field.CreateWall(0, 5, 1, 1, 0f, -160f);
            var nextRow = field.CreateWall(1, 0, 0, 0, 0f, -160f);

            Assert.That(field.WallsPerRow, Is.EqualTo(24));
            Assert.That(first.X, Is.EqualTo(-102.5f).Within(0.0001f));
            Assert.That(last.X, Is.EqualTo(107.5f).Within(0.0001f));
            Assert.That(first.Y, Is.EqualTo(-3f + 2f * (float)System.Math.Cos(-36f * System.Math.PI / 180f)).Within(0.0001f));
            Assert.That(first.Z, Is.EqualTo(-162.5f + 2f * (float)System.Math.Sin(-36f * System.Math.PI / 180f)).Within(0.0001f));
            Assert.That(first.RotationYRadians, Is.GreaterThan(0f));
            Assert.That(nextRow.RotationYRadians, Is.LessThan(0f));
        }

        [Test]
        public void StructuredWallStageWaitsThenSpawnsAllTwentyFourCopiesInCore()
        {
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition("WALLS", StageKind.StructuredWalls, 30f, 2f, 2, 2)
            });
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false,
                MaxHazards = 600
            }, 75u, run);
            simulation.StartRun();

            for (int i = 0; i < 170; i++) simulation.Step(default);
            Assert.That(simulation.Snapshot.AngledWallsActive, Is.False);
            Assert.That(simulation.Snapshot.HazardCount, Is.Zero);
            for (int i = 0; i < 25 && !simulation.Snapshot.AngledWallsActive; i++) simulation.Step(default);
            Assert.That(simulation.Snapshot.AngledWallsActive, Is.True);
            Assert.That(simulation.Snapshot.HazardCount, Is.Zero);
            for (int i = 0; i < 50 && simulation.Snapshot.HazardCount == 0; i++) simulation.Step(default);

            Assert.That(simulation.Snapshot.HazardCount, Is.EqualTo(24));
            for (int i = 0; i < simulation.Snapshot.HazardCount; i++)
                Assert.That(simulation.Snapshot.GetHazard(i).Style, Is.EqualTo(HazardStyle.StructuredWall));
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
            long expectedFinal = (long)System.Math.Floor(System.Math.Floor(beforeDeath) * 1.1d);
            Assert.That(simulation.Snapshot.Score, Is.EqualTo(expectedFinal).Within(0.0001f));
            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Dead));
            Assert.That(simulation.LatestRunResult.FinalScore, Is.EqualTo(expectedFinal));
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

        [Test]
        public void ApplicationRouterPersistsAndPublishesACompletedRun()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false
            }, 88u);
            simulation.StartRun();
            simulation.AwardScore(123f, ScoreSource.Bonus);
            simulation.ForcePlayerDeath();

            var store = new FakeProgressStore();
            var audio = new FakeAudio();
            var haptics = new FakeHaptics();
            var analytics = new FakeAnalytics();
            var leaderboard = new FakeLeaderboard();
            var router = new RunEventRouter(new GameServices(
                store,
                audio,
                haptics,
                analytics,
                new FakeClock(),
                leaderboard));

            router.Dispatch(simulation.Events, simulation.LatestRunResult);

            Assert.That(store.Saved.CompletedRuns, Is.EqualTo(1));
            Assert.That(store.Saved.HighScore, Is.EqualTo(simulation.Snapshot.Score));
            Assert.That(leaderboard.LastScore, Is.EqualTo((long)System.Math.Floor(simulation.Snapshot.Score)));
            Assert.That(audio.LastCue, Is.EqualTo(AudioCue.PlayerDied));
            Assert.That(haptics.LastCue, Is.EqualTo(HapticCue.Impact));
            Assert.That(analytics.Last.Name, Is.EqualTo("run_finished"));
        }

        [Test]
        public void SuspendedProgressionKeepsSimulationAliveButFreezesRunAndStageClocks()
        {
            float dt = 1f / 60f;
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition("OPEN", StageKind.RandomCones, 10f, 1.5f, 1, 0)
            });
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false
            }, 89u, run);
            simulation.StartRun(8901L);

            simulation.Step(default, new WorldFrame(true, false));

            Assert.That(simulation.Snapshot.Tick, Is.EqualTo(1));
            Assert.That(simulation.Snapshot.Elapsed, Is.EqualTo(dt).Within(0.0001f));
            Assert.That(simulation.Snapshot.EligibleRunTick, Is.Zero);
            Assert.That(simulation.Snapshot.EligibleRunElapsed, Is.Zero);
            Assert.That(simulation.Snapshot.StageElapsed, Is.Zero);
            Assert.That(simulation.Snapshot.Distance, Is.Zero);
            Assert.That(simulation.Snapshot.Score, Is.Zero);

            simulation.Step(default, new WorldFrame(false, false));

            Assert.That(simulation.Snapshot.Tick, Is.EqualTo(2));
            Assert.That(simulation.Snapshot.EligibleRunTick, Is.EqualTo(1));
            Assert.That(simulation.Snapshot.EligibleRunElapsed, Is.EqualTo(dt).Within(0.0001f));
            Assert.That(simulation.Snapshot.StageElapsed, Is.EqualTo(dt).Within(0.0001f));
            Assert.That(simulation.Snapshot.Distance, Is.GreaterThan(0f));
            Assert.That(simulation.Snapshot.Score, Is.GreaterThan(0f));
        }

        [Test]
        public void OverdriveAcceleratesTimedStagesButNotRestStages()
        {
            float dt = 1f / 60f;
            var timedRun = new RunDefinition(36f, new[]
            {
                new StageDefinition("TIMED", StageKind.RandomCones, 10f, 1.5f, 1, 0)
            });
            var timed = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false
            }, 891u, timedRun);
            timed.StartRun(89101L);
            timed.Step(default, new WorldFrame(false, true));
            Assert.That(timed.Snapshot.StageElapsed, Is.EqualTo(dt * 1.8f).Within(0.0001f));

            var restRun = new RunDefinition(36f, new[]
            {
                new StageDefinition("REST", StageKind.Rest, 10f, 1.5f, 1, 0)
            });
            var rest = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false
            }, 892u, restRun);
            rest.StartRun(89201L);
            rest.Step(default, new WorldFrame(false, true));
            Assert.That(rest.Snapshot.StageElapsed, Is.EqualTo(dt).Within(0.0001f));
        }

        [Test]
        public void RunFinalizationIsImmutableAndIdempotent()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false
            }, 90u);
            simulation.StartRun(9001L);
            simulation.AwardScore(123.75f, ScoreSource.Bonus);
            simulation.ForcePlayerDeath();

            RunResult first = simulation.LatestRunResult;
            float firstScore = simulation.Snapshot.Score;
            simulation.ForcePlayerDeath();

            Assert.That(simulation.LatestRunResult, Is.SameAs(first));
            Assert.That(simulation.Snapshot.Score, Is.EqualTo(firstScore));
            Assert.That(first.RunId, Is.EqualTo(9001L));
            Assert.That(first.RawScore, Is.EqualTo(123L));
            Assert.That(first.FinalScore, Is.EqualTo(123L));
        }

        [Test]
        public void CompletionServiceIgnoresDuplicateRunAndPublishesOnce()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false
            }, 91u);
            simulation.StartRun(9101L);
            simulation.AwardScore(500f, ScoreSource.Bonus);
            simulation.ForcePlayerDeath();

            var store = new FakeProgressStore();
            var leaderboard = new FakeLeaderboard();
            var router = new RunEventRouter(new GameServices(
                store,
                new FakeAudio(),
                new FakeHaptics(),
                new FakeAnalytics(),
                new FakeClock(),
                leaderboard));

            router.Dispatch(simulation.Events, simulation.LatestRunResult);
            router.Dispatch(simulation.Events, simulation.LatestRunResult);

            Assert.That(store.Saved.CompletedRuns, Is.EqualTo(1));
            Assert.That(store.Saved.LastCompletedRunId, Is.EqualTo(9101L));
            Assert.That(leaderboard.SubmissionCount, Is.EqualTo(1));
            Assert.That(router.LastCompletion.Value.IsDuplicate, Is.True);
        }

        [Test]
        public void RepairRuleResetsScorePreservesDistanceAndDisablesLeaderboard()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false
            }, 92u);
            simulation.StartRun(9201L);
            simulation.Step(default);
            float distanceBeforeRepair = simulation.Snapshot.Distance;
            simulation.AwardScore(250f, ScoreSource.Bonus);
            simulation.RegisterRepair();

            Assert.That(simulation.Snapshot.Score, Is.Zero);
            Assert.That(simulation.Snapshot.Distance, Is.EqualTo(distanceBeforeRepair));

            simulation.AwardScore(100f, ScoreSource.Bonus);
            simulation.ForcePlayerDeath();
            Assert.That(simulation.LatestRunResult.RepairCount, Is.EqualTo(1));
            Assert.That(simulation.LatestRunResult.IsLeaderboardEligible, Is.False);

            var store = new FakeProgressStore();
            var leaderboard = new FakeLeaderboard();
            var router = new RunEventRouter(new GameServices(
                store,
                new FakeAudio(),
                new FakeHaptics(),
                new FakeAnalytics(),
                new FakeClock(),
                leaderboard));
            router.Dispatch(simulation.Events, simulation.LatestRunResult);

            Assert.That(store.Saved.CompletedRuns, Is.EqualTo(1));
            Assert.That(leaderboard.SubmissionCount, Is.Zero);
        }

        [Test]
        public void RegisteredHazardsAreCoreOwnedAndRespectCollisionSuppression()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                HazardSimulationEnabled = true,
                CollisionEnabled = true
            }, 91u);
            simulation.StartRun();
            int id = simulation.RegisterHazard(HazardSpawn.Cone(0f, 3f));
            Assert.That(id, Is.GreaterThan(0));
            Assert.That(simulation.Snapshot.HazardCount, Is.EqualTo(1));

            simulation.Step(default, new WorldFrame(false, false) { CollisionSuppressed = true });
            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Playing));
            Assert.That(simulation.Snapshot.GetHazard(0).Z, Is.GreaterThan(3f));

            simulation.Step(default, new WorldFrame(false, false));
            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Dead));
        }

        [Test]
        public void RegisteredHazardCanBeRemovedByStableIdentity()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = false
            }, 92u);
            simulation.StartRun();
            int id = simulation.RegisterHazard(HazardSpawn.Ring(4f, 2f, -10f, 5.25f, 2.2f));

            Assert.That(simulation.Snapshot.GetHazard(0).Kind, Is.EqualTo(HazardKind.Ring));
            Assert.That(simulation.RemoveHazard(id), Is.True);
            Assert.That(simulation.RemoveHazard(id), Is.False);
            Assert.That(simulation.Snapshot.HazardCount, Is.Zero);
        }

        [Test]
        public void RegisteredAngledWallUsesEngineNeutralObbCollision()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = true
            }, 921u);
            simulation.StartRun();
            int id = simulation.RegisterHazard(HazardSpawn.Wall(
                0f,
                1.2f,
                3.3f,
                8f,
                4f,
                0.3f,
                0f,
                35f * (float)(System.Math.PI / 180.0)));

            Assert.That(id, Is.GreaterThan(0));
            var wall = simulation.Snapshot.GetHazard(0);
            Assert.That(wall.Kind, Is.EqualTo(HazardKind.Wall));
            Assert.That(wall.RotationYRadians, Is.Not.Zero);

            simulation.Step(default);

            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Dead));
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.PlayerDied), Is.True);
        }

        [Test]
        public void StageDrivenWaveAndCoinChoicesReplayExactlyFromTheSeed()
        {
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition("OPEN", StageKind.RandomCones, 30f, 1.5f, 1, 0, density: DensityCurve.Ramp)
            });
            var config = new SimulationConfig
            {
                CollisionEnabled = false,
                InitialSpawnDistance = 0f,
                SpawnIntervalDistance = 1000f
            };
            var first = new JetHorizonSimulation(config, 2026u, run);
            var replay = new JetHorizonSimulation(config, 2026u, run);
            first.StartRun();
            replay.StartRun();

            first.Step(default);
            replay.Step(default);

            Assert.That(first.Snapshot.HazardCount, Is.EqualTo(5));
            Assert.That(first.Snapshot.PickupCount, Is.GreaterThan(0));
            Assert.That(replay.Snapshot.HazardCount, Is.EqualTo(first.Snapshot.HazardCount));
            Assert.That(replay.Snapshot.PickupCount, Is.EqualTo(first.Snapshot.PickupCount));
            for (int i = 0; i < first.Snapshot.HazardCount; i++)
            {
                var a = first.Snapshot.GetHazard(i);
                var b = replay.Snapshot.GetHazard(i);
                Assert.That(b.X, Is.EqualTo(a.X));
                Assert.That(b.Z, Is.EqualTo(a.Z));
                Assert.That(b.Style, Is.EqualTo(a.Style));
                Assert.That(b.VisualVariant, Is.EqualTo(a.VisualVariant));
            }
            for (int i = 0; i < first.Snapshot.PickupCount; i++)
            {
                var a = first.Snapshot.GetPickup(i);
                var b = replay.Snapshot.GetPickup(i);
                Assert.That(b.X, Is.EqualTo(a.X));
                Assert.That(b.Y, Is.EqualTo(a.Y));
                Assert.That(b.Z, Is.EqualTo(a.Z));
            }
        }

        [Test]
        public void SpawnSuppressionPreservesThePendingFirstWave()
        {
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition("OPEN", StageKind.RandomCones, 30f, 1.5f, 1, 0)
            });
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                InitialSpawnDistance = 0f
            }, 303u, run);
            simulation.StartRun();

            simulation.Step(default, new WorldFrame(false, false) { SpawningSuppressed = true });
            Assert.That(simulation.Snapshot.HazardCount, Is.Zero);

            simulation.Step(default, new WorldFrame(false, false));
            Assert.That(simulation.Snapshot.HazardCount, Is.GreaterThan(0));
        }

        [Test]
        public void RegisteredCoinMovesCollectsAndAwardsScoreInCore()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = false
            }, 93u);
            simulation.StartRun();
            int id = simulation.RegisterPickup(PickupSpawn.Coin(0f, 1.2f, 3f, 75f));
            Assert.That(id, Is.GreaterThan(0));
            Assert.That(simulation.Snapshot.PickupCount, Is.EqualTo(1));

            simulation.Step(default);

            Assert.That(simulation.Snapshot.PickupCount, Is.Zero);
            Assert.That(simulation.Snapshot.Score, Is.GreaterThan(75f));
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.PickupCollected), Is.True);
        }

        [Test]
        public void LightningWarningIsVisualOnlyUntilTheCoreStrikeWindow()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = true
            }, 94u);
            simulation.StartRun();
            simulation.SetSpeed(0f);
            int id = simulation.RegisterHazard(HazardSpawn.Lightning(
                0f,
                simulation.Snapshot.ShipZ,
                warningSeconds: 0.3f));

            Assert.That(id, Is.GreaterThan(0));
            Assert.That(simulation.Snapshot.GetHazard(0).CollisionActive, Is.False);
            for (int i = 0; i < 17; i++) simulation.Step(default);
            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Playing));

            bool sawDeathEvent = false;
            for (int i = 0; i < 2 && simulation.Snapshot.Phase == CoreGamePhase.Playing; i++)
            {
                simulation.Step(default);
                sawDeathEvent |= ContainsEvent(simulation.Events, SimulationEventType.PlayerDied);
            }

            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Dead));
            Assert.That(sawDeathEvent, Is.True);
        }

        [Test]
        public void LightningDirectorUsesDeterministicCorridorTargeting()
        {
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition(
                    "LIGHTNING",
                    StageKind.Corridor,
                    10f,
                    1.5f,
                    2,
                    1,
                    CorridorFamily.PreT4A)
            });
            var config = new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = false,
                LightningGateIntervalSeconds = .25f
            };
            var first = new JetHorizonSimulation(config, 95u, run);
            var replay = new JetHorizonSimulation(config, 95u, run);
            var world = new WorldFrame(false, false)
            {
                CanyonActive = true,
                CorridorCollisionActive = true,
                CorridorLeftBoundary = -28f,
                CorridorRightBoundary = 28f
            };
            first.StartRun();
            replay.StartRun();

            for (int i = 0; i < 19; i++)
            {
                first.Step(default, world);
                replay.Step(default, world);
            }

            Assert.That(first.Snapshot.HazardCount, Is.GreaterThanOrEqualTo(6));
            Assert.That(replay.Snapshot.HazardCount, Is.EqualTo(first.Snapshot.HazardCount));
            for (int i = 0; i < first.Snapshot.HazardCount; i++)
            {
                var a = first.Snapshot.GetHazard(i);
                var b = replay.Snapshot.GetHazard(i);
                Assert.That(a.Kind, Is.EqualTo(HazardKind.Lightning));
                Assert.That(a.Style, Is.EqualTo(HazardStyle.Lightning));
                Assert.That(b.X, Is.EqualTo(a.X));
                Assert.That(b.Z, Is.EqualTo(a.Z));
            }
        }

        [Test]
        public void CorridorBoundsAreResolvedByTheEngineNeutralCore()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = true
            }, 96u);
            simulation.StartRun();
            var safe = new WorldFrame(false, false)
            {
                CorridorCollisionActive = true,
                CorridorLeftBoundary = -2f,
                CorridorRightBoundary = 2f
            };

            simulation.Step(default, safe);
            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Playing));

            var lethal = safe;
            lethal.CorridorRightBoundary = 0.9f;
            simulation.Step(default, lethal);

            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Dead));
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.PlayerDied), Is.True);
        }

        [Test]
        public void CorridorCollisionHonorsSharedCollisionSuppression()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = true
            }, 97u);
            simulation.StartRun();
            simulation.Step(default, new WorldFrame(false, false)
            {
                CorridorCollisionActive = true,
                CorridorLeftBoundary = -0.9f,
                CorridorRightBoundary = 0.9f,
                CollisionSuppressed = true
            });

            Assert.That(simulation.Snapshot.Phase, Is.EqualTo(CoreGamePhase.Playing));
        }

        [Test]
        public void RunnerShipContentMatchesTheProductionGlbConfiguration()
        {
            var ship = ShipCatalog.Runner;

            Assert.That(ship.ModelKey, Is.EqualTo("spaceship_01.glb"));
            Assert.That(ship.ModelPosition.Y, Is.EqualTo(-0.590f));
            Assert.That(ship.ModelRotationRadians.Y, Is.EqualTo(3.142f));
            Assert.That(ship.ModelScale, Is.EqualTo(1f));
            Assert.That(ship.Thrusters.MainLeft.X, Is.EqualTo(-1.600000f));
            Assert.That(ship.Thrusters.MainRight.X, Is.EqualTo(1.600000f));
            Assert.That(ship.Thrusters.MainLeft.Y, Is.EqualTo(-0.766667f).Within(0.000001f));
            Assert.That(ship.Thrusters.MainLeft.Z, Is.EqualTo(2.000000f));
            Assert.That(ship.Thrusters.MiniLeft.X, Is.EqualTo(-0.733333f).Within(0.000001f));
            Assert.That(ship.Thrusters.MiniRight.X, Is.EqualTo(0.733333f).Within(0.000001f));
            Assert.That(ship.Thrusters.MiniLeft.Y, Is.EqualTo(-0.666667f).Within(0.000001f));
            Assert.That(ship.Thrusters.MiniThrustersEnabled, Is.True);
        }

        [Test]
        public void LightThrusterPresetIsPortableContentData()
        {
            var effect = ThrusterEffectCatalog.Light;

            Assert.That(effect.Scale, Is.EqualTo(0.80f));
            Assert.That(effect.ParticleSize, Is.EqualTo(0.06f));
            Assert.That(effect.ParticleLifeBase, Is.EqualTo(0.20f));
            Assert.That(effect.ParticleLifeJitter, Is.EqualTo(0.05f));
            Assert.That(effect.BloomScale, Is.EqualTo(0.10f));
            Assert.That(effect.BloomOpacity, Is.EqualTo(0.43f));
            Assert.That(effect.ConeLength, Is.EqualTo(3.30f));
        }

        [Test]
        public void ZipperPatternSchedulingAndRowsAreCoreOwnedAndDeterministic()
        {
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition("ZIPPER", StageKind.ZipperOnly, 20f, 1.5f, 2, 1)
            });
            var config = new SimulationConfig { CollisionEnabled = false };
            var first = new JetHorizonSimulation(config, 98u, run);
            var replay = new JetHorizonSimulation(config, 98u, run);
            first.StartRun();
            replay.StartRun();

            for (int i = 0; i < 155; i++)
            {
                first.Step(default);
                replay.Step(default);
            }

            Assert.That(first.Snapshot.ZipperActive, Is.True);
            Assert.That(first.Snapshot.HazardCount, Is.GreaterThan(30));
            Assert.That(replay.Snapshot.HazardCount, Is.EqualTo(first.Snapshot.HazardCount));
            for (int i = 0; i < first.Snapshot.HazardCount; i++)
            {
                var a = first.Snapshot.GetHazard(i);
                var b = replay.Snapshot.GetHazard(i);
                Assert.That(a.Style, Is.EqualTo(HazardStyle.CorridorCone));
                Assert.That(b.X, Is.EqualTo(a.X));
                Assert.That(b.Z, Is.EqualTo(a.Z));
            }
        }

        [Test]
        public void SlalomFirstRowAndRewardLineAreCoreOwnedAndDeterministic()
        {
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition("SLALOM", StageKind.SlalomOnly, 20f, 1.5f, 2, 1)
            });
            var config = new SimulationConfig { CollisionEnabled = false };
            var first = new JetHorizonSimulation(config, 99u, run);
            var replay = new JetHorizonSimulation(config, 99u, run);
            first.StartRun();
            replay.StartRun();

            first.Step(default);
            replay.Step(default);

            Assert.That(first.Snapshot.SlalomActive, Is.True);
            Assert.That(System.Math.Abs(first.Snapshot.CorridorGapCenter), Is.EqualTo(18f));
            Assert.That(first.Snapshot.HazardCount, Is.GreaterThan(5));
            Assert.That(first.Snapshot.PickupCount, Is.EqualTo(3));
            Assert.That(replay.Snapshot.HazardCount, Is.EqualTo(first.Snapshot.HazardCount));
            for (int i = 0; i < first.Snapshot.HazardCount; i++)
            {
                var a = first.Snapshot.GetHazard(i);
                var b = replay.Snapshot.GetHazard(i);
                Assert.That(a.Style, Is.EqualTo(HazardStyle.FatCone));
                Assert.That(b.X, Is.EqualTo(a.X));
            }
            for (int i = 0; i < 3; i++)
                Assert.That(replay.Snapshot.GetPickup(i).X, Is.EqualTo(first.Snapshot.GetPickup(i).X));
        }

        [Test]
        public void ShieldPickupActivatesAndAbsorbsOneCoreCollision()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false
            }, 104u);
            simulation.StartRun();
            simulation.RegisterPickup(PickupSpawn.PowerupPickup(PowerupType.Shield, 0f, 1.4f, 3f));

            simulation.Step(default);

            Assert.That(simulation.Snapshot.ShieldHits, Is.EqualTo(1));
            Assert.That(simulation.Snapshot.ShieldSeconds, Is.GreaterThan(9f));
            simulation.RegisterHazard(HazardSpawn.Cone(0f, 3f, collisionHalfWidth: 1f));
            simulation.Step(default);

            Assert.That(simulation.Phase, Is.EqualTo(CoreGamePhase.Playing));
            Assert.That(simulation.Snapshot.ShieldHits, Is.Zero);
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.ShieldBroken), Is.True);
        }

        [Test]
        public void AllProductionPowerupsExposePortableDurationsAndEffects()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = false
            }, 105u);
            simulation.StartRun();
            simulation.ActivatePowerup(PowerupType.Laser);
            simulation.ActivatePowerup(PowerupType.Overdrive);
            simulation.ActivatePowerup(PowerupType.Magnet);
            simulation.RegisterHazard(HazardSpawn.Cone(-0.35f, -10f, collisionHalfWidth: 1f));

            bool destroyed = false;
            for (int i = 0; i < 12; i++)
            {
                simulation.Step(default);
                destroyed |= ContainsEvent(simulation.Events, SimulationEventType.HazardDestroyed);
            }

            Assert.That(simulation.Snapshot.LaserSeconds, Is.GreaterThan(3f));
            Assert.That(simulation.Snapshot.OverdriveSeconds, Is.GreaterThan(4f));
            Assert.That(simulation.Snapshot.OverdriveSpeedSeconds, Is.GreaterThan(2f));
            Assert.That(simulation.Snapshot.MagnetSeconds, Is.GreaterThan(3f));
            Assert.That(simulation.Snapshot.EffectiveSpeed,
                Is.EqualTo(simulation.Snapshot.Speed * PowerupCatalog.OverdriveSpeedMultiplier).Within(0.001f));
            Assert.That(destroyed, Is.True);
        }

        [Test]
        public void PrismaticCorridorPublishesContinuousSlicesInsteadOfConeRows()
        {
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition("L5", StageKind.Corridor, 90f, 2f, 3, 4, CorridorFamily.L5Sine)
            });
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false,
                PrismaticSineTunnelEnabled = true
            }, 108u, run);
            simulation.StartRun();

            for (int i = 0; i < 80 && simulation.Snapshot.CorridorSliceCount < 4; i++) simulation.Step(default);

            Assert.That(simulation.Snapshot.CorridorSliceCount, Is.GreaterThanOrEqualTo(4));
            Assert.That(simulation.Snapshot.HazardCount, Is.Zero);
            Assert.That(simulation.Snapshot.ActiveCorridorFamily, Is.EqualTo(CorridorFamily.L5Sine));
            for (int i = 1; i < simulation.Snapshot.CorridorSliceCount; i++)
                Assert.That(simulation.Snapshot.GetCorridorSlice(i).RowIndex,
                    Is.GreaterThan(simulation.Snapshot.GetCorridorSlice(i - 1).RowIndex));
        }

        [Test]
        public void PrismaticCollisionUsesTheSameCoreSamplePublishedToTheRenderer()
        {
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition("L5", StageKind.Corridor, 90f, 2f, 3, 4, CorridorFamily.L5Sine)
            });
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                PrismaticSineTunnelEnabled = true,
                PrismaticTunnelSpawnZ = 3.9f,
                PrismaticTunnelRowSpacing = .1f,
                CorridorShipHalfWidth = 100f
            }, 109u, run);
            simulation.StartRun();
            simulation.Step(default);

            Assert.That(simulation.Snapshot.CorridorSliceCount, Is.GreaterThan(0));
            Assert.That(simulation.Phase, Is.EqualTo(CoreGamePhase.Dead));
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.PrismaticBoundaryHit), Is.True);
        }

        [TestCase(LightningGatePatternKind.SweepRight)]
        [TestCase(LightningGatePatternKind.SweepLeft)]
        [TestCase(LightningGatePatternKind.CrossCut)]
        [TestCase(LightningGatePatternKind.Reversal)]
        public void LightningGatePatternsDefeatBothEdgesAndNeutralWhileRemainingReachable(LightningGatePatternKind pattern)
        {
            const float corridorHalfWidth = 28f;
            const float safeHalfWidth = 6f;
            Assert.That(LightningGatePattern.DefeatsConstantPosition(pattern, -1f, safeHalfWidth / corridorHalfWidth), Is.True);
            Assert.That(LightningGatePattern.DefeatsConstantPosition(pattern, 0f, safeHalfWidth / corridorHalfWidth), Is.True);
            Assert.That(LightningGatePattern.DefeatsConstantPosition(pattern, 1f, safeHalfWidth / corridorHalfWidth), Is.True);
            Assert.That(LightningGatePattern.IsReachable(pattern, corridorHalfWidth, safeHalfWidth, 14f), Is.True);
        }

        [Test]
        public void CanyonLightningSpawnsAWholeTelegraphedGateNotAPlayerAimedStrike()
        {
            var run = new RunDefinition(36f, new[]
            {
                new StageDefinition("STORM", StageKind.Corridor, 20f, 2f, 2, 1, CorridorFamily.PreT4A)
            });
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                CollisionEnabled = false,
                HazardSpawningEnabled = false,
                LightningGateIntervalSeconds = 1f / 60f,
                LightningGateColumns = 9
            }, 1091u, run);
            simulation.StartRun();
            simulation.Step(default, new WorldFrame(false, false)
            {
                CanyonActive = true,
                CorridorCollisionActive = true,
                CorridorLeftBoundary = -28f,
                CorridorRightBoundary = 28f
            });

            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.LightningGateStarted), Is.True);
            Assert.That(simulation.Snapshot.HazardCount, Is.GreaterThanOrEqualTo(6));
            for (int i = 0; i < simulation.Snapshot.HazardCount; i++)
                Assert.That(simulation.Snapshot.GetHazard(i).Kind, Is.EqualTo(HazardKind.Lightning));
        }

        [Test]
        public void StarterGarageAwardsRequireExplicitRepairOrUpgradeCommands()
        {
            GarageState state = GarageState.CreateNew();
            Assert.That(GarageDomainService.CreateLaunchProfile(state).SpeedMultiplier, Is.LessThan(1f));
            float damagedThrusterIntegrity = state.GetSubsystem(ShipSubsystem.PrimaryThruster).Integrity;

            state = GarageDomainService.Extract(state, new CargoManifest(2, 0, 0)).State;
            Assert.That(state.PendingStarterRepairs.HasFlag(StarterRepairAward.PrimaryThruster), Is.True);
            Assert.That(state.GetSubsystem(ShipSubsystem.PrimaryThruster).Integrity, Is.EqualTo(damagedThrusterIntegrity));
            Assert.That(state.GetSubsystem(ShipSubsystem.PrimaryThruster).Tier, Is.EqualTo(1));
            state = GarageDomainService.CompleteStarterRepair(state, StarterRepairAward.PrimaryThruster).State;
            Assert.That(state.SelectedThrusterId, Is.EqualTo("light"));
            Assert.That(state.GetSubsystem(ShipSubsystem.PrimaryThruster).Integrity, Is.EqualTo(1f));
            Assert.That(state.GetSubsystem(ShipSubsystem.PrimaryThruster).Tier, Is.EqualTo(1));

            state = GarageDomainService.Extract(state, new CargoManifest(2, 0, 0)).State;
            Assert.That(state.PendingStarterRepairs.HasFlag(StarterRepairAward.Stabilizers), Is.True);
            state = GarageDomainService.CompleteStarterRepair(state, StarterRepairAward.Stabilizers).State;
            Assert.That(state.GetSubsystem(ShipSubsystem.Stabilizers).Integrity, Is.EqualTo(1f));

            state = GarageDomainService.Extract(state, new CargoManifest(2, 0, 0)).State;
            Assert.That(state.StarterHullUpgradePending, Is.True);
            Assert.That(state.GetSubsystem(ShipSubsystem.Hull).Tier, Is.EqualTo(1));
            state = GarageDomainService.InstallStarterHullUpgrade(state).State;
            Assert.That(state.GetSubsystem(ShipSubsystem.Hull).Tier, Is.EqualTo(2));

            state = GarageDomainService.Extract(state, new CargoManifest(2, 0, 0)).State;
            Assert.That(state.StarterUpgradeChoicePending, Is.True);
            state = GarageDomainService.ChooseStarterUpgrade(state, StarterUpgradeBranch.Cargo).State;
            Assert.That(state.StarterUpgradeBranch, Is.EqualTo(StarterUpgradeBranch.Cargo));
            Assert.That(state.GetSubsystem(ShipSubsystem.CargoBay).Tier, Is.EqualTo(2));
        }

        [Test]
        public void CargoStarterUpgradeDelaysButDoesNotPermanentlyLockShield()
        {
            GarageState state = GarageState.CreateNew();
            for (int i = 0; i < 4; i++)
                state = GarageDomainService.Extract(state, new CargoManifest(2, 0, 0)).State;

            state = GarageDomainService.ChooseStarterUpgrade(state, StarterUpgradeBranch.Cargo).State;
            state.Credits = 450;
            GarageCommandResult result = GarageDomainService.PurchaseUpgrade(state, GarageUpgradeId.Shield);

            Assert.That(result.Succeeded, Is.True);
            Assert.That(result.State.GetSubsystem(ShipSubsystem.ShieldGenerator).Tier, Is.EqualTo(1));
            Assert.That(result.State.GetSubsystem(ShipSubsystem.ShieldGenerator).Integrity, Is.EqualTo(1f));
            Assert.That(result.State.Credits, Is.Zero);
        }

        [Test]
        public void RepairRestoresIntegrityWithoutRaisingTierWhileUpgradeRaisesTier()
        {
            GarageState state = GarageState.CreateNew();
            state.SuccessfulExtractions = 6;
            state.Salvage = 100;
            SubsystemState engine = state.GetSubsystem(ShipSubsystem.PrimaryThruster);
            engine.Tier = 3;
            engine.Integrity = .35f;

            GarageCommandResult queued = GarageDomainService.QueueRepair(state, ShipSubsystem.PrimaryThruster, 1_000L);
            GarageCommandResult repaired = GarageDomainService.CompleteRepairs(queued.State, long.MaxValue);

            Assert.That(queued.Succeeded, Is.True);
            Assert.That(repaired.State.GetSubsystem(ShipSubsystem.PrimaryThruster).Tier, Is.EqualTo(3));
            Assert.That(repaired.State.GetSubsystem(ShipSubsystem.PrimaryThruster).Integrity, Is.EqualTo(1f));

            repaired.State.Credits = 10_000;
            GarageCommandResult upgraded = GarageDomainService.PurchaseUpgrade(repaired.State, GarageUpgradeId.Engine);
            Assert.That(upgraded.Succeeded, Is.True);
            Assert.That(upgraded.State.GetSubsystem(ShipSubsystem.PrimaryThruster).Tier, Is.EqualTo(4));
            Assert.That(upgraded.State.GetSubsystem(ShipSubsystem.PrimaryThruster).Integrity, Is.EqualTo(1f));
        }

        [Test]
        public void SchemaTwoRestorationChoiceMigratesToStarterUpgradeChoice()
        {
            GarageState legacy = GarageState.CreateNew();
            legacy.SchemaVersion = 2;
            legacy.RestorationBranch = RestorationBranch.Cargo;
            legacy.RestorationChoicePending = true;

            GarageState migrated = GarageDomainService.Normalize(legacy);

            Assert.That(migrated.SchemaVersion, Is.EqualTo(3));
            Assert.That(migrated.StarterUpgradeBranch, Is.EqualTo(StarterUpgradeBranch.Cargo));
            Assert.That(migrated.StarterUpgradeChoicePending, Is.True);
            Assert.That(migrated.RestorationBranch, Is.EqualTo(RestorationBranch.None));
            Assert.That(migrated.RestorationChoicePending, Is.False);
        }

        [Test]
        public void HandlingSelectionIsPersistentContentAndChangesLaunchPhysics()
        {
            GarageState state = GarageState.CreateNew();
            for (int i = 0; i < 8; i++) state = GarageDomainService.Extract(state, new CargoManifest(0, 0, 0)).State;
            ShipLaunchProfile before = GarageDomainService.CreateLaunchProfile(state);
            GarageCommandResult equipped = GarageDomainService.EquipHandling(state, "wipeout");
            ShipLaunchProfile after = GarageDomainService.CreateLaunchProfile(equipped.State);

            Assert.That(equipped.Succeeded, Is.True);
            Assert.That(equipped.State.SelectedHandlingId, Is.EqualTo("wipeout"));
            Assert.That(after.LateralSpeedMultiplier, Is.GreaterThan(before.LateralSpeedMultiplier));
            Assert.That(GarageCatalog.GetHandling("wipeout").Drift, Is.EqualTo(.55f));
        }

        [Test]
        public void GarageOrchestratorOnlyCoordinatesDomainClockAndPersistence()
        {
            var store = new FakeGarageStore();
            var orchestrator = new GarageOrchestrator(store, new FakeClock(), new FakeRepairAcceleration());
            GarageCommandResult extraction = orchestrator.Extract(new CargoManifest(2, 1, 0));

            Assert.That(extraction.Succeeded, Is.True);
            Assert.That(store.SaveCount, Is.GreaterThanOrEqualTo(2));
            Assert.That(orchestrator.Current.SuccessfulExtractions, Is.EqualTo(1));
            Assert.That(typeof(GarageDomainService).Assembly.GetReferencedAssemblies(),
                Has.None.Matches<System.Reflection.AssemblyName>(name => name.Name.StartsWith("UnityEngine")));
        }

        [Test]
        public void CargoIsRunLocalUntilAnExplicitCoreExtraction()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = false,
                FirstExtractionDistance = .1f,
                CargoCapacity = 6
            }, 110u);
            simulation.StartRun(11001L);
            simulation.RegisterPickup(PickupSpawn.Cargo(RunCargoKind.Alloy, 2, 0f, 1.2f, 3.9f));
            simulation.Step(default);

            Assert.That(simulation.Snapshot.CargoAlloy, Is.EqualTo(2));
            Assert.That(simulation.Snapshot.ExtractionAvailable, Is.True);
            Assert.That(simulation.TryExtract(out RunCargoManifest manifest), Is.True);
            Assert.That(manifest.Alloy, Is.EqualTo(2));
            Assert.That(simulation.Phase, Is.EqualTo(CoreGamePhase.Extracted));
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.RunExtracted), Is.True);
        }

        [Test]
        public void CargoUsesWeightAndRejectsAnItemThatDoesNotFit()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                CollisionEnabled = false,
                CargoCapacity = 5
            }, 112u);
            simulation.StartRun();
            simulation.RegisterPickup(PickupSpawn.Cargo(RunCargoKind.Prism, 1, 0f, 1.2f, 3.9f));
            simulation.Step(default);

            Assert.That(CargoCatalog.Prism.Weight, Is.EqualTo(6));
            Assert.That(simulation.Snapshot.CargoWeight, Is.Zero);
            Assert.That(simulation.Snapshot.CargoCapacityWeight, Is.EqualTo(5));
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.CargoRejectedForWeight), Is.True);
        }

        [Test]
        public void PassingExtractionWindowRaisesHeatAndSchedulesAnotherWindow()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                BaseSpeed = 6f,
                StartSpeedMultiplier = 1f,
                HazardSpawningEnabled = false,
                CollisionEnabled = false,
                FirstExtractionDistance = .2f,
                ExtractionWindowLengthDistance = .3f,
                ExtractionIntervalDistance = .7f
            }, 113u);
            simulation.StartRun();
            simulation.Step(default);
            simulation.Step(default);
            Assert.That(simulation.Snapshot.ExtractionWindowOpen, Is.True);

            bool sawHeat = false;
            for (int i = 0; i < 4; i++)
            {
                simulation.Step(default);
                sawHeat |= ContainsEvent(simulation.Events, SimulationEventType.HeatChanged);
            }

            Assert.That(simulation.Snapshot.HeatLevel, Is.EqualTo(1));
            Assert.That(simulation.Snapshot.ExtractionWindowOpen, Is.False);
            Assert.That(simulation.Snapshot.HeatRewardMultiplier, Is.GreaterThan(1f));
            Assert.That(simulation.Snapshot.NextExtractionDistance, Is.EqualTo(.9f).Within(.001f));
            Assert.That(sawHeat, Is.True);
        }

        [Test]
        public void UpgradeCostsStrictlyIncreaseAndEngineUpgradeChangesLaunchPerformance()
        {
            foreach (GarageUpgradeId id in System.Enum.GetValues(typeof(GarageUpgradeId)))
            {
                GarageUpgradeDefinition definition = GarageProgressionCatalog.Get(id);
                int previous = 0;
                for (int level = 1; level < definition.MaximumLevel; level++)
                {
                    int cost = definition.NextCreditCost(level);
                    Assert.That(cost, Is.GreaterThan(previous), id.ToString());
                    previous = cost;
                }
            }

            GarageState state = GarageState.CreateNew();
            state.SuccessfulExtractions = 4;
            state.Credits = 10000;
            state.GetSubsystem(ShipSubsystem.PrimaryThruster).Integrity = 1f;
            ShipLaunchProfile before = GarageDomainService.CreateLaunchProfile(state);
            GarageCommandResult upgraded = GarageDomainService.PurchaseUpgrade(state, GarageUpgradeId.Engine);
            ShipLaunchProfile after = GarageDomainService.CreateLaunchProfile(upgraded.State);

            Assert.That(upgraded.Succeeded, Is.True);
            Assert.That(upgraded.State.Credits, Is.LessThan(state.Credits));
            Assert.That(after.SpeedMultiplier, Is.GreaterThan(before.SpeedMultiplier));
            Assert.That(after.AccelerationMultiplier, Is.GreaterThan(before.AccelerationMultiplier));
        }

        [Test]
        public void UnifiedPaceModelComposesEachAuthorityExactlyOnce()
        {
            RunPaceState pace = RunPaceModel.Resolve(new RunPaceInput(
                36f,
                .72f,
                1.12f,
                .92f,
                1.8f));

            Assert.That(pace.PersistentCruiseSpeed, Is.EqualTo(25.92f).Within(.0001f));
            Assert.That(pace.DepthHeatModifier, Is.EqualTo(1.12f));
            Assert.That(pace.EncounterApproachModifier, Is.EqualTo(.92f));
            Assert.That(pace.TemporaryPowerupModifier, Is.EqualTo(1.8f));
            Assert.That(pace.EffectiveSpeed,
                Is.EqualTo(36f * .72f * 1.12f * .92f * 1.8f).Within(.0001f));
        }

        [Test]
        public void ProofEncountersAreReachableAndRejectAllThreeTrivialPolicies()
        {
            var config = new SimulationConfig
            {
                StartSpeedMultiplier = 1.5f,
                PersistentCruiseSpeedMultiplier = .70f
            };
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(config);
            var validator = new EncounterCapabilityValidator();

            foreach (EncounterPlan plan in EncounterPlanCatalog.CreateProofSequence())
            {
                EncounterValidationResult result = validator.Validate(
                    plan,
                    capability.AtCruiseSpeed(capability.CruiseSpeed * plan.ApproachModifier),
                    0);
                Assert.That(result.Reachable, Is.True, plan.Id);
                Assert.That(result.RejectsNeutral, Is.True, plan.Id);
                Assert.That(result.RejectsConstantLeft, Is.True, plan.Id);
                Assert.That(result.RejectsConstantRight, Is.True, plan.Id);
                Assert.That(result.FeasibilityMargin, Is.GreaterThan(0f), plan.Id);
            }
        }

        [Test]
        public void CapabilityValidatorRejectsAnImpossibleRapidReversal()
        {
            var plan = new EncounterPlan(
                "test.impossible-reversal",
                EncounterKind.MonumentalBroadWeave,
                160f,
                1f,
                new EncounterCapabilityContract(20f, 100f, .55f, .65f, 0, 5),
                new[]
                {
                    new EncounterOpening(100f, -10f, 4f),
                    new EncounterOpening(106f,  10f, 4f),
                    new EncounterOpening(160f,   0f, 4f)
                });
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 1.5f,
                PersistentCruiseSpeedMultiplier = .70f
            });

            EncounterValidationResult result = new EncounterCapabilityValidator().Validate(plan, capability, 0);

            Assert.That(result.Reachable, Is.False);
            Assert.That(result.IsAdmissible, Is.False);
        }

        [Test]
        public void ProofRuntimeStreamsThreeComposedEncountersAndExtractsThroughSpatialGate()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                StartSpeedMultiplier = 1.5f,
                PersistentCruiseSpeedMultiplier = .70f,
                ProofEncounterMode = true,
                CollisionEnabled = false,
                HazardSpawningEnabled = true,
                MaxHazards = 600,
                MaxPickups = 128,
                MaxCorridorSlices = 96
            }, 20260715u);
            simulation.StartRun(2026071501L);

            bool sawMonuments = false;
            bool sawLightning = false;
            bool sawPrismatic = false;
            bool sawCargo = false;
            bool sawLaser = false;
            bool sawGate = false;
            for (int tick = 0; tick < 9000 && simulation.Phase == CoreGamePhase.Playing; tick++)
            {
                SimulationSnapshot before = simulation.Snapshot;
                bool right = before.ExtractionGateVisible && before.ShipX < before.ExtractionGateX;
                bool left = before.ExtractionGateVisible && before.ShipX > before.ExtractionGateX;
                simulation.Step(new InputFrame(left, right));
                SimulationSnapshot snapshot = simulation.Snapshot;

                sawMonuments |= snapshot.EncounterKind == EncounterKind.MonumentalBroadWeave;
                sawLightning |= snapshot.EncounterKind == EncounterKind.LightningMovingGate;
                sawPrismatic |= snapshot.EncounterKind == EncounterKind.PrismaticSineCorridor
                    && snapshot.CorridorSliceCount > 1;
                sawGate |= snapshot.ExtractionGateVisible;
                for (int i = 0; i < snapshot.PickupCount; i++)
                {
                    PickupSnapshot pickup = snapshot.GetPickup(i);
                    sawCargo |= pickup.Kind == PickupKind.Cargo;
                    sawLaser |= pickup.Kind == PickupKind.Powerup && pickup.Powerup == PowerupType.Laser;
                }
            }

            Assert.That(sawMonuments, Is.True);
            Assert.That(sawLightning, Is.True);
            Assert.That(sawPrismatic, Is.True);
            Assert.That(sawCargo, Is.True);
            Assert.That(sawLaser, Is.True);
            Assert.That(sawGate, Is.True);
            Assert.That(simulation.Phase, Is.EqualTo(CoreGamePhase.Extracted));
            Assert.That(simulation.TryConsumeAutomaticExtraction(out RunCargoManifest manifest), Is.True);
            Assert.That(manifest.HeatLevel, Is.Zero);
        }

        [Test]
        public void MissingProofExtractionGateContinuesDeeperAndRaisesHeat()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                StartSpeedMultiplier = 1.5f,
                PersistentCruiseSpeedMultiplier = .70f,
                ProofEncounterMode = true,
                CollisionEnabled = false,
                HazardSpawningEnabled = true,
                MaxHazards = 600,
                MaxPickups = 128,
                MaxCorridorSlices = 96
            }, 20260716u);
            simulation.StartRun(2026071601L);

            bool sawGate = false;
            for (int tick = 0; tick < 6000 && simulation.Snapshot.HeatLevel == 0; tick++)
            {
                sawGate |= simulation.Snapshot.ExtractionGateVisible;
                simulation.Step(default);
            }

            Assert.That(sawGate, Is.True);
            Assert.That(simulation.Phase, Is.EqualTo(CoreGamePhase.Playing));
            Assert.That(simulation.Snapshot.HeatLevel, Is.EqualTo(1));
            Assert.That(simulation.Snapshot.EncounterCycle, Is.EqualTo(1));
            simulation.Step(default);
            Assert.That(simulation.Snapshot.PaceHeatModifier, Is.EqualTo(1.06f).Within(.0001f));
            Assert.That(simulation.TryConsumeAutomaticExtraction(out _), Is.False);
        }

        [Test]
        public void RestoredHullSurvivesOneCollisionThenFailsTheNext()
        {
            var simulation = new JetHorizonSimulation(new SimulationConfig
            {
                HazardSpawningEnabled = false,
                HullHitCapacity = 2
            }, 111u);
            simulation.StartRun();
            simulation.RegisterHazard(HazardSpawn.Cone(0f, 3.9f, collisionHalfWidth: 1f));
            simulation.Step(default);
            Assert.That(simulation.Phase, Is.EqualTo(CoreGamePhase.Playing));
            Assert.That(simulation.Snapshot.HullHitsRemaining, Is.EqualTo(1));
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.HullDamaged), Is.True);

            simulation.RegisterHazard(HazardSpawn.Cone(0f, 3.9f, collisionHalfWidth: 1f));
            simulation.Step(default);
            Assert.That(simulation.Phase, Is.EqualTo(CoreGamePhase.Dead));
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

        sealed class FakeProgressStore : IRunProgressStore
        {
            public RunProgress Saved;
            public bool TryLoad(out RunProgress progress) { progress = Saved; return Saved.SchemaVersion > 0; }
            public void Save(RunProgress progress) => Saved = progress;
        }

        sealed class FakeAudio : IAudioOutput
        {
            public AudioCue LastCue;
            public void Play(AudioCue cue) => LastCue = cue;
        }

        sealed class FakeHaptics : IHapticsOutput
        {
            public HapticCue LastCue;
            public void Play(HapticCue cue) => LastCue = cue;
        }

        sealed class FakeAnalytics : IAnalyticsSink
        {
            public AnalyticsEvent Last;
            public void Track(AnalyticsEvent analyticsEvent) => Last = analyticsEvent;
        }

        sealed class FakeClock : IUtcClock
        {
            public long UtcUnixMilliseconds => 123456789L;
        }

        sealed class FakeLeaderboard : ILeaderboardService
        {
            public long LastScore;
            public int SubmissionCount;
            public void SubmitScore(LeaderboardSubmission submission)
            {
                LastScore = submission.Score;
                SubmissionCount++;
            }
        }

        sealed class FakeGarageStore : IGarageProgressStore
        {
            public GarageState State;
            public int SaveCount;
            public bool TryLoad(out GarageState state) { state = State; return State != null; }
            public void Save(GarageState state) { State = state.Copy(); SaveCount++; }
        }

        sealed class FakeRepairAcceleration : IRepairAccelerationPort
        {
            public bool TryConsumeRepairAcceleration(long repairJobId) => true;
        }
    }
}
