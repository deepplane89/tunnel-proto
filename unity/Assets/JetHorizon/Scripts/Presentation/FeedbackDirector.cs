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
        }
        void OnDisable()
        {
            GameEvents.NearMiss -= NearMiss; GameEvents.CoinCollected -= Coin;
            GameEvents.PowerupActivated -= Powerup; GameEvents.ShieldHit -= Shield;
            GameEvents.LightningStruck -= Lightning; GameEvents.PlayerDied -= Death;
        }
        void NearMiss() => Pulse(P != null ? P.NearMissImpulse : .08f);
        void Coin() => Pulse(P != null ? P.PickupImpulse : .025f);
        void Powerup(PowerupType _, float __) => Pulse((P != null ? P.PickupImpulse : .025f) * 1.8f);
        void Shield(int _) => Pulse(P != null ? P.ShieldHitImpulse : .12f);
        void Lightning() => Pulse(P != null ? P.LightningImpulse : .18f);
        void Death() => Pulse(P != null ? P.DeathImpulse : .32f);
        static void Pulse(float amount) => ShipFeelPresenter.I?.AddImpulse(amount);
    }
}
