using JetHorizon.Meta;

namespace JetHorizon.Application
{
    public interface IGarageProgressStore
    {
        bool TryLoad(out GarageState state);
        void Save(GarageState state);
    }

    /// <summary>
    /// Platform commerce seam for optional repair acceleration. No product SDK or
    /// storefront type is allowed past this port.
    /// </summary>
    public interface IRepairAccelerationPort
    {
        bool TryConsumeRepairAcceleration(long repairJobId);
    }

    /// <summary>
    /// Thin use-case coordinator. It owns no costs, timers, unlocks, or ship math;
    /// every rule is delegated to the engine-neutral garage domain.
    /// </summary>
    public sealed class GarageOrchestrator
    {
        readonly IGarageProgressStore _store;
        readonly IUtcClock _clock;
        readonly IRepairAccelerationPort _repairAcceleration;

        public GarageState Current { get; private set; }

        public GarageOrchestrator(
            IGarageProgressStore store,
            IUtcClock clock,
            IRepairAccelerationPort repairAcceleration)
        {
            _store = store ?? throw new System.ArgumentNullException(nameof(store));
            _clock = clock ?? throw new System.ArgumentNullException(nameof(clock));
            _repairAcceleration = repairAcceleration ?? throw new System.ArgumentNullException(nameof(repairAcceleration));
            Current = GarageDomainService.Normalize(
                _store.TryLoad(out GarageState loaded) && loaded != null
                    ? loaded
                    : GarageState.CreateNew());
            Commit(GarageDomainService.CompleteRepairs(Current, _clock.UtcUnixMilliseconds));
        }

        public GarageCommandResult Extract(CargoManifest manifest) => Commit(GarageDomainService.Extract(Current, manifest));
        public GarageCommandResult RecordDestroyedRun(float severity) => Commit(GarageDomainService.LoseRunCargoAndDamage(Current, severity));
        public GarageCommandResult CompleteStarterRepair(StarterRepairAward repair) => Commit(GarageDomainService.CompleteStarterRepair(Current, repair));
        public GarageCommandResult InstallStarterHullUpgrade() => Commit(GarageDomainService.InstallStarterHullUpgrade(Current));
        public GarageCommandResult ChooseStarterUpgrade(StarterUpgradeBranch branch) => Commit(GarageDomainService.ChooseStarterUpgrade(Current, branch));
        public GarageCommandResult Purchase(string itemId) => Commit(GarageDomainService.Purchase(Current, itemId));
        public GarageCommandResult PurchaseUpgrade(GarageUpgradeId upgradeId) => Commit(GarageDomainService.PurchaseUpgrade(Current, upgradeId));
        public GarageCommandResult EquipThruster(string itemId) => Commit(GarageDomainService.EquipThruster(Current, itemId));
        public GarageCommandResult EquipHandling(string handlingId) => Commit(GarageDomainService.EquipHandling(Current, handlingId));
        public GarageCommandResult SetAddOnEquipped(string itemId, bool equipped) => Commit(GarageDomainService.SetAddOnEquipped(Current, itemId, equipped));
        public GarageCommandResult BuyPowerupCharge(string powerupId) => Commit(GarageDomainService.BuyPowerupCharge(Current, powerupId));
        public GarageCommandResult UpgradePowerup(string powerupId) => Commit(GarageDomainService.UpgradePowerup(Current, powerupId));
        public GarageCommandResult UpgradeRepairBay() => Commit(GarageDomainService.UpgradeRepairBay(Current));
        public GarageCommandResult UpgradeMechanicBot() => Commit(GarageDomainService.UpgradeMechanicBot(Current));
        public GarageCommandResult QueueRepair(ShipSubsystem subsystem) => Commit(GarageDomainService.QueueRepair(Current, subsystem, _clock.UtcUnixMilliseconds));
        public GarageCommandResult RefreshRepairs() => Commit(GarageDomainService.CompleteRepairs(Current, _clock.UtcUnixMilliseconds));

        public GarageCommandResult AccelerateRepair(long jobId)
        {
            if (!_repairAcceleration.TryConsumeRepairAcceleration(jobId))
                return new GarageCommandResult(false, GarageFailure.InvalidState, Current.Copy());
            return Commit(GarageDomainService.AccelerateRepair(Current, jobId, _clock.UtcUnixMilliseconds));
        }

        GarageCommandResult Commit(GarageCommandResult result)
        {
            if (!result.Succeeded) return result;
            Current = result.State.Copy();
            _store.Save(Current.Copy());
            return new GarageCommandResult(true, GarageFailure.None, Current.Copy());
        }
    }
}
