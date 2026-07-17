using JetHorizon.Simulation;
using UnityEngine;

namespace JetHorizon
{
    /// <summary>Coordinates event envelopes without allowing presentation to mutate simulation.</summary>
    public sealed class FeedbackDirector : MonoBehaviour
    {
        JetHorizonFeelProfile P => GameManager.I != null ? GameManager.I.FeelProfile : null;
        void OnEnable()
        {
            GameEvents.NearMiss += NearMiss; GameEvents.CoinCollected += Coin;
            GameEvents.PowerupActivated += Powerup; GameEvents.ShieldHit += Shield;
            GameEvents.LightningStruck += Lightning; GameEvents.PlayerDied += Death;
            GameEvents.LaserChainAdvanced += LaserChain;
            GameEvents.LaserFormationCompleted += LaserComplete;
            GameEvents.CargoWaveLifecycleChanged += WaveLifecycle;
        }
        void OnDisable()
        {
            GameEvents.NearMiss -= NearMiss; GameEvents.CoinCollected -= Coin;
            GameEvents.PowerupActivated -= Powerup; GameEvents.ShieldHit -= Shield;
            GameEvents.LightningStruck -= Lightning; GameEvents.PlayerDied -= Death;
            GameEvents.LaserChainAdvanced -= LaserChain;
            GameEvents.LaserFormationCompleted -= LaserComplete;
            GameEvents.CargoWaveLifecycleChanged -= WaveLifecycle;
        }
        void NearMiss() => Pulse(P != null ? P.NearMissImpulse : .08f);
        void Coin() => Pulse(P != null ? P.PickupImpulse : .025f);
        void Powerup(PowerupType _, float __) => Pulse((P != null ? P.PickupImpulse : .025f) * 1.8f);
        void Shield(int _) => Pulse(P != null ? P.ShieldHitImpulse : .12f);
        void Lightning() => Pulse(P != null ? P.LightningImpulse : .18f);
        void Death() => Pulse(P != null ? P.DeathImpulse : .32f);
        void LaserChain(int chain, int destroyedTotal)
        {
            float milestone = destroyedTotal > 0 && destroyedTotal % LaserRewardModel.CargoMilestoneInterval == 0
                ? .035f
                : 0f;
            Pulse(.025f + Mathf.Min(10, chain) * .004f + milestone);
        }
        void LaserComplete(float _, float __) => Pulse(.30f);
        void WaveLifecycle(TerrainWaveKind kind, CargoWaveLifecycle lifecycle)
        {
            if (lifecycle == CargoWaveLifecycle.HorizonReveal)
                Pulse(kind == TerrainWaveKind.PrismaticCorridor ? .055f : .025f);
            else if (lifecycle == CargoWaveLifecycle.Active
                && kind != TerrainWaveKind.OpenWaterBreather)
                Pulse(.018f);
        }
        static void Pulse(float amount) => ShipFeelPresenter.I?.AddImpulse(amount);
    }
}
