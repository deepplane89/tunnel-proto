using System.Collections.Generic;

namespace JetHorizon.Simulation
{
    public sealed partial class JetHorizonSimulation
    {
        readonly HashSet<int> _cargoWaveCollectiblesSpawned = new HashSet<int>();
        string _lastCargoWaveId = string.Empty;
        CargoWaveLifecycle _lastCargoWaveLifecycle = CargoWaveLifecycle.None;

        /// <summary>
        /// Materializes only core-authored collectible plans. Unity receives the
        /// normal pickup snapshot and never chooses a route, reward or spawn time.
        /// Both the current and queued terrain worlds are registered wholesale so
        /// no collectible construction can become visible at the horizon.
        /// </summary>
        void SyncCargoFirstWavePickups()
        {
            if (_terrainWorld == null) return;
            PublishCargoWaveState(_terrainWorld.CargoWaveState);
            if (!_config.PickupSimulationEnabled) return;
            RegisterCargoWaveSequence(_terrainWorld.CargoWaves);
            RegisterCargoWaveSequence(_terrainWorld.QueuedCargoWaves);
        }

        void RegisterCargoWaveSequence(CargoWaveSequencePlan sequence)
        {
            if (sequence == null) return;
            for (int waveIndex = 0; waveIndex < sequence.WaveCount; waveIndex++)
            {
                CargoWavePlan wave = sequence.GetWave(waveIndex);
                if (_distance < wave.StartDistance - wave.HorizonRevealDistance) continue;
                for (int collectibleIndex = 0; collectibleIndex < wave.CollectibleCount; collectibleIndex++)
                {
                    CargoWaveCollectible collectible = wave.GetCollectible(collectibleIndex);
                    if (_cargoWaveCollectiblesSpawned.Contains(collectible.Id)) continue;

                    float z = _config.ShipZ - (collectible.Distance - _distance);
                    if (z > _config.DespawnZ)
                    {
                        _cargoWaveCollectiblesSpawned.Add(collectible.Id);
                        continue;
                    }

                    PickupSpawn spawn = CreateCargoWavePickup(collectible, z);
                    if (SpawnPickup(spawn) == 0) return;
                    _cargoWaveCollectiblesSpawned.Add(collectible.Id);
                }
            }
        }

        static PickupSpawn CreateCargoWavePickup(CargoWaveCollectible collectible, float z)
        {
            switch (collectible.Family)
            {
                case CargoCollectibleFamily.CreditCache:
                    return PickupSpawn.Coin(
                        collectible.X,
                        collectible.Y,
                        z,
                        collectible.Units * 75f);
                case CargoCollectibleFamily.Powerup:
                    return PickupSpawn.PowerupPickup(
                        collectible.Powerup,
                        collectible.X,
                        collectible.Y,
                        z);
                default:
                    return PickupSpawn.Cargo(
                        collectible.CargoKind,
                        collectible.Units,
                        collectible.X,
                        collectible.Y,
                        z);
            }
        }

        void ResetCargoFirstWavePickups()
        {
            _cargoWaveCollectiblesSpawned.Clear();
            _lastCargoWaveId = string.Empty;
            _lastCargoWaveLifecycle = CargoWaveLifecycle.None;
        }

        void PublishCargoWaveState(CargoWaveRuntimeState state)
        {
            string waveId = state.WaveId ?? string.Empty;
            if (waveId != _lastCargoWaveId)
            {
                Events.Add(new SimulationEvent(
                    SimulationEventType.CargoWaveChanged,
                    _terrainWorld.Snapshot.Sector,
                    (float)state.Kind,
                    state.StartDistance));
                _lastCargoWaveId = waveId;
            }
            if (state.Lifecycle == _lastCargoWaveLifecycle) return;
            Events.Add(new SimulationEvent(
                SimulationEventType.CargoWaveLifecycleChanged,
                _terrainWorld.Snapshot.Sector,
                (float)state.Kind,
                (float)state.Lifecycle));
            _lastCargoWaveLifecycle = state.Lifecycle;
        }
    }
}
