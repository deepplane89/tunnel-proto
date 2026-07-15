using System;
using System.Collections.Generic;

namespace JetHorizon.Meta
{
    public enum CargoKind { Salvage, Alloy, Prism }
    public enum ShipSubsystem { PrimaryThruster, Stabilizers, Hull, ShieldGenerator, CargoBay }
    public enum RestorationBranch { None, Shield, Cargo }
    public enum GarageItemKind { Thruster, AddOn, Powerup, HandlingModel, Facility }
    public enum RepairJobStatus { Queued, Active, Complete }

    public readonly struct CargoManifest
    {
        public int Salvage { get; }
        public int Alloy { get; }
        public int Prism { get; }
        public int TotalUnits => Salvage + Alloy + Prism;

        public CargoManifest(int salvage, int alloy, int prism)
        {
            if (salvage < 0 || alloy < 0 || prism < 0) throw new ArgumentOutOfRangeException(nameof(salvage));
            Salvage = salvage;
            Alloy = alloy;
            Prism = prism;
        }

        public int Get(CargoKind kind) => kind == CargoKind.Salvage ? Salvage : kind == CargoKind.Alloy ? Alloy : Prism;
    }

    [Serializable]
    public sealed class SubsystemState
    {
        public ShipSubsystem Subsystem;
        public int Tier;
        public float Integrity;

        public SubsystemState Copy() => new SubsystemState { Subsystem = Subsystem, Tier = Tier, Integrity = Integrity };
    }

    [Serializable]
    public sealed class RepairJobState
    {
        public long JobId;
        public ShipSubsystem Subsystem;
        public float IntegrityTarget;
        public long StartsAtUnixMilliseconds;
        public long CompletesAtUnixMilliseconds;
        public RepairJobStatus Status;

        public RepairJobState Copy() => (RepairJobState)MemberwiseClone();
    }

    [Serializable]
    public sealed class GarageState
    {
        public int SchemaVersion = 1;
        public int Credits;
        public int Salvage;
        public int Alloy;
        public int Prism;
        public int SuccessfulExtractions;
        public int FailedRuns;
        public int GarageLevel = 1;
        public int RepairBayLevel = 1;
        public int MechanicBotLevel;
        public long NextRepairJobId = 1;
        public RestorationBranch RestorationBranch;
        public bool RestorationChoicePending;
        public string ShipId = "runner";
        public string SelectedThrusterId = "wreck";
        public string SelectedHandlingId = "default";
        public List<string> OwnedItemIds = new List<string>();
        public List<string> EquippedAddOnIds = new List<string>();
        public List<int> PowerupTiers = new List<int> { 1, 1, 1, 1 };
        public List<int> PowerupCharges = new List<int> { 0, 0, 0, 0 };
        public List<SubsystemState> Subsystems = new List<SubsystemState>();
        public List<RepairJobState> RepairJobs = new List<RepairJobState>();

        public static GarageState CreateNew()
        {
            var state = new GarageState();
            state.OwnedItemIds.Add("handling:default");
            state.OwnedItemIds.Add("thruster:wreck");
            state.Subsystems.Add(new SubsystemState { Subsystem = ShipSubsystem.PrimaryThruster, Tier = 1, Integrity = 0.42f });
            state.Subsystems.Add(new SubsystemState { Subsystem = ShipSubsystem.Stabilizers, Tier = 1, Integrity = 0.55f });
            state.Subsystems.Add(new SubsystemState { Subsystem = ShipSubsystem.Hull, Tier = 1, Integrity = 0.35f });
            state.Subsystems.Add(new SubsystemState { Subsystem = ShipSubsystem.ShieldGenerator, Tier = 0, Integrity = 0f });
            state.Subsystems.Add(new SubsystemState { Subsystem = ShipSubsystem.CargoBay, Tier = 1, Integrity = 0.70f });
            return state;
        }

        public GarageState Copy()
        {
            var copy = (GarageState)MemberwiseClone();
            copy.OwnedItemIds = new List<string>(OwnedItemIds);
            copy.EquippedAddOnIds = new List<string>(EquippedAddOnIds);
            copy.PowerupTiers = new List<int>(PowerupTiers);
            copy.PowerupCharges = new List<int>(PowerupCharges);
            copy.Subsystems = new List<SubsystemState>(Subsystems.Count);
            for (int i = 0; i < Subsystems.Count; i++) copy.Subsystems.Add(Subsystems[i].Copy());
            copy.RepairJobs = new List<RepairJobState>(RepairJobs.Count);
            for (int i = 0; i < RepairJobs.Count; i++) copy.RepairJobs.Add(RepairJobs[i].Copy());
            return copy;
        }

        public SubsystemState GetSubsystem(ShipSubsystem subsystem)
        {
            for (int i = 0; i < Subsystems.Count; i++) if (Subsystems[i].Subsystem == subsystem) return Subsystems[i];
            throw new InvalidOperationException("Missing subsystem state: " + subsystem);
        }

        public bool Owns(string itemId) => OwnedItemIds.Contains(itemId);
    }

    public sealed class HandlingModelDefinition
    {
        public string Id { get; }
        public int UnlockExtraction { get; }
        public float Response { get; }
        public float LateralSpeed { get; }
        public float Settle { get; }
        public float Bank { get; }
        public float Horizon { get; }
        public float Juice { get; }
        public float Drift { get; }

        public HandlingModelDefinition(string id, int unlockExtraction, float response, float lateralSpeed,
            float settle, float bank, float horizon, float juice, float drift)
        {
            Id = id;
            UnlockExtraction = unlockExtraction;
            Response = response;
            LateralSpeed = lateralSpeed;
            Settle = settle;
            Bank = bank;
            Horizon = horizon;
            Juice = juice;
            Drift = drift;
        }
    }

    public sealed class GarageItemDefinition
    {
        public string Id { get; }
        public string DisplayName { get; }
        public GarageItemKind Kind { get; }
        public int CreditCost { get; }
        public int SalvageCost { get; }
        public int UnlockExtraction { get; }

        public GarageItemDefinition(string id, string displayName, GarageItemKind kind, int creditCost, int salvageCost, int unlockExtraction)
        {
            Id = id;
            DisplayName = displayName;
            Kind = kind;
            CreditCost = creditCost;
            SalvageCost = salvageCost;
            UnlockExtraction = unlockExtraction;
        }
    }

    public static class GarageCatalog
    {
        public static readonly string[] PowerupIds = { "shield", "laser", "overdrive", "magnet" };
        static readonly HandlingModelDefinition[] HandlingModels =
        {
            new HandlingModelDefinition("default", 0, .50f, .50f, .50f, .50f, .50f, .82f, .30f),
            new HandlingModelDefinition("glide", 4, .50f, .30f, .50f, .20f, .40f, .82f, .55f),
            new HandlingModelDefinition("wipeout", 8, .55f, .90f, .45f, .85f, .60f, .95f, .55f),
            new HandlingModelDefinition("rail", 14, .70f, .45f, .80f, .30f, .10f, .05f, .10f),
            new HandlingModelDefinition("jet", 20, .65f, .46f, .82f, 1.00f, .50f, .80f, .30f)
        };

        static readonly GarageItemDefinition[] Items =
        {
            new GarageItemDefinition("thruster:light", "LIGHT", GarageItemKind.Thruster, 0, 0, 1),
            new GarageItemDefinition("thruster:blink", "BLINK", GarageItemKind.Thruster, 700, 8, 3),
            new GarageItemDefinition("thruster:short", "SHORTY", GarageItemKind.Thruster, 1200, 14, 5),
            new GarageItemDefinition("thruster:pylon", "PYLON", GarageItemKind.Thruster, 2200, 22, 8),
            new GarageItemDefinition("thruster:fat-ion", "FAT ION", GarageItemKind.Thruster, 3600, 32, 11),
            new GarageItemDefinition("thruster:flourish", "FLOURISH", GarageItemKind.Thruster, 5200, 44, 15),
            new GarageItemDefinition("thruster:plasma", "PLASMA", GarageItemKind.Thruster, 7600, 60, 18),
            new GarageItemDefinition("thruster:distort", "DISTORT", GarageItemKind.Thruster, 11000, 80, 22),
            new GarageItemDefinition("addon:fins-01", "Stabilizer I", GarageItemKind.AddOn, 500, 5, 2),
            new GarageItemDefinition("addon:fins-02", "Stabilizer II", GarageItemKind.AddOn, 1800, 18, 5),
            new GarageItemDefinition("addon:rings-001", "Warp Drive", GarageItemKind.AddOn, 6500, 55, 14),
            new GarageItemDefinition("addon:turrets-001", "Laser System I", GarageItemKind.AddOn, 1400, 12, 4),
            new GarageItemDefinition("addon:turrets-002", "Laser System II", GarageItemKind.AddOn, 4200, 34, 10),
            new GarageItemDefinition("addon:turrets-003", "Laser System III", GarageItemKind.AddOn, 9000, 70, 18)
        };

        public static HandlingModelDefinition GetHandling(string id)
        {
            for (int i = 0; i < HandlingModels.Length; i++) if (HandlingModels[i].Id == id) return HandlingModels[i];
            throw new ArgumentOutOfRangeException(nameof(id), id, "Unknown handling model.");
        }

        public static GarageItemDefinition GetItem(string id)
        {
            for (int i = 0; i < Items.Length; i++) if (Items[i].Id == id) return Items[i];
            throw new ArgumentOutOfRangeException(nameof(id), id, "Unknown garage item.");
        }

        public static int PowerupIndex(string id)
        {
            for (int i = 0; i < PowerupIds.Length; i++) if (PowerupIds[i] == id) return i;
            throw new ArgumentOutOfRangeException(nameof(id), id, "Unknown power-up.");
        }
    }

    public readonly struct ShipLaunchProfile
    {
        public float SpeedMultiplier { get; }
        public float AccelerationMultiplier { get; }
        public float LateralSpeedMultiplier { get; }
        public float SettleMultiplier { get; }
        public float BankMultiplier { get; }
        public float HandlingDrift { get; }
        public float HorizonResponse { get; }
        public float PresentationJuice { get; }
        public int CollisionHitCapacity { get; }
        public int CargoCapacity { get; }

        public ShipLaunchProfile(float speedMultiplier, float accelerationMultiplier, float lateralSpeedMultiplier,
            float settleMultiplier, float bankMultiplier, float handlingDrift, float horizonResponse,
            float presentationJuice, int collisionHitCapacity, int cargoCapacity)
        {
            SpeedMultiplier = speedMultiplier;
            AccelerationMultiplier = accelerationMultiplier;
            LateralSpeedMultiplier = lateralSpeedMultiplier;
            SettleMultiplier = settleMultiplier;
            BankMultiplier = bankMultiplier;
            HandlingDrift = handlingDrift;
            HorizonResponse = horizonResponse;
            PresentationJuice = presentationJuice;
            CollisionHitCapacity = collisionHitCapacity;
            CargoCapacity = cargoCapacity;
        }
    }

    public enum GarageFailure { None, Locked, NotOwned, InsufficientResources, AlreadyOwned, InvalidState, NoRepairBay }

    public readonly struct GarageCommandResult
    {
        public bool Succeeded { get; }
        public GarageFailure Failure { get; }
        public GarageState State { get; }

        public GarageCommandResult(bool succeeded, GarageFailure failure, GarageState state)
        {
            Succeeded = succeeded;
            Failure = failure;
            State = state;
        }
    }

    /// <summary>All persistent garage rules live here; application code only loads, invokes, and saves.</summary>
    public static class GarageDomainService
    {
        public static GarageCommandResult Extract(GarageState source, CargoManifest manifest)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            var state = source.Copy();
            int capacity = CreateLaunchProfile(state).CargoCapacity;
            if (manifest.TotalUnits > capacity) return Fail(source, GarageFailure.InvalidState);
            state.SuccessfulExtractions++;
            state.Salvage += manifest.Salvage;
            state.Alloy += manifest.Alloy;
            state.Prism += manifest.Prism;
            state.Credits += manifest.Salvage * 25 + manifest.Alloy * 70 + manifest.Prism * 180;
            ApplyRestorationMilestone(state);
            return Success(state);
        }

        public static GarageCommandResult LoseRunCargoAndDamage(GarageState source, float severity)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            var state = source.Copy();
            state.FailedRuns++;
            float damage = Math.Max(.08f, Math.Min(.55f, severity));
            Damage(state.GetSubsystem(ShipSubsystem.Hull), damage);
            Damage(state.GetSubsystem(ShipSubsystem.PrimaryThruster), damage * .55f);
            Damage(state.GetSubsystem(ShipSubsystem.Stabilizers), damage * .35f);
            return Success(state);
        }

        public static GarageCommandResult ChooseRestoration(GarageState source, RestorationBranch branch)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            if (!source.RestorationChoicePending || branch == RestorationBranch.None) return Fail(source, GarageFailure.InvalidState);
            var state = source.Copy();
            state.RestorationBranch = branch;
            state.RestorationChoicePending = false;
            ShipSubsystem selected = branch == RestorationBranch.Shield ? ShipSubsystem.ShieldGenerator : ShipSubsystem.CargoBay;
            SubsystemState subsystem = state.GetSubsystem(selected);
            subsystem.Tier = Math.Max(1, subsystem.Tier);
            subsystem.Integrity = 1f;
            return Success(state);
        }

        public static GarageCommandResult Purchase(GarageState source, string itemId)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            if (source.Owns(itemId)) return Fail(source, GarageFailure.AlreadyOwned);
            GarageItemDefinition item = GarageCatalog.GetItem(itemId);
            if (source.SuccessfulExtractions < item.UnlockExtraction) return Fail(source, GarageFailure.Locked);
            if (source.Credits < item.CreditCost || source.Salvage < item.SalvageCost)
                return Fail(source, GarageFailure.InsufficientResources);
            var state = source.Copy();
            state.Credits -= item.CreditCost;
            state.Salvage -= item.SalvageCost;
            state.OwnedItemIds.Add(item.Id);
            return Success(state);
        }

        public static GarageCommandResult EquipThruster(GarageState source, string itemId)
        {
            if (!itemId.StartsWith("thruster:", StringComparison.Ordinal) || !source.Owns(itemId))
                return Fail(source, GarageFailure.NotOwned);
            var state = source.Copy();
            state.SelectedThrusterId = itemId.Substring("thruster:".Length);
            return Success(state);
        }

        public static GarageCommandResult EquipHandling(GarageState source, string handlingId)
        {
            HandlingModelDefinition handling = GarageCatalog.GetHandling(handlingId);
            if (source.SuccessfulExtractions < handling.UnlockExtraction) return Fail(source, GarageFailure.Locked);
            var state = source.Copy();
            state.SelectedHandlingId = handlingId;
            string ownershipId = "handling:" + handlingId;
            if (!state.OwnedItemIds.Contains(ownershipId)) state.OwnedItemIds.Add(ownershipId);
            return Success(state);
        }

        public static GarageCommandResult SetAddOnEquipped(GarageState source, string itemId, bool equipped)
        {
            if (!itemId.StartsWith("addon:", StringComparison.Ordinal) || !source.Owns(itemId))
                return Fail(source, GarageFailure.NotOwned);
            var state = source.Copy();
            state.EquippedAddOnIds.Remove(itemId);
            if (equipped) state.EquippedAddOnIds.Add(itemId);
            return Success(state);
        }

        public static GarageCommandResult BuyPowerupCharge(GarageState source, string powerupId)
        {
            int index = GarageCatalog.PowerupIndex(powerupId);
            int tier = source.PowerupTiers[index];
            int creditCost = 180 + tier * 120;
            if (source.Credits < creditCost) return Fail(source, GarageFailure.InsufficientResources);
            var state = source.Copy();
            state.Credits -= creditCost;
            state.PowerupCharges[index]++;
            return Success(state);
        }

        public static GarageCommandResult UpgradePowerup(GarageState source, string powerupId)
        {
            int index = GarageCatalog.PowerupIndex(powerupId);
            int tier = source.PowerupTiers[index];
            if (tier >= 5) return Fail(source, GarageFailure.InvalidState);
            int creditCost = 500 * tier * tier;
            int prismCost = Math.Max(0, tier - 2);
            if (source.Credits < creditCost || source.Prism < prismCost)
                return Fail(source, GarageFailure.InsufficientResources);
            var state = source.Copy();
            state.Credits -= creditCost;
            state.Prism -= prismCost;
            state.PowerupTiers[index]++;
            return Success(state);
        }

        public static GarageCommandResult UpgradeRepairBay(GarageState source)
        {
            if (source.RepairBayLevel >= 3) return Fail(source, GarageFailure.InvalidState);
            int next = source.RepairBayLevel + 1;
            int credits = 2500 * next;
            int alloy = 8 * next;
            if (source.Credits < credits || source.Alloy < alloy)
                return Fail(source, GarageFailure.InsufficientResources);
            var state = source.Copy();
            state.Credits -= credits;
            state.Alloy -= alloy;
            state.RepairBayLevel = next;
            return Success(state);
        }

        public static GarageCommandResult UpgradeMechanicBot(GarageState source)
        {
            if (source.MechanicBotLevel >= 5) return Fail(source, GarageFailure.InvalidState);
            int next = source.MechanicBotLevel + 1;
            int credits = 1800 * next;
            int salvage = 14 * next;
            if (source.Credits < credits || source.Salvage < salvage)
                return Fail(source, GarageFailure.InsufficientResources);
            var state = source.Copy();
            state.Credits -= credits;
            state.Salvage -= salvage;
            state.MechanicBotLevel = next;
            return Success(state);
        }

        public static GarageCommandResult QueueRepair(GarageState source, ShipSubsystem subsystem, long nowUnixMilliseconds)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            if (source.GetSubsystem(subsystem).Integrity >= .999f) return Fail(source, GarageFailure.InvalidState);
            var state = source.Copy();
            int active = 0;
            for (int i = 0; i < state.RepairJobs.Count; i++)
                if (state.RepairJobs[i].Status != RepairJobStatus.Complete) active++;
            if (active >= state.RepairBayLevel) return Fail(source, GarageFailure.NoRepairBay);
            SubsystemState target = state.GetSubsystem(subsystem);
            int repairCost = state.SuccessfulExtractions < 3
                ? 0
                : Math.Max(1, (int)Math.Ceiling((1f - target.Integrity) * 12f * target.Tier));
            if (state.Salvage < repairCost) return Fail(source, GarageFailure.InsufficientResources);
            state.Salvage -= repairCost;
            long duration = RepairDurationMilliseconds(state, target);
            state.RepairJobs.Add(new RepairJobState
            {
                JobId = state.NextRepairJobId++,
                Subsystem = subsystem,
                IntegrityTarget = 1f,
                StartsAtUnixMilliseconds = nowUnixMilliseconds,
                CompletesAtUnixMilliseconds = nowUnixMilliseconds + duration,
                Status = RepairJobStatus.Active
            });
            return Success(state);
        }

        public static GarageCommandResult CompleteRepairs(GarageState source, long nowUnixMilliseconds)
        {
            var state = source.Copy();
            bool changed = false;
            for (int i = 0; i < state.RepairJobs.Count; i++)
            {
                RepairJobState job = state.RepairJobs[i];
                if (job.Status == RepairJobStatus.Complete || job.CompletesAtUnixMilliseconds > nowUnixMilliseconds) continue;
                state.GetSubsystem(job.Subsystem).Integrity = Math.Max(state.GetSubsystem(job.Subsystem).Integrity, job.IntegrityTarget);
                job.Status = RepairJobStatus.Complete;
                changed = true;
            }
            return changed ? Success(state) : Success(source.Copy());
        }

        public static GarageCommandResult AccelerateRepair(GarageState source, long jobId, long nowUnixMilliseconds)
        {
            var state = source.Copy();
            for (int i = 0; i < state.RepairJobs.Count; i++)
            {
                RepairJobState job = state.RepairJobs[i];
                if (job.JobId != jobId || job.Status == RepairJobStatus.Complete) continue;
                job.CompletesAtUnixMilliseconds = nowUnixMilliseconds;
                return CompleteRepairs(state, nowUnixMilliseconds);
            }
            return Fail(source, GarageFailure.InvalidState);
        }

        public static ShipLaunchProfile CreateLaunchProfile(GarageState state)
        {
            HandlingModelDefinition handling = GarageCatalog.GetHandling(state.SelectedHandlingId);
            float thruster = state.GetSubsystem(ShipSubsystem.PrimaryThruster).Integrity;
            float stabilizers = state.GetSubsystem(ShipSubsystem.Stabilizers).Integrity;
            SubsystemState hull = state.GetSubsystem(ShipSubsystem.Hull);
            SubsystemState cargo = state.GetSubsystem(ShipSubsystem.CargoBay);
            float speed = .62f + .38f * thruster;
            float accel = (.65f + .35f * thruster) * (.75f + handling.Response * .5f);
            float lateral = (.72f + .28f * stabilizers) * (.70f + handling.LateralSpeed * .6f);
            float settle = (.60f + .40f * stabilizers) * (.75f + handling.Settle * .5f);
            float bank = .6f + handling.Bank * .8f;
            int hitCapacity = hull.Tier >= 2 && hull.Integrity >= .70f ? 2 : 1;
            int cargoCapacity = 8 + cargo.Tier * 6 + (int)Math.Floor(cargo.Integrity * 6f);
            return new ShipLaunchProfile(speed, accel, lateral, settle, bank, handling.Drift,
                handling.Horizon, handling.Juice, hitCapacity, cargoCapacity);
        }

        static void ApplyRestorationMilestone(GarageState state)
        {
            switch (state.SuccessfulExtractions)
            {
                case 1:
                    state.GetSubsystem(ShipSubsystem.PrimaryThruster).Integrity = 1f;
                    Unlock(state, "thruster:light");
                    state.SelectedThrusterId = "light";
                    break;
                case 2:
                    state.GetSubsystem(ShipSubsystem.Stabilizers).Integrity = 1f;
                    Unlock(state, "addon:fins-01");
                    break;
                case 3:
                    SubsystemState hull = state.GetSubsystem(ShipSubsystem.Hull);
                    hull.Tier = 2;
                    hull.Integrity = 1f;
                    break;
                case 4:
                    state.RestorationChoicePending = true;
                    break;
            }
        }

        static long RepairDurationMilliseconds(GarageState state, SubsystemState target)
        {
            // The starter wreck returns quickly; upgraded ships create the longer-term garage loop.
            float baseMinutes = state.SuccessfulExtractions < 3 ? .15f : 2f + target.Tier * 3f;
            float botMultiplier = 1f / (1f + state.MechanicBotLevel * .25f);
            return (long)(baseMinutes * botMultiplier * 60_000f * Math.Max(.15f, 1f - target.Integrity));
        }

        static void Damage(SubsystemState subsystem, float amount) => subsystem.Integrity = Math.Max(0f, subsystem.Integrity - amount);
        static void Unlock(GarageState state, string id) { if (!state.OwnedItemIds.Contains(id)) state.OwnedItemIds.Add(id); }
        static GarageCommandResult Success(GarageState state) => new GarageCommandResult(true, GarageFailure.None, state);
        static GarageCommandResult Fail(GarageState state, GarageFailure failure) => new GarageCommandResult(false, failure, state.Copy());
    }
}
