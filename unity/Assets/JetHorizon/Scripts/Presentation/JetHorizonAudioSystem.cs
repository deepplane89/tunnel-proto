using JetHorizon.Simulation;
using UnityEngine;

namespace JetHorizon
{
    /// <summary>Unity audio projection of the source SFX.</summary>
    public sealed class JetHorizonAudioSystem : MonoBehaviour
    {
        AudioSource _oneShot;
        float _lastSteer, _steerHold, _whooshCooldown;

        void Awake()
        {
            _oneShot = Source("SFX", false);
        }

        void OnEnable()
        {
            GameEvents.PlayerDied += Died;
            GameEvents.NearMiss += NearMiss; GameEvents.CoinCollected += Coin;
            GameEvents.KlaxonCountdown += Klaxon;
            GameEvents.LightningStruck += Lightning; GameEvents.ShieldHit += Shield; GameEvents.ShieldBroken += ShieldBroken;
            GameEvents.PowerupActivated += Powerup;
            GameEvents.LaserFired += Laser;
            GameEvents.SpeedGateCrossed += GateCrossed;
        }

        void OnDisable()
        {
            GameEvents.PlayerDied -= Died;
            GameEvents.NearMiss -= NearMiss; GameEvents.CoinCollected -= Coin;
            GameEvents.KlaxonCountdown -= Klaxon; GameEvents.LightningStruck -= Lightning;
            GameEvents.ShieldHit -= Shield; GameEvents.ShieldBroken -= ShieldBroken;
            GameEvents.PowerupActivated -= Powerup; GameEvents.LaserFired -= Laser;
            GameEvents.SpeedGateCrossed -= GateCrossed;
        }

        void Update()
        {
            if (GameManager.I == null) return;
            float dt = Mathf.Min(Time.unscaledDeltaTime, Tuning.MaxRawDt);
            _whooshCooldown = Mathf.Max(0f, _whooshCooldown - dt);
            ShipFeelSignals signals = ShipFeelPresenter.I != null ? ShipFeelPresenter.I.Signals : default;
            float steer = signals.Steering01;
            if (Mathf.Abs(steer) > .18f)
            {
                _steerHold += dt;
                if (Mathf.Abs(_lastSteer) <= .18f && _whooshCooldown <= 0f)
                {
                    Play("whoosh2", Mathf.Lerp(.14f, .44f, Mathf.Abs(steer)), Random.Range(.88f, 1.12f), Mathf.Sign(steer) * Mathf.Lerp(.3f, .7f, Mathf.Abs(steer)));
                    _whooshCooldown = .08f;
                }
            }
            else
            {
                if (Mathf.Abs(_lastSteer) > .18f && _steerHold > 1.5f)
                    Play("whoosh-release", Mathf.Lerp(.18f, .56f, Mathf.Clamp01((_steerHold - 1.5f) / 1.5f)), Random.Range(.9f, 1.15f), Mathf.Sign(_lastSteer) * .35f);
                _steerHold = 0f;
            }
            _lastSteer = steer;
        }

        void NearMiss() => Play("nearmiss", .24f, Random.Range(.92f, 1.08f));
        void Coin() => Play("droplet", .22f, Random.Range(.96f, 1.06f));
        void Lightning() => Play("lightning-impact", .55f, Random.Range(.96f, 1.04f));
        void Shield(int _) => Play("shield-hit", .48f);
        void ShieldBroken() => Play("shield-expire", .40f);
        void Laser(float _) => Play("laser-beam-mg", .38f);

        void GateCrossed(SpeedGateKind kind, float gain, int streak)
        {
            float streakPitch = Mathf.Min(.24f, Mathf.Max(0, streak - 1) * .012f);
            if (kind == SpeedGateKind.Common)
            {
                Play("whoosh2", .15f, 1.04f + streakPitch);
                if (streak > 0 && streak % 5 == 0)
                    Play("thruster-impact", .18f, 1.18f);
                return;
            }
            if (kind == SpeedGateKind.Surge)
            {
                Play("thruster-impact", .42f, 1.02f + streakPitch * .35f);
                Play("whoosh-release", .28f, 1.10f);
                return;
            }
            Play("thruster-impact", .58f, .94f);
            Play("powerup-burst", .45f, 1.04f);
        }

        void Died()
        {
            Play("crash", .25f); Play("crash-layer", .25f, 1f, 0f, .015f);
        }

        void Klaxon()
        {
            Play("klaxon", .32f); Play("klaxon", .32f, 1f, 0f, .5f); Play("klaxon", .36f, 1f, 0f, 1f);
        }

        void Powerup(PowerupType type, float _)
        {
            Play("powerup-burst", .36f);
            if (type == PowerupType.Shield) Play("shield-activate", .18f);
            else if (type == PowerupType.Laser) Play("laser-beam-mg", .38f);
            else if (type == PowerupType.Overdrive) Play("thruster-impact", .42f);
        }

        AudioSource Source(string name, bool loop)
        {
            // Component.name proxies GameObject.name, so naming an AudioSource attached
            // to this object used to rename the GameManager itself to "Engine Edge".
            // Dedicated children also keep audio implementation details off the
            // composition root.
            var sourceObject = new GameObject(name);
            sourceObject.transform.SetParent(transform, false);
            var source = sourceObject.AddComponent<AudioSource>();
            source.loop = loop;
            source.playOnAwake = false; source.spatialBlend = 0f; source.dopplerLevel = 0f; return source;
        }

        void Play(string name, float volume, float pitch = 1f, float pan = 0f, float delay = 0f)
        {
            AudioClip clip = Clip(name); if (clip == null) return;
            var source = delay > 0f ? Source("Scheduled " + name, false) : _oneShot;
            source.pitch = pitch; source.panStereo = pan; source.volume = delay > 0f ? volume : 1f;
            if (delay > 0f) { source.clip = clip; source.PlayDelayed(delay); Destroy(source.gameObject, delay + clip.length + .2f); }
            else source.PlayOneShot(clip, volume);
        }

        static AudioClip Clip(string name) => Resources.Load<AudioClip>("Audio/" + name);
    }
}
