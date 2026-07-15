using System;

namespace JetHorizon.Simulation
{
    public enum EncounterCommandType
    {
        MonumentBarrierRow,
        CanyonSlice,
        LightningGateRow,
        PrismaticSlice,
        Cargo,
        Powerup,
        LaserFormation
    }

    public readonly struct EncounterCommand
    {
        public EncounterCommandType Type { get; }
        public EncounterKind EncounterKind { get; }
        public int RowIndex { get; }
        public float X { get; }
        public float HalfWidth { get; }
        public float Z { get; }
        public RunCargoKind CargoKind { get; }
        public PowerupType Powerup { get; }

        public EncounterCommand(
            EncounterCommandType type,
            EncounterKind encounterKind,
            int rowIndex,
            float x,
            float halfWidth,
            float z,
            RunCargoKind cargoKind = RunCargoKind.Salvage,
            PowerupType powerup = PowerupType.None)
        {
            Type = type;
            EncounterKind = encounterKind;
            RowIndex = rowIndex;
            X = x;
            HalfWidth = halfWidth;
            Z = z;
            CargoKind = cargoKind;
            Powerup = powerup;
        }
    }

    public sealed class EncounterCommandBuffer
    {
        readonly EncounterCommand[] _items;

        public int Count { get; private set; }
        public EncounterCommand this[int index] => index >= 0 && index < Count
            ? _items[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public EncounterCommandBuffer(int capacity)
        {
            if (capacity <= 0) throw new ArgumentOutOfRangeException(nameof(capacity));
            _items = new EncounterCommand[capacity];
        }

        public void Clear() => Count = 0;

        internal void Add(EncounterCommand command)
        {
            if (Count >= _items.Length) throw new InvalidOperationException("Encounter command capacity exceeded.");
            _items[Count++] = command;
        }
    }

    public enum ProofEncounterTickResult
    {
        None,
        Extracted,
        ContinuedDeeper
    }

    public readonly struct EncounterRuntimeSnapshot
    {
        public string PlanId { get; }
        public EncounterKind Kind { get; }
        public int PlanIndex { get; }
        public int Cycle { get; }
        public float Progress01 { get; }
        public float ValidationMargin { get; }
        public bool ExtractionGateVisible { get; }
        public float ExtractionGateX { get; }
        public float ExtractionGateHalfWidth { get; }
        public float ExtractionGateZ { get; }
        public float ExtractionGateDistance { get; }

        internal EncounterRuntimeSnapshot(
            string planId,
            EncounterKind kind,
            int planIndex,
            int cycle,
            float progress01,
            float validationMargin,
            bool extractionGateVisible,
            float extractionGateX,
            float extractionGateHalfWidth,
            float extractionGateZ,
            float extractionGateDistance)
        {
            PlanId = planId ?? string.Empty;
            Kind = kind;
            PlanIndex = planIndex;
            Cycle = cycle;
            Progress01 = progress01;
            ValidationMargin = validationMargin;
            ExtractionGateVisible = extractionGateVisible;
            ExtractionGateX = extractionGateX;
            ExtractionGateHalfWidth = extractionGateHalfWidth;
            ExtractionGateZ = extractionGateZ;
            ExtractionGateDistance = extractionGateDistance;
        }
    }

    /// <summary>
    /// Pure run-beat runtime. It streams already-validated plan commands and resolves
    /// the spatial extract-or-continue crossing; it owns no rendering or persistence.
    /// </summary>
    public sealed class ProofEncounterRuntime
    {
        const float LaunchSeconds = 0.25f;
        const float RecoverySeconds = 0.95f;
        const float GateApproachSeconds = 1.5f;
        const float StructureTelegraphSeconds = 4.2f;
        const float LightningTelegraphSeconds = 1.65f;

        readonly EncounterPlan[] _plans;
        readonly ShipCapabilityProfile _capability;
        readonly float[] _validationMargins;
        readonly EncounterCapabilityValidator _validator;
        readonly float _launchDistance;
        readonly float _recoveryDistance;
        readonly float _gateApproachDistance;

        int _planIndex;
        int _nextOpeningIndex;
        int _cycle;
        float _planStartDistance;
        bool _gateActive;
        bool _gateResolved;
        float _gateDistance;
        float _gateX;
        float _gateHalfWidth;
        int _validatedPlanIndex;
        int _validatedHeat;
        float _validatedPaceBeforeEncounter;

        public EncounterPlan CurrentPlan => _plans[_planIndex];
        public float CurrentApproachModifier => _gateActive ? 0.90f : CurrentPlan.ApproachModifier;
        public EncounterRuntimeSnapshot Snapshot { get; private set; }

        public ProofEncounterRuntime(EncounterPlan[] plans, ShipCapabilityProfile capability)
        {
            if (plans == null || plans.Length < 3)
                throw new ArgumentException("The proof run requires at least three composed encounters.", nameof(plans));
            _plans = new EncounterPlan[plans.Length];
            _validationMargins = new float[plans.Length];
            _capability = capability;
            _validator = new EncounterCapabilityValidator();
            _launchDistance = capability.CruiseSpeed * LaunchSeconds;
            _recoveryDistance = capability.CruiseSpeed * RecoverySeconds;
            _gateApproachDistance = capability.CruiseSpeed * GateApproachSeconds;
            for (int i = 0; i < plans.Length; i++)
            {
                _plans[i] = plans[i] ?? throw new ArgumentException("Encounter plans cannot contain null entries.", nameof(plans));
                EncounterValidationResult validation = _validator.Validate(
                    plans[i],
                    capability.AtCruiseSpeed(capability.CruiseSpeed * plans[i].ApproachModifier),
                    0);
                if (!validation.IsAdmissible)
                    throw new InvalidOperationException("Proof encounter is not admissible: " + plans[i].Id);
                _validationMargins[i] = validation.FeasibilityMargin;
            }
            Reset();
        }

        public void Reset()
        {
            _planIndex = 0;
            _nextOpeningIndex = 0;
            _cycle = 0;
            _planStartDistance = _launchDistance;
            _gateActive = false;
            _gateResolved = false;
            _gateDistance = 0f;
            _gateX = -16f;
            _gateHalfWidth = 10f;
            _validatedPlanIndex = -1;
            _validatedHeat = -1;
            _validatedPaceBeforeEncounter = -1f;
            RefreshSnapshot(0f, 3.9f);
        }

        /// <summary>
        /// Development-preview seam. Selects an authored encounter without moving the
        /// run clock; the normal command stream still owns everything that appears.
        /// </summary>
        public bool JumpTo(EncounterKind kind, float runDistance, float shipZ, float previewLeadDistance = 25f)
        {
            int targetIndex = -1;
            for (int i = 0; i < _plans.Length; i++)
            {
                if (_plans[i].Kind != kind) continue;
                targetIndex = i;
                break;
            }
            if (targetIndex < 0) return false;

            _planIndex = targetIndex;
            _nextOpeningIndex = 0;
            _planStartDistance = runDistance + Math.Max(0f, previewLeadDistance);
            _gateActive = false;
            _gateResolved = false;
            _gateDistance = 0f;
            _gateX = -16f;
            _gateHalfWidth = 10f;
            _validatedPlanIndex = -1;
            _validatedHeat = -1;
            _validatedPaceBeforeEncounter = -1f;
            RefreshSnapshot(runDistance, shipZ);
            return true;
        }

        public ProofEncounterTickResult Tick(
            float runDistance,
            float shipX,
            int heat,
            float paceBeforeEncounter,
            float shipZ,
            EncounterCommandBuffer commands)
        {
            if (commands == null) throw new ArgumentNullException(nameof(commands));
            commands.Clear();

            if (_gateActive)
            {
                if (!_gateResolved && runDistance >= _gateDistance)
                {
                    _gateResolved = true;
                    float allowed = Math.Max(0f, _gateHalfWidth - _capability.CollisionHalfWidth);
                    if (Math.Abs(shipX - _gateX) <= allowed)
                    {
                        RefreshSnapshot(runDistance, shipZ);
                        return ProofEncounterTickResult.Extracted;
                    }

                    _cycle++;
                    _planIndex = 0;
                    _nextOpeningIndex = 0;
                    _planStartDistance = _gateDistance + _recoveryDistance;
                    _gateActive = false;
                    _gateResolved = false;
                    RefreshSnapshot(runDistance, shipZ);
                    return ProofEncounterTickResult.ContinuedDeeper;
                }
                RefreshSnapshot(runDistance, shipZ);
                return ProofEncounterTickResult.None;
            }

            bool advanced;
            do
            {
                advanced = false;
                EnsureCurrentPlanIsAdmissible(heat, paceBeforeEncounter);
                StreamOpenings(runDistance, heat, paceBeforeEncounter, shipZ, commands);
                float planEnd = _planStartDistance + CurrentPlan.Length;
                if (runDistance < planEnd) continue;

                if (_planIndex + 1 < _plans.Length)
                {
                    _planStartDistance = planEnd + _recoveryDistance;
                    _planIndex++;
                    _nextOpeningIndex = 0;
                    advanced = true;
                }
                else
                {
                    _gateActive = true;
                    _gateResolved = false;
                    _gateDistance = planEnd + _gateApproachDistance;
                    _gateX = (_cycle & 1) == 0 ? -16f : 16f;
                    _gateHalfWidth = 10f;
                }
            } while (advanced && !_gateActive);

            RefreshSnapshot(runDistance, shipZ);
            return ProofEncounterTickResult.None;
        }

        void EnsureCurrentPlanIsAdmissible(int heat, float paceBeforeEncounter)
        {
            if (_validatedPlanIndex == _planIndex
                && _validatedHeat == heat
                && Math.Abs(_validatedPaceBeforeEncounter - paceBeforeEncounter) < 0.001f)
                return;

            EncounterPlan plan = CurrentPlan;
            float entrySpeed = paceBeforeEncounter * plan.ApproachModifier;
            EncounterValidationResult validation = _validator.Validate(
                plan,
                _capability.AtCruiseSpeed(entrySpeed),
                heat);
            if (!validation.IsAdmissible)
                throw new InvalidOperationException(
                    "Encounter is not admissible for the active ship capability: " + plan.Id);
            _validationMargins[_planIndex] = validation.FeasibilityMargin;
            _validatedPlanIndex = _planIndex;
            _validatedHeat = heat;
            _validatedPaceBeforeEncounter = paceBeforeEncounter;
        }

        void StreamOpenings(
            float runDistance,
            int heat,
            float paceBeforeEncounter,
            float shipZ,
            EncounterCommandBuffer commands)
        {
            EncounterPlan plan = CurrentPlan;
            float telegraphSeconds = plan.Kind == EncounterKind.LightningMovingGate
                ? LightningTelegraphSeconds
                : StructureTelegraphSeconds;
            float lead = Math.Max(plan.Contract.MinimumTelegraphSeconds, telegraphSeconds)
                * Math.Max(1f, paceBeforeEncounter);

            while (_nextOpeningIndex < plan.OpeningCount)
            {
                EncounterOpening opening = plan.GetOpening(_nextOpeningIndex);
                float globalDistance = _planStartDistance + opening.Distance;
                float remaining = globalDistance - runDistance;
                if (remaining > lead) break;
                float z = shipZ - remaining;
                EmitOpening(plan, opening, _nextOpeningIndex, z, heat, commands);
                _nextOpeningIndex++;
            }
        }

        static void EmitOpening(
            EncounterPlan plan,
            EncounterOpening opening,
            int rowIndex,
            float z,
            int heat,
            EncounterCommandBuffer commands)
        {
            if (!opening.DenseLaserFormation)
            {
                EncounterCommandType rowType = plan.Kind == EncounterKind.MonumentalBroadWeave
                    ? EncounterCommandType.MonumentBarrierRow
                    : plan.Kind == EncounterKind.CrystallineCanyon
                        ? EncounterCommandType.CanyonSlice
                        : plan.Kind == EncounterKind.LightningMovingGate
                            ? EncounterCommandType.LightningGateRow
                            : EncounterCommandType.PrismaticSlice;
                commands.Add(new EncounterCommand(rowType, plan.Kind, rowIndex, opening.CenterX, opening.HalfWidth, z));
            }

            if (opening.CargoTier != CargoRouteTier.None)
            {
                float sign = (rowIndex & 1) == 0 ? 1f : -1f;
                float fraction = opening.CargoTier == CargoRouteTier.Safe ? 0.15f
                    : opening.CargoTier == CargoRouteTier.Risky ? 0.62f
                    : 0.78f;
                float cargoX = opening.CenterX + sign * opening.HalfWidth * fraction;
                RunCargoKind cargo = opening.CargoTier == CargoRouteTier.Safe
                    ? RunCargoKind.Salvage
                    : opening.CargoTier == CargoRouteTier.Risky
                        ? (heat >= 1 ? RunCargoKind.Alloy : RunCargoKind.Salvage)
                        : (heat >= 2 ? RunCargoKind.Prism : RunCargoKind.Alloy);
                commands.Add(new EncounterCommand(
                    EncounterCommandType.Cargo,
                    plan.Kind,
                    rowIndex,
                    cargoX,
                    opening.HalfWidth,
                    z - 10f,
                    cargo));
            }

            if (opening.Powerup != PowerupType.None)
            {
                commands.Add(new EncounterCommand(
                    EncounterCommandType.Powerup,
                    plan.Kind,
                    rowIndex,
                    opening.CenterX,
                    opening.HalfWidth,
                    z - 18f,
                    powerup: opening.Powerup));
            }

            if (opening.DenseLaserFormation)
            {
                commands.Add(new EncounterCommand(
                    EncounterCommandType.LaserFormation,
                    plan.Kind,
                    rowIndex,
                    opening.CenterX,
                    opening.HalfWidth,
                    z));
            }
        }

        void RefreshSnapshot(float runDistance, float shipZ)
        {
            EncounterPlan plan = CurrentPlan;
            float progress = Math.Max(0f, Math.Min(1f, (runDistance - _planStartDistance) / plan.Length));
            float gateZ = _gateActive ? shipZ - (_gateDistance - runDistance) : 0f;
            Snapshot = new EncounterRuntimeSnapshot(
                plan.Id,
                plan.Kind,
                _planIndex,
                _cycle,
                progress,
                _validationMargins[_planIndex],
                _gateActive && gateZ >= -240f && gateZ <= 30f,
                _gateX,
                _gateHalfWidth,
                gateZ,
                _gateActive ? _gateDistance : NextGateDistance());
        }

        float NextGateDistance()
        {
            float distance = _planStartDistance - SumPriorPlanLengths(_planIndex);
            for (int i = 0; i < _plans.Length; i++)
                distance += _plans[i].Length + (i + 1 < _plans.Length ? _recoveryDistance : 0f);
            return distance + _gateApproachDistance;
        }

        float SumPriorPlanLengths(int exclusiveEnd)
        {
            float total = 0f;
            for (int i = 0; i < exclusiveEnd; i++) total += _plans[i].Length + _recoveryDistance;
            return total;
        }
    }
}
