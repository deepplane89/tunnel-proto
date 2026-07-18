using System;

namespace JetHorizon.Simulation
{
    /// <summary>Engine-neutral authored canyon knot. Unity is only one possible authoring front end.</summary>
    public readonly struct CanyonPathKnot
    {
        public float Distance { get; }
        public float CenterX { get; }
        public float HalfWidth { get; }
        public CargoRouteTier CargoTier { get; }
        public CanyonEnvironmentPhase EnvironmentPhase { get; }
        public bool CorridorBoundaryActive { get; }
        public TraversalRequirement TraversalRequirement { get; }

        public CanyonPathKnot(
            float distance,
            float centerX,
            float halfWidth,
            CargoRouteTier cargoTier = CargoRouteTier.None,
            CanyonEnvironmentPhase environmentPhase = CanyonEnvironmentPhase.None,
            bool corridorBoundaryActive = true,
            TraversalRequirement traversalRequirement = TraversalRequirement.None)
        {
            if (distance < 0f || float.IsNaN(distance) || float.IsInfinity(distance))
                throw new ArgumentOutOfRangeException(nameof(distance));
            if (halfWidth <= 0f || float.IsNaN(halfWidth) || float.IsInfinity(halfWidth))
                throw new ArgumentOutOfRangeException(nameof(halfWidth));
            if (float.IsNaN(centerX) || float.IsInfinity(centerX))
                throw new ArgumentOutOfRangeException(nameof(centerX));
            Distance = distance;
            CenterX = centerX;
            HalfWidth = halfWidth;
            CargoTier = cargoTier;
            EnvironmentPhase = environmentPhase;
            CorridorBoundaryActive = corridorBoundaryActive;
            TraversalRequirement = traversalRequirement;
        }
    }

    /// <summary>
    /// Immutable path definition shared by encounter validation, collision, and presentation adapters.
    /// It deliberately contains no Unity types, spline package types, rendering data, or editor state.
    /// </summary>
    public sealed class CanyonPathDefinition
    {
        readonly CanyonPathKnot[] _knots;

        public float Length { get; }
        public int KnotCount => _knots.Length;

        public CanyonPathDefinition(float length, CanyonPathKnot[] knots)
        {
            if (length <= 0f || float.IsNaN(length) || float.IsInfinity(length))
                throw new ArgumentOutOfRangeException(nameof(length));
            if (knots == null || knots.Length < 4)
                throw new ArgumentException("A canyon path needs at least four knots.", nameof(knots));
            _knots = new CanyonPathKnot[knots.Length];
            float previous = -1f;
            for (int i = 0; i < knots.Length; i++)
            {
                if (knots[i].Distance <= previous || knots[i].Distance > length)
                    throw new ArgumentException("Canyon knots must be strictly ordered inside the path.", nameof(knots));
                _knots[i] = knots[i];
                previous = knots[i].Distance;
            }
            Length = length;
        }

        public CanyonPathKnot GetKnot(int index) => index >= 0 && index < _knots.Length
            ? _knots[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public EncounterOpening[] CreateOpenings(float distanceScale)
        {
            if (distanceScale <= 0f || float.IsNaN(distanceScale) || float.IsInfinity(distanceScale))
                throw new ArgumentOutOfRangeException(nameof(distanceScale));
            var openings = new EncounterOpening[_knots.Length];
            for (int i = 0; i < _knots.Length; i++)
            {
                CanyonPathKnot knot = _knots[i];
                openings[i] = new EncounterOpening(
                    knot.Distance * distanceScale,
                    knot.CenterX,
                    knot.HalfWidth,
                    knot.CargoTier,
                    environmentPhase: knot.EnvironmentPhase,
                    corridorBoundaryActive: knot.CorridorBoundaryActive,
                    traversalRequirement: knot.TraversalRequirement);
            }
            return openings;
        }
    }

    /// <summary>
    /// Small authored paths used by the checkpoint gameplay proof. These are kept in
    /// the engine-neutral package so route timing, collision and every presenter use
    /// the same corridor rather than independently approximating its shape.
    /// </summary>
    public static class CheckpointCanyonPathCatalog
    {
        public static CanyonPathDefinition CreateCompactLightningCorridor()
        {
            return new CanyonPathDefinition(
                440f,
                new[]
                {
                    new CanyonPathKnot( 28f,   0f, 36f, environmentPhase: CanyonEnvironmentPhase.OpenWater, corridorBoundaryActive: false),
                    new CanyonPathKnot( 56f,   0f, 34f, environmentPhase: CanyonEnvironmentPhase.OpenWater, corridorBoundaryActive: false),
                    new CanyonPathKnot( 84f,  -4f, 30f, environmentPhase: CanyonEnvironmentPhase.Convergence, corridorBoundaryActive: false),
                    new CanyonPathKnot(112f, -11f, 26f, environmentPhase: CanyonEnvironmentPhase.Convergence, corridorBoundaryActive: false),
                    new CanyonPathKnot(140f, -17f, 21f, environmentPhase: CanyonEnvironmentPhase.Threshold),
                    new CanyonPathKnot(168f, -16f, 19f, environmentPhase: CanyonEnvironmentPhase.Enclosed),
                    new CanyonPathKnot(196f,  -8f, 19f, environmentPhase: CanyonEnvironmentPhase.Enclosed),
                    new CanyonPathKnot(224f,   4f, 19f, environmentPhase: CanyonEnvironmentPhase.Enclosed),
                    new CanyonPathKnot(252f,  16f, 19f, environmentPhase: CanyonEnvironmentPhase.Enclosed),
                    new CanyonPathKnot(280f,  18f, 19f, environmentPhase: CanyonEnvironmentPhase.Enclosed),
                    new CanyonPathKnot(308f,  10f, 19f, environmentPhase: CanyonEnvironmentPhase.Enclosed),
                    new CanyonPathKnot(336f,  -3f, 19f, environmentPhase: CanyonEnvironmentPhase.Enclosed),
                    new CanyonPathKnot(364f, -15f, 19f, environmentPhase: CanyonEnvironmentPhase.Enclosed),
                    new CanyonPathKnot(392f, -18f, 20f, environmentPhase: CanyonEnvironmentPhase.Enclosed),
                    new CanyonPathKnot(420f,  -8f, 28f, environmentPhase: CanyonEnvironmentPhase.Breakup, corridorBoundaryActive: false),
                    new CanyonPathKnot(440f,   0f, 36f, environmentPhase: CanyonEnvironmentPhase.Breakup, corridorBoundaryActive: false)
                });
        }
    }
}
