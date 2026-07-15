using System;
using System.Collections.Generic;

namespace JetHorizon.Simulation
{
    public enum EncounterKind
    {
        MonumentalBroadWeave,
        CrystallineCanyon,
        LightningCargoStorm,
        PrismaticSineCorridor
    }

    public enum CargoRouteTier
    {
        None,
        Safe,
        Risky,
        Deep
    }

    public readonly struct EncounterOpening
    {
        public float Distance { get; }
        public float CenterX { get; }
        public float HalfWidth { get; }
        public CargoRouteTier CargoTier { get; }
        public PowerupType Powerup { get; }
        public bool DenseLaserFormation { get; }

        public EncounterOpening(
            float distance,
            float centerX,
            float halfWidth,
            CargoRouteTier cargoTier = CargoRouteTier.None,
            PowerupType powerup = PowerupType.None,
            bool denseLaserFormation = false)
        {
            if (distance < 0f) throw new ArgumentOutOfRangeException(nameof(distance));
            if (halfWidth <= 0f) throw new ArgumentOutOfRangeException(nameof(halfWidth));
            Distance = distance;
            CenterX = centerX;
            HalfWidth = halfWidth;
            CargoTier = cargoTier;
            Powerup = powerup;
            DenseLaserFormation = denseLaserFormation;
        }
    }

    public readonly struct EncounterCapabilityContract
    {
        public float MinimumEntrySpeed { get; }
        public float MaximumEntrySpeed { get; }
        public float MinimumTelegraphSeconds { get; }
        public float SafetyMargin { get; }
        public int MinimumHeat { get; }
        public int MaximumHeat { get; }

        public EncounterCapabilityContract(
            float minimumEntrySpeed,
            float maximumEntrySpeed,
            float minimumTelegraphSeconds,
            float safetyMargin,
            int minimumHeat,
            int maximumHeat)
        {
            if (minimumEntrySpeed <= 0f || maximumEntrySpeed < minimumEntrySpeed)
                throw new ArgumentOutOfRangeException(nameof(maximumEntrySpeed));
            if (minimumTelegraphSeconds <= 0f) throw new ArgumentOutOfRangeException(nameof(minimumTelegraphSeconds));
            if (safetyMargin < 0f) throw new ArgumentOutOfRangeException(nameof(safetyMargin));
            if (minimumHeat < 0 || maximumHeat < minimumHeat) throw new ArgumentOutOfRangeException(nameof(maximumHeat));
            MinimumEntrySpeed = minimumEntrySpeed;
            MaximumEntrySpeed = maximumEntrySpeed;
            MinimumTelegraphSeconds = minimumTelegraphSeconds;
            SafetyMargin = safetyMargin;
            MinimumHeat = minimumHeat;
            MaximumHeat = maximumHeat;
        }
    }

    public sealed class EncounterPlan
    {
        readonly EncounterOpening[] _openings;

        public string Id { get; }
        public EncounterKind Kind { get; }
        public float Length { get; }
        public float ApproachModifier { get; }
        public EncounterCapabilityContract Contract { get; }
        public int OpeningCount => _openings.Length;

        public EncounterPlan(
            string id,
            EncounterKind kind,
            float length,
            float approachModifier,
            EncounterCapabilityContract contract,
            EncounterOpening[] openings)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("Encounter id is required.", nameof(id));
            if (length <= 0f) throw new ArgumentOutOfRangeException(nameof(length));
            if (approachModifier <= 0f) throw new ArgumentOutOfRangeException(nameof(approachModifier));
            if (openings == null || openings.Length < 2) throw new ArgumentException("An encounter needs at least two openings.", nameof(openings));
            _openings = new EncounterOpening[openings.Length];
            float previous = -1f;
            for (int i = 0; i < openings.Length; i++)
            {
                if (openings[i].Distance <= previous || openings[i].Distance > length)
                    throw new ArgumentException("Encounter openings must be strictly ordered inside the encounter.", nameof(openings));
                _openings[i] = openings[i];
                previous = openings[i].Distance;
            }
            Id = id;
            Kind = kind;
            Length = length;
            ApproachModifier = approachModifier;
            Contract = contract;
        }

        public EncounterOpening GetOpening(int index) => index >= 0 && index < _openings.Length
            ? _openings[index]
            : throw new ArgumentOutOfRangeException(nameof(index));
    }

    public readonly struct EncounterValidationResult
    {
        public bool Reachable { get; }
        public bool RejectsNeutral { get; }
        public bool RejectsConstantLeft { get; }
        public bool RejectsConstantRight { get; }
        public float FeasibilityMargin { get; }
        public bool IsAdmissible => Reachable && RejectsNeutral && RejectsConstantLeft && RejectsConstantRight;

        public EncounterValidationResult(
            bool reachable,
            bool rejectsNeutral,
            bool rejectsConstantLeft,
            bool rejectsConstantRight,
            float feasibilityMargin)
        {
            Reachable = reachable;
            RejectsNeutral = rejectsNeutral;
            RejectsConstantLeft = rejectsConstantLeft;
            RejectsConstantRight = rejectsConstantRight;
            FeasibilityMargin = feasibilityMargin;
        }
    }

    /// <summary>Deterministic reachability and trivial-policy validation using the live lateral movement envelope.</summary>
    public sealed class EncounterCapabilityValidator
    {
        const float IntegrationStep = 1f / 30f;
        const int MaximumStates = 768;

        readonly struct MotionState
        {
            public float X { get; }
            public float Velocity { get; }

            public MotionState(float x, float velocity)
            {
                X = x;
                Velocity = velocity;
            }
        }

        static readonly (int first, int second)[] Maneuvers =
        {
            (-1, -1), (0, 0), (1, 1), (-1, 1), (1, -1),
            (-1, 0), (1, 0), (0, -1), (0, 1)
        };

        public EncounterValidationResult Validate(EncounterPlan plan, ShipCapabilityProfile capability, int heat)
        {
            if (plan == null) throw new ArgumentNullException(nameof(plan));
            bool speedEligible = capability.CruiseSpeed >= plan.Contract.MinimumEntrySpeed
                && capability.CruiseSpeed <= plan.Contract.MaximumEntrySpeed;
            bool heatEligible = heat >= plan.Contract.MinimumHeat && heat <= plan.Contract.MaximumHeat;
            float margin = -1f;
            bool reachable = speedEligible && heatEligible && IsReachable(plan, capability, out margin);
            return new EncounterValidationResult(
                reachable,
                DefeatsPolicy(plan, capability, 0),
                DefeatsPolicy(plan, capability, -1),
                DefeatsPolicy(plan, capability, 1),
                reachable ? margin : -1f);
        }

        bool IsReachable(EncounterPlan plan, ShipCapabilityProfile capability, out float minimumMargin)
        {
            var states = new List<MotionState>(MaximumStates) { new MotionState(0f, 0f) };
            float previousDistance = 0f;
            minimumMargin = float.MaxValue;

            for (int openingIndex = 0; openingIndex < plan.OpeningCount; openingIndex++)
            {
                EncounterOpening opening = plan.GetOpening(openingIndex);
                float seconds = (opening.Distance - previousDistance) / capability.CruiseSpeed;
                if (seconds < plan.Contract.MinimumTelegraphSeconds * 0.35f)
                {
                    minimumMargin = -1f;
                    return false;
                }

                var next = new List<MotionState>(MaximumStates);
                var occupied = new HashSet<long>();
                float allowed = opening.HalfWidth - capability.CollisionHalfWidth - plan.Contract.SafetyMargin;
                if (allowed <= 0f) { minimumMargin = -1f; return false; }
                float bestOpeningMargin = -1f;

                for (int stateIndex = 0; stateIndex < states.Count && next.Count < MaximumStates; stateIndex++)
                {
                    for (int maneuverIndex = 0; maneuverIndex < Maneuvers.Length && next.Count < MaximumStates; maneuverIndex++)
                    {
                        var maneuver = Maneuvers[maneuverIndex];
                        MotionState candidate = Integrate(states[stateIndex], capability, seconds, maneuver.first, maneuver.second);
                        float margin = allowed - Math.Abs(candidate.X - opening.CenterX);
                        if (margin < 0f) continue;
                        long key = QuantizedKey(candidate);
                        if (!occupied.Add(key)) continue;
                        next.Add(candidate);
                        bestOpeningMargin = Math.Max(bestOpeningMargin, margin);
                    }
                }

                if (next.Count == 0) { minimumMargin = -1f; return false; }
                minimumMargin = Math.Min(minimumMargin, bestOpeningMargin);
                states = next;
                previousDistance = opening.Distance;
            }
            return true;
        }

        bool DefeatsPolicy(EncounterPlan plan, ShipCapabilityProfile capability, int input)
        {
            MotionState state = new MotionState(0f, 0f);
            float previousDistance = 0f;
            for (int i = 0; i < plan.OpeningCount; i++)
            {
                EncounterOpening opening = plan.GetOpening(i);
                float seconds = (opening.Distance - previousDistance) / capability.CruiseSpeed;
                state = Integrate(state, capability, seconds, input, input);
                float allowed = opening.HalfWidth - capability.CollisionHalfWidth - plan.Contract.SafetyMargin;
                if (Math.Abs(state.X - opening.CenterX) > allowed) return true;
                previousDistance = opening.Distance;
            }
            return false;
        }

        static MotionState Integrate(MotionState start, ShipCapabilityProfile capability, float seconds, int first, int second)
        {
            int steps = Math.Max(1, (int)Math.Ceiling(seconds / IntegrationStep));
            float dt = seconds / steps;
            float x = start.X;
            float velocity = start.Velocity;
            for (int i = 0; i < steps; i++)
            {
                int input = i < steps / 2 ? first : second;
                if (input == 0)
                {
                    float settle = Math.Max(0f, 1f - capability.NeutralSettleRate * dt);
                    velocity *= settle;
                }
                else
                {
                    float acceleration = capability.LateralAcceleration;
                    if (velocity * input < 0f) acceleration *= capability.CounterSteerMultiplier;
                    velocity += input * acceleration * dt;
                    velocity = Math.Max(-capability.MaximumLateralVelocity, Math.Min(capability.MaximumLateralVelocity, velocity));
                }
                x += velocity * dt;
            }
            return new MotionState(x, velocity);
        }

        static long QuantizedKey(MotionState state)
        {
            long x = (long)Math.Round(state.X * 0.5f);
            long velocity = (long)Math.Round(state.Velocity * 0.5f);
            return (x << 32) ^ (velocity & 0xffffffffL);
        }
    }

    public sealed class EncounterPlanSelector
    {
        readonly EncounterCapabilityValidator _validator;

        public EncounterPlanSelector(EncounterCapabilityValidator validator)
        {
            _validator = validator ?? throw new ArgumentNullException(nameof(validator));
        }

        public EncounterPlan Select(EncounterPlan[] plans, ShipCapabilityProfile capability, int heat, int preferredIndex)
        {
            if (plans == null || plans.Length == 0) throw new ArgumentException("At least one plan is required.", nameof(plans));
            for (int offset = 0; offset < plans.Length; offset++)
            {
                EncounterPlan candidate = plans[(Math.Abs(preferredIndex) + offset) % plans.Length];
                if (_validator.Validate(candidate, capability, heat).IsAdmissible) return candidate;
            }
            throw new InvalidOperationException("No encounter plan is admissible for the active ship capability.");
        }
    }

    /// <summary>
    /// Enforces the authored opening against final collision geometry. A plan is not
    /// considered safe if a derived wall, cone, or lightning volume intrudes into
    /// the same ship-center corridor used by capability validation.
    /// </summary>
    public static class EncounterGeometryValidator
    {
        public static bool PreservesOpening(
            HazardSpawn hazard,
            float openingCenter,
            float openingHalfWidth,
            float shipHalfWidth,
            float safetyMargin)
        {
            if (openingHalfWidth <= shipHalfWidth + safetyMargin) return false;
            float protectedHalfWidth = openingHalfWidth - shipHalfWidth - safetyMargin;
            float hazardHalfWidth = ProjectedHalfWidth(hazard) + shipHalfWidth;
            float separation = Math.Abs(hazard.X - openingCenter);
            return separation >= protectedHalfWidth + hazardHalfWidth;
        }

        static float ProjectedHalfWidth(HazardSpawn hazard)
        {
            if (hazard.Kind != HazardKind.Wall) return Math.Max(0f, hazard.CollisionHalfWidth);
            float cosine = Math.Abs((float)Math.Cos(hazard.RotationYRadians));
            float sine = Math.Abs((float)Math.Sin(hazard.RotationYRadians));
            return cosine * hazard.CollisionHalfWidth + sine * hazard.CollisionHalfDepth;
        }
    }

    public static class EncounterPlanCatalog
    {
        static readonly EncounterCapabilityContract ProofContract =
            new EncounterCapabilityContract(24f, 130f, 0.55f, 0.65f, 0, 5);

        public static EncounterPlan[] CreateProofSequence(float spacingScale = 1f)
        {
            if (float.IsNaN(spacingScale) || float.IsInfinity(spacingScale) || spacingScale <= 0f)
                throw new ArgumentOutOfRangeException(nameof(spacingScale));
            return new[]
            {
                BroadWeave(spacingScale),
                CrystallineCanyon(spacingScale),
                LightningStorm(spacingScale),
                PrismaticCorridor(spacingScale)
            };
        }

        static EncounterPlan BroadWeave(float scale)
        {
            return new EncounterPlan(
                "proof.monumental-weave",
                EncounterKind.MonumentalBroadWeave,
                Scale(720f, scale),
                0.92f,
                ProofContract,
                new[]
                {
                    new EncounterOpening(Scale(45f, scale),   0f, 13f),
                    new EncounterOpening(Scale(145f, scale),-10f, 11f, CargoRouteTier.Safe),
                    new EncounterOpening(Scale(220f, scale), 13f, 10f),
                    new EncounterOpening(Scale(295f, scale),-15f, 10f, CargoRouteTier.Risky),
                    new EncounterOpening(Scale(370f, scale),  7f, 11f, powerup: PowerupType.Laser),
                    new EncounterOpening(Scale(445f, scale), 17f,  9f, denseLaserFormation: true),
                    new EncounterOpening(Scale(520f, scale),-11f,  9f, denseLaserFormation: true),
                    new EncounterOpening(Scale(595f, scale), 14f, 10f),
                    new EncounterOpening(Scale(665f, scale), -7f, 11f, CargoRouteTier.Deep),
                    new EncounterOpening(Scale(720f, scale),  0f, 13f)
                });
        }

        static EncounterPlan LightningStorm(float scale)
        {
            return new EncounterPlan(
                "proof.lightning-cargo-storm",
                EncounterKind.LightningCargoStorm,
                Scale(720f, scale),
                1f,
                ProofContract,
                new[]
                {
                    new EncounterOpening(Scale( 90f, scale),-10f, 11f, CargoRouteTier.Safe),
                    new EncounterOpening(Scale(180f, scale),  0f, 11f, CargoRouteTier.Safe),
                    new EncounterOpening(Scale(270f, scale), 12f, 11f, CargoRouteTier.Risky),
                    new EncounterOpening(Scale(360f, scale), -4f, 11f, CargoRouteTier.Safe),
                    new EncounterOpening(Scale(450f, scale),-14f, 11f, CargoRouteTier.Risky),
                    new EncounterOpening(Scale(540f, scale),  2f, 11f, CargoRouteTier.Safe),
                    new EncounterOpening(Scale(630f, scale), 14f, 11f, CargoRouteTier.Deep),
                    new EncounterOpening(Scale(720f, scale), -4f, 13f)
                });
        }

        static EncounterPlan CrystallineCanyon(float scale)
        {
            const int count = 46;
            const float rowSpacing = 17f;
            const float sourceAmplitude = 120f;
            const float sourceIntensity = .30f;
            const float sourcePeriod = 330f;
            const float sourceRampDistance = 350f;
            var openings = new EncounterOpening[count];
            for (int i = 0; i < count; i++)
            {
                // Exact exported Three.js canyon sine: amplitude 120 at .30
                // intensity, 330 world-unit period, ramped in over the first 350u.
                float sourceDistance = rowSpacing * (i + 1);
                float ramp = Math.Max(0f, Math.Min(1f, sourceDistance / sourceRampDistance));
                float center = sourceAmplitude * sourceIntensity * ramp
                    * (float)Math.Sin(sourceDistance / sourcePeriod * Math.PI * 2.0);
                float edge = Math.Min(i / 7f, (count - 1 - i) / 7f);
                float edgeBlend = Math.Max(0f, Math.Min(1f, edge));
                center *= edgeBlend;
                // A 14u playable half-opening is the narrowest validated width
                // that retains the complete source wave for the starter ship.
                float halfWidth = 24f + (14f - 24f) * edgeBlend
                    + (float)Math.Sin(i * .31f + .4f) * 1.1f * edgeBlend;
                CargoRouteTier cargo = i == 13 ? CargoRouteTier.Safe
                    : i == 28 ? CargoRouteTier.Risky
                    : i == 39 ? CargoRouteTier.Deep
                    : CargoRouteTier.None;
                openings[i] = new EncounterOpening(
                    Scale(rowSpacing * (i + 1), scale),
                    center,
                    halfWidth,
                    cargo);
            }
            return new EncounterPlan(
                "proof.crystalline-canyon",
                EncounterKind.CrystallineCanyon,
                Scale(rowSpacing * (count + 1), scale),
                1f,
                ProofContract,
                openings);
        }

        static EncounterPlan PrismaticCorridor(float scale)
        {
            const int count = 55;
            var openings = new EncounterOpening[count];
            for (int i = 0; i < count; i++)
            {
                float edge = Math.Min(i / 8f, (count - 1 - i) / 8f);
                float halfWidth = 9f + Math.Max(0f, 1f - edge) * 6f;
                float center = (float)Math.Sin(i * 0.27f) * 17f;
                CargoRouteTier cargo = i == 15 ? CargoRouteTier.Safe
                    : i == 31 ? CargoRouteTier.Risky
                    : i == 45 ? CargoRouteTier.Deep
                    : CargoRouteTier.None;
                openings[i] = new EncounterOpening(Scale(14f * (i + 1), scale), center, halfWidth, cargo);
            }
            return new EncounterPlan(
                "proof.prismatic-sine",
                EncounterKind.PrismaticSineCorridor,
                Scale(770f, scale),
                1f,
                ProofContract,
                openings);
        }

        static float Scale(float distance, float scale) => distance * scale;
    }
}
