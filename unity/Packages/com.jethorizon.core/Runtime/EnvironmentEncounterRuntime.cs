using System;

namespace JetHorizon.Simulation
{
    /// <summary>
    /// Streams collision/reward samples from a complete pre-authored environment.
    /// Rendering may prebuild the entire world, but gameplay still consumes the same
    /// validated centerline and aperture facts.
    /// </summary>
    public sealed class EnvironmentEncounterRuntime
    {
        readonly EncounterPlan[] _catalog;
        EncounterPlan _activePlan;
        int _nextOpening;
        float _startDistance;
        EnvironmentLifecycle _lifecycle;

        public bool Active => _activePlan != null && _lifecycle != EnvironmentLifecycle.Retired;
        public EncounterPlan Plan => _activePlan;
        public float StartDistance => _startDistance;
        public EnvironmentLifecycle Lifecycle => _lifecycle;

        public EnvironmentEncounterRuntime(EncounterPlan[] catalog)
        {
            _catalog = catalog ?? throw new ArgumentNullException(nameof(catalog));
        }

        public void Reset()
        {
            _activePlan = null;
            _nextOpening = 0;
            _startDistance = 0f;
            _lifecycle = EnvironmentLifecycle.Dormant;
        }

        public void Activate(RunEnvironmentKind environment, float startDistance)
        {
            EncounterKind kind = environment == RunEnvironmentKind.CrystallineCanyon
                ? EncounterKind.CrystallineCanyon
                : environment == RunEnvironmentKind.PrismaticCorridor
                    ? EncounterKind.PrismaticSineCorridor
                    : default;
            _activePlan = null;
            for (int i = 0; i < _catalog.Length; i++)
            {
                if (_catalog[i].Kind != kind) continue;
                _activePlan = _catalog[i];
                break;
            }
            if (_activePlan == null) return;
            _nextOpening = 0;
            _startDistance = Math.Max(0f, startDistance);
            _lifecycle = EnvironmentLifecycle.GateCrossedReveal;
        }

        public void Tick(
            float runDistance,
            float shipZ,
            EncounterCommandBuffer commands)
        {
            commands.Clear();
            if (_activePlan == null) return;
            _lifecycle = runDistance < _startDistance
                ? EnvironmentLifecycle.ApproachingTransition
                : runDistance < _startDistance + _activePlan.Length - 120f
                    ? EnvironmentLifecycle.Active
                    : runDistance < _startDistance + _activePlan.Length
                        ? EnvironmentLifecycle.ExitBreakup
                        : EnvironmentLifecycle.Retired;
            if (_lifecycle == EnvironmentLifecycle.Retired) return;

            // Publish the complete route immediately. Unity can display one stable
            // world construct and the core can collide against the same samples.
            while (_nextOpening < _activePlan.OpeningCount)
            {
                EncounterOpening opening = _activePlan.GetOpening(_nextOpening);
                float z = shipZ - ((_startDistance + opening.Distance) - runDistance);
                EncounterCommandType type = _activePlan.Kind == EncounterKind.CrystallineCanyon
                    ? EncounterCommandType.CanyonSlice
                    : EncounterCommandType.PrismaticSlice;
                commands.Add(new EncounterCommand(
                    type,
                    _activePlan.Kind,
                    _nextOpening,
                    opening.CenterX,
                    opening.HalfWidth,
                    z,
                    environmentPhase: opening.EnvironmentPhase,
                    corridorBoundaryActive: opening.CorridorBoundaryActive,
                    traversalRequirement: opening.TraversalRequirement));
                if (opening.CargoTier != CargoRouteTier.None)
                {
                    RunCargoKind cargo = opening.CargoTier == CargoRouteTier.Safe
                        ? RunCargoKind.Salvage
                        : opening.CargoTier == CargoRouteTier.Risky
                            ? RunCargoKind.Alloy
                            : RunCargoKind.Prism;
                    commands.Add(new EncounterCommand(
                        EncounterCommandType.Cargo,
                        _activePlan.Kind,
                        _nextOpening,
                        opening.CenterX,
                        opening.HalfWidth,
                        z - 8f,
                        cargo));
                }
                _nextOpening++;
            }
        }
    }
}
