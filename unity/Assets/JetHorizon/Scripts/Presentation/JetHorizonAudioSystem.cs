using JetHorizon.Simulation;
using UnityEngine;

namespace JetHorizon
{
    /// <summary>Unity audio projection of the source SFX.</summary>
    public sealed class JetHorizonAudioSystem : MonoBehaviour
    {
        AudioSource _oneShot;
        float _lastSteer, _steerHold, _whooshCooldown, _laserImpactCooldown;

        void Awake()
        {
            _oneShot = Source("SFX", false);
        }

        void OnEnable()
        {
            GameEvents.PlayerDied += Died;
            GameEvents.NearMiss += NearMiss; GameEvents.CoinCollected += Coin;
            GameEvents.CargoCollected += Cargo;
            GameEvents.KlaxonCountdown += Klaxon;
            GameEvents.LightningStruck += Lightning; GameEvents.ShieldHit += Shield; GameEvents.ShieldBroken += ShieldBroken;
            GameEvents.PowerupActivated += Powerup;
            GameEvents.LaserFired += Laser;
            GameEvents.HazardDestroyed += LaserImpact;
            GameEvents.LaserChainAdvanced += LaserChain;
            GameEvents.LaserFormationCompleted += LaserComplete;
            GameEvents.SpeedGateCrossed += GateCrossed;
            GameEvents.CargoWaveChanged += WaveChanged;
            GameEvents.CargoWaveLifecycleChanged += WaveLifecycleChanged;
        }

        void OnDisable()
        {
            GameEvents.PlayerDied -= Died;
            GameEvents.NearMiss -= NearMiss; GameEvents.CoinCollected -= Coin;
            GameEvents.CargoCollected -= Cargo;
            GameEvents.KlaxonCountdown -= Klaxon; GameEvents.LightningStruck -= Lightning;
            GameEvents.ShieldHit -= Shield; GameEvents.ShieldBroken -= ShieldBroken;
            GameEvents.PowerupActivated -= Powerup; GameEvents.LaserFired -= Laser;
            GameEvents.HazardDestroyed -= LaserImpact;
            GameEvents.LaserChainAdvanced -= LaserChain;
            GameEvents.LaserFormationCompleted -= LaserComplete;
            GameEvents.SpeedGateCrossed -= GateCrossed;
            GameEvents.CargoWaveChanged -= WaveChanged;
            GameEvents.CargoWaveLifecycleChanged -= WaveLifecycleChanged;
        }

        void Update()
        {
            if (GameManager.I == null) return;
            float dt = Mathf.Min(Time.unscaledDeltaTime, Tuning.MaxRawDt);
            _whooshCooldown = Mathf.Max(0f, _whooshCooldown - dt);
            _laserImpactCooldown = Mathf.Max(0f, _laserImpactCooldown - dt);
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
        void Cargo(int _, RunCargoKind kind, int __)
        {
            float pitch = kind == RunCargoKind.Salvage ? 1.02f
                : kind == RunCargoKind.Alloy ? 1.20f : 1.42f;
            float volume = kind == RunCargoKind.Salvage ? .25f
                : kind == RunCargoKind.Alloy ? .34f : .46f;
            Play("powerup-burst", volume, pitch);
        }
        void Lightning() => Play("lightning-impact", .55f, Random.Range(.96f, 1.04f));
        void Shield(int _) => Play("shield-hit", .48f);
        void ShieldBroken() => Play("shield-expire", .40f);
        void Laser(float _) => Play("laser-beam-mg", .38f);
        void LaserImpact(int _, float x, float __)
        {
            if (_laserImpactCooldown > 0f) return;
            float pan = Mathf.Clamp(x / 32f, -.65f, .65f);
            Play("thruster-impact", .12f, Random.Range(1.25f, 1.48f), pan);
            _laserImpactCooldown = .07f;
        }
        void LaserChain(int chain, int destroyedTotal)
        {
            if (destroyedTotal <= 0 || destroyedTotal % LaserRewardModel.CargoMilestoneInterval != 0) return;
            Play("powerup-burst", .18f, 1.05f + Mathf.Min(10, chain) * .025f);
        }
        void LaserComplete(float _, float __)
        {
            Play("thruster-impact", .62f, .78f);
            Play("powerup-burst", .58f, 1.08f, 0f, .035f);
            Play("whoosh-release", .38f, .86f, 0f, .08f);
        }

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

        void WaveChanged(int _, TerrainWaveKind kind)
        {
            if (kind == TerrainWaveKind.OpenWaterBreather)
                Play("whoosh-release", .14f, .78f);
            else if (kind == TerrainWaveKind.OpenWaterFormation)
                Play("whoosh2", .18f, .92f);
            else if (kind == TerrainWaveKind.OpenWaterLightning)
                Play("whoosh2", .20f, .72f);
            else if (kind == TerrainWaveKind.CrystallineCanyon
                || kind == TerrainWaveKind.RoutePortal)
                Play("whoosh-release", .24f, .68f);
            else if (kind == TerrainWaveKind.PrismaticCorridor)
                Play("powerup-burst", .22f, .82f);
        }

        void WaveLifecycleChanged(TerrainWaveKind kind, CargoWaveLifecycle lifecycle)
        {
            if (lifecycle != CargoWaveLifecycle.HorizonReveal) return;
            float pitch = kind == TerrainWaveKind.OpenWaterLightning ? .72f
                : kind == TerrainWaveKind.PrismaticCorridor ? 1.18f
                : .88f;
            Play("whoosh2", .12f, pitch);
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
