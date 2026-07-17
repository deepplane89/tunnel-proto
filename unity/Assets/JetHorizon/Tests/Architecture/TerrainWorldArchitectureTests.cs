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
                    Is.EqualTo(world.Length).Within(.01f));
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
        public void ConsecutiveWorlds_RepeatOnlyRockProofWithDifferentRouteGeometry()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            TerrainWorldPlan first = TerrainWorldCatalog.CreateProofWorld(0, 0f, capability);
            TerrainWorldPlan second = TerrainWorldCatalog.CreateProofWorld(1, first.Length, capability);
            TerrainWorldPlan third = TerrainWorldCatalog.CreateProofWorld(2, first.Length + second.Length, capability);

            Assert.That(first.Parcels.Id, Is.Not.EqualTo(second.Parcels.Id));
            Assert.That(first.GetParcel(1).Kind, Is.EqualTo(WorldParcelKind.OpenWaterFormation));
            Assert.That(second.GetParcel(1).Kind, Is.EqualTo(WorldParcelKind.OpenWaterFormation));
            Assert.That(third.GetParcel(1).Kind, Is.EqualTo(WorldParcelKind.OpenWaterFormation));
            Assert.That(first.GetParcel(1).VariantId, Is.Not.EqualTo(second.GetParcel(1).VariantId));
            for (int worldIndex = 0; worldIndex < 3; worldIndex++)
            {
                TerrainWorldPlan world = worldIndex == 0 ? first : worldIndex == 1 ? second : third;
                for (int parcelIndex = 0; parcelIndex < world.ParcelCount; parcelIndex++)
                    Assert.That(world.GetParcel(parcelIndex).Kind,
                        Is.EqualTo(WorldParcelKind.OpenWaterBreather)
                            .Or.EqualTo(WorldParcelKind.OpenWaterFormation));
            }
        }

        [Test]
        public void ProofCatalog_NeverActivatesAnotherObstacleFamily()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            for (int sector = 0; sector < 6; sector++)
            {
                TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(sector, sector * 1600f, capability);
                Assert.That(world.ParcelCount, Is.EqualTo(3));
                Assert.That(world.GetParcel(0).Kind, Is.EqualTo(WorldParcelKind.OpenWaterBreather));
                Assert.That(world.GetParcel(1).Kind, Is.EqualTo(WorldParcelKind.OpenWaterFormation));
                Assert.That(world.GetParcel(2).Kind, Is.EqualTo(WorldParcelKind.OpenWaterBreather));
                Assert.That(world.RouteSectionCount, Is.Zero);
            }
        }

        [Test]
        public void WorldWaveSentence_IsOnlyWaterRockWater()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(0, 0f, capability);

            Assert.That(world.WaveCount, Is.EqualTo(3));
            Assert.That(world.GetWave(0).Kind, Is.EqualTo(TerrainWaveKind.OpenWaterBreather));
            Assert.That(world.GetWave(1).Kind, Is.EqualTo(TerrainWaveKind.OpenWaterFormation));
            Assert.That(world.GetWave(2).Kind, Is.EqualTo(TerrainWaveKind.OpenWaterBreather));
            Assert.That(world.GetWave(0).EndDistance, Is.EqualTo(world.GetWave(1).StartDistance).Within(.01f));
            Assert.That(world.GetWave(1).EndDistance, Is.EqualTo(world.GetWave(2).StartDistance).Within(.01f));
        }

        [Test]
        public void RockProof_HasNoCanyonPortalOrCorridorTopology()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            TerrainWorldPlan world = TerrainWorldCatalog.CreateProofWorld(0, 0f, capability);
            Assert.That(world.RouteSectionCount, Is.Zero);
            for (int i = 0; i < world.ParcelCount; i++)
            {
                WorldParcelPlan parcel = world.GetParcel(i);
                Assert.That(parcel.Envelope, Is.EqualTo(WorldEnvelopeKind.None));
                Assert.That(parcel.Threats.Kind, Is.EqualTo(WorldThreatKind.None));
            }
        }

        [Test]
        public void TerrainWorld_PublishesOnePersistentTopologyAndNoLegacyGates()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            SimulationSnapshot start = simulation.Snapshot;

            Assert.That(start.TerrainWorldMode, Is.True);
            Assert.That(start.TerrainWorldId, Is.EqualTo("terrain-world-00"));
            Assert.That(start.TerrainWorldSectionCount, Is.GreaterThanOrEqualTo(8));
            Assert.That(start.TerrainWorldFeatureCount, Is.GreaterThanOrEqualTo(8));
            Assert.That(start.TerrainRouteSectionCount, Is.Zero);
            Assert.That(start.WorldParcelCount, Is.EqualTo(3));
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
        public void TerrainWorld_ProgressesThroughOnlyRocksAndAutomaticBreathers()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            float startingSpeed = simulation.Snapshot.Speed;
            bool sawFormation = false;
            bool sawReturnToOpenWater = false;
            bool sawBreather = false;
            string firstWorld = simulation.Snapshot.TerrainWorldId;

            for (int i = 0; i < 18000 && simulation.Snapshot.TerrainWorldId != "terrain-world-02"; i++)
            {
                simulation.Step(default);
                sawFormation |= simulation.Snapshot.ActiveWorldParcelKind == WorldParcelKind.OpenWaterFormation;
                sawReturnToOpenWater |= simulation.Snapshot.ActiveWorldParcelKind == WorldParcelKind.OpenWaterBreather;
                sawBreather |= simulation.Snapshot.ActiveTerrainRegion == TerrainRegionKind.ExtractionBreather;
                Assert.That(simulation.Snapshot.ActiveWorldParcelKind,
                    Is.EqualTo(WorldParcelKind.OpenWaterBreather)
                        .Or.EqualTo(WorldParcelKind.OpenWaterFormation));
                for (int hazardIndex = 0; hazardIndex < simulation.Snapshot.HazardCount; hazardIndex++)
                    Assert.That(simulation.Snapshot.GetHazard(hazardIndex).Kind, Is.Not.EqualTo(HazardKind.Lightning));
                Assert.That(simulation.Snapshot.ExtractionDecisionOpen, Is.False);
                Assert.That(simulation.Snapshot.CorridorSliceCount, Is.Zero);
                Assert.That(simulation.Snapshot.SineCorridorActive, Is.False);
            }

            Assert.That(sawFormation, Is.True);
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
            Assert.That(simulation.Snapshot.QueuedTerrainWorldSectionCount, Is.GreaterThanOrEqualTo(8));
            Assert.That(simulation.Snapshot.QueuedWorldParcelCount, Is.EqualTo(3));
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
        public void RockOnlyProof_NeverSpawnsLightning()
        {
            JetHorizonSimulation simulation = CreateTerrainSimulation();
            for (int frame = 0; frame < 5000; frame++)
            {
                simulation.Step(default);
                Assert.That(simulation.Snapshot.HazardCount, Is.Zero);
                Assert.That(simulation.Snapshot.CorridorSliceCount, Is.Zero);
                Assert.That(simulation.Snapshot.SineCorridorActive, Is.False);
            }
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
        public void RockOnlyProof_NeverBuildsRouteJunctionCollision()
        {
            ShipCapabilityProfile capability = ShipCapabilityProfile.FromConfig(new SimulationConfig
            {
                StartSpeedMultiplier = 3f,
                MinimumOperationalSpeed = 100f
            });
            TerrainWorldPlan world = new TerrainWorldRuntime(capability).World;
            Assert.That(world.RouteSectionCount, Is.Zero);
            Assert.That(world.TryGetRoutePassage(TerrainRouteKind.SafeCanyon, world.Length * .5f,
                out _, out _, out _), Is.False);
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
                float fastScale = RandomConeFormationPlanner.PaceDistanceScale(
                    TerrainWorldPaceRules.MaximumSpeedForHeat(5));
                if (slow.GetRow(row).RowInBurst == 0)
                    Assert.That(slowSpacing, Is.EqualTo(RandomConeFormationPlanner.InterBurstSpacing).Within(.001f));
                else
                    Assert.That(slowSpacing,
                        Is.InRange(
                            RandomConeFormationPlanner.NominalInBurstSpacing - 5f,
                            RandomConeFormationPlanner.NominalInBurstSpacing + 5f));
                Assert.That(fastSpacing, Is.EqualTo(slowSpacing * fastScale).Within(.01f));
                slowSeconds += slowSpacing / TerrainWorldPaceRules.MaximumSpeedForHeat(0);
                fastSeconds += fastSpacing / TerrainWorldPaceRules.MaximumSpeedForHeat(5);
            }
            Assert.That(fastSeconds, Is.LessThan(slowSeconds * .9f));
            Assert.That(fastSeconds, Is.GreaterThan(slowSeconds * .75f));
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
