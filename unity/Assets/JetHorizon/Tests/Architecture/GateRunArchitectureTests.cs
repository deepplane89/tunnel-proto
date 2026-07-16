using JetHorizon.Application;
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
        public void CargoRoutes_CreateSafeRiskyAndCommittedLinesBeforeTheGate()
        {
            var config = new SimulationConfig
            {
                StartSpeedMultiplier = 1f,
                MinimumOperationalSpeed = 36f
            };
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(config);
            var planner = new CargoRoutePlanner();
            var previous = new GateRouteNode(1, SpeedGateKind.Common, 100f, 0f, 7.5f);
            var gate = new GateRouteNode(2, SpeedGateKind.Common, 165f, 4f, 7.5f);

            Assert.That(planner.TryCreate(
                6, 0, previous, gate, -120f, capability, 40f, out RunParcelCommand salvage), Is.True);
            Assert.That(planner.TryCreate(
                6, 1, previous, gate, -120f, capability, 55f, out RunParcelCommand alloy), Is.True);
            Assert.That(planner.TryCreate(
                6, 4, previous, gate, -120f, capability, 90f, out RunParcelCommand prism), Is.True);

            Assert.That(salvage.CargoKind, Is.EqualTo(RunCargoKind.Salvage));
            Assert.That(alloy.CargoKind, Is.EqualTo(RunCargoKind.Alloy));
            Assert.That(prism.CargoKind, Is.EqualTo(RunCargoKind.Prism));
            Assert.That(salvage.Z, Is.GreaterThan(-120f));
            Assert.That(alloy.Z, Is.GreaterThan(-120f));
            Assert.That(prism.Z, Is.GreaterThan(-120f));
            Assert.That(salvage.ReturnX, Is.EqualTo(gate.CenterX).Within(.001f));

            float allowed = gate.HalfWidth - capability.CollisionHalfWidth;
            Assert.That(System.Math.Abs(alloy.ReturnX - gate.CenterX), Is.LessThan(allowed));
            Assert.That(System.Math.Abs(prism.ReturnX - gate.CenterX), Is.GreaterThan(allowed));
            Assert.That(alloy.Count, Is.GreaterThan(salvage.Count));
            Assert.That(prism.Count, Is.GreaterThan(alloy.Count));
        }

        [Test]
        public void LaserRewardRules_FitTheStarterCargoBayAndGuaranteeValuableFinalCargo()
        {
            int totalWeight = 0;
            for (int destroyed = 1; destroyed <= LaserRewardModel.OverloadTargetCount; destroyed++)
            {
                if (!LaserRewardModel.AwardsMilestoneCargo(destroyed)) continue;
                totalWeight += CargoCatalog.Get(LaserRewardModel.MilestoneCargo(destroyed)).Weight;
            }
            bool foundPrism = false;
            for (int i = 0; i < LaserRewardModel.FinalCargoCount; i++)
            {
                RunCargoKind kind = LaserRewardModel.FinalCargo(i);
                totalWeight += CargoCatalog.Get(kind).Weight;
                foundPrism |= kind == RunCargoKind.Prism;
            }

            Assert.That(totalWeight, Is.LessThanOrEqualTo(new SimulationConfig().CargoCapacity));
            Assert.That(foundPrism, Is.True);
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

        [Test]
        public void LaserParcel_PublishesCapacitySafeFormationWithEnoughOverloadTargets()
        {
            JetHorizonSimulation simulation = CreateGateRunSimulation(606u);
            int targets = 0;
            for (int tick = 0; tick < 5000 && targets == 0; tick++)
            {
                simulation.Step(default);
                for (int i = 0; i < simulation.Snapshot.HazardCount; i++)
                    if (simulation.Snapshot.GetHazard(i).Role == HazardRole.LaserFormationTarget)
                        targets++;
            }

            Assert.That(targets, Is.GreaterThanOrEqualTo(LaserRewardModel.OverloadTargetCount));
            Assert.That(targets, Is.LessThan(50));
            Assert.That(simulation.Events.Count, Is.LessThan(64));
        }

        [Test]
        public void SectorEnd_OpensSafeExtractionDecisionAndNoContinuesDeeper()
        {
            JetHorizonSimulation simulation = CreateGateRunSimulation(707u);
            AdvanceToExtractionDecision(simulation);

            Assert.That(simulation.Phase, Is.EqualTo(CoreGamePhase.Playing));
            Assert.That(simulation.Snapshot.ExtractionDecisionOpen, Is.True);
            Assert.That(simulation.Snapshot.ExtractionGateVisible, Is.False);
            Assert.That(simulation.Snapshot.HazardCount, Is.Zero);
            Assert.That(simulation.Snapshot.PickupCount, Is.Zero);

            float heldDistance = simulation.Snapshot.Distance;
            float heldEligibleTime = simulation.Snapshot.EligibleRunElapsed;
            for (int i = 0; i < 120; i++) simulation.Step(new InputFrame(false, true, 0));
            Assert.That(simulation.Snapshot.Distance, Is.EqualTo(heldDistance).Within(.001f));
            Assert.That(simulation.Snapshot.EligibleRunElapsed, Is.EqualTo(heldEligibleTime).Within(.001f));

            Assert.That(simulation.TryResolveExtractionDecision(false, out _), Is.True);
            Assert.That(simulation.Phase, Is.EqualTo(CoreGamePhase.Playing));
            Assert.That(simulation.Snapshot.ExtractionDecisionOpen, Is.False);
            Assert.That(simulation.Snapshot.SectorIndex, Is.EqualTo(1));
            Assert.That(simulation.Snapshot.HeatLevel, Is.EqualTo(1));
            Assert.That(simulation.Snapshot.HeatRewardMultiplier, Is.GreaterThan(1f));

            var planner = new GateRoutePlanner();
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(simulation.Config);
            GateRoutePlan next = planner.Build(1, heldDistance, 60f, capability, new DeterministicRandom(708u));
            Assert.That(next.Get(0).Kind, Is.EqualTo(SpeedGateKind.Surge));
        }

        [Test]
        public void SectorEnd_YesExtractsThroughCoreOwnedDecision()
        {
            JetHorizonSimulation simulation = CreateGateRunSimulation(808u);
            AdvanceToExtractionDecision(simulation);

            Assert.That(simulation.TryResolveExtractionDecision(true, out RunCargoManifest manifest), Is.True);
            Assert.That(simulation.Phase, Is.EqualTo(CoreGamePhase.Extracted));
            Assert.That(manifest.TotalWeight, Is.GreaterThanOrEqualTo(0));
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.ExtractionDecisionResolved), Is.True);
            Assert.That(ContainsEvent(simulation.Events, SimulationEventType.RunExtracted), Is.True);
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

        [Test]
        public void CommonGateCrossing_RoutesLightHapticThroughApplicationPort()
        {
            var haptics = new FakeHaptics();
            var router = new RunEventRouter(new GameServices(
                new FakeProgressStore(),
                new FakeAudio(),
                haptics,
                new FakeAnalytics(),
                new FakeClock(),
                new FakeLeaderboard()));
            var simulation = new JetHorizonSimulation(
                new SimulationConfig
                {
                    GateRunMode = true,
                    StartSpeedMultiplier = 1f,
                    MinimumOperationalSpeed = 36f,
                    CollisionEnabled = false,
                    MaxHazards = 600,
                    MaxPickups = 128,
                    MaxCorridorSlices = 128
                },
                90210u);
            simulation.StartRun(90210L);
            router.Dispatch(simulation.Events);
            for (int i = 0; i < 180 && simulation.Snapshot.GatesCrossed == 0; i++)
            {
                simulation.Step(default);
                router.Dispatch(simulation.Events);
            }
            Assert.That(simulation.Snapshot.GatesCrossed, Is.GreaterThan(0));
            Assert.That(haptics.LastCue, Is.EqualTo(HapticCue.Light));
        }

        sealed class FakeProgressStore : IRunProgressStore
        {
            public bool TryLoad(out RunProgress progress) { progress = RunProgress.Empty; return false; }
            public void Save(RunProgress progress) { }
        }

        sealed class FakeAudio : IAudioOutput
        {
            public void Play(AudioCue cue) { }
        }

        sealed class FakeHaptics : IHapticsOutput
        {
            public HapticCue LastCue;
            public void Play(HapticCue cue) => LastCue = cue;
        }

        sealed class FakeAnalytics : IAnalyticsSink
        {
            public void Track(AnalyticsEvent analyticsEvent) { }
        }

        sealed class FakeClock : IUtcClock
        {
            public long UtcUnixMilliseconds => 1L;
        }

        sealed class FakeLeaderboard : ILeaderboardService
        {
            public void SubmitScore(LeaderboardSubmission submission) { }
        }

        static JetHorizonSimulation CreateGateRunSimulation(uint seed)
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
                    HazardSimulationEnabled = true,
                    PickupSimulationEnabled = true,
                    MaxHazards = 600,
                    MaxPickups = 128,
                    MaxCorridorSlices = 128,
                    MaxGates = 16
                },
                seed);
            simulation.StartRun(seed);
            return simulation;
        }

        static void AdvanceToExtractionDecision(JetHorizonSimulation simulation)
        {
            for (int i = 0; i < 12000 && !simulation.Snapshot.ExtractionDecisionOpen; i++)
                simulation.Step(default);
            Assert.That(simulation.Snapshot.ExtractionDecisionOpen, Is.True);
        }

        static bool ContainsEvent(SimulationEventBuffer events, SimulationEventType type)
        {
            for (int i = 0; i < events.Count; i++)
                if (events[i].Type == type) return true;
            return false;
        }
    }
}
