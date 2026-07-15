# Jet Horizon Unity Feel Stack

## Ownership

- The engine-neutral simulation owns lateral acceleration, counter-steer, deceleration, maximum velocity, roll penalty, bank state, collision, score, and stages.
- `JetHorizonFeelProfile` supplies the deterministic handling configuration at simulation construction and the Unity-only presentation configuration.
- `ShipFeelPresenter` converts the core snapshot into one shared set of normalized presentation signals.
- `ShipOrganicMotion` applies spring-damped secondary motion only to the imported visual model. It cannot change collision or gameplay position.
- `CameraRig` composes follow, look-ahead, horizon roll, lens response, event impulse, launch/retry, and death layers.
- Thrusters, star streaks, ship wake, bank wake, audio, and feedback read the same speed/steering signals.

## Default handling

The default retains the Three.js equations and limits while applying a modest Unity-organic calibration:

- slightly stronger input acceleration;
- slightly stronger neutral deceleration;
- stronger counter-steer authority;
- slower bank recovery and softer zero-crossing;
- explicit corrected Unity visual-yaw sign with reduced turn weight;
- bank-dependent presentation lift so turns read from the wings rather than nose yaw;
- a horizon-roll dead zone and short hold threshold, keeping small corrections level.

The result remains deterministic at 60 Hz. Unity Rigidbody contacts are not an authority for ship motion.

## Organic motion

The stable ship root follows the core exactly. The imported `ShipModel` child, including named sockets and thruster attachments, rides on a damped visual spring with:

- lateral inertia;
- slip-driven yaw;
- steering overshoot roll;
- acceleration pitch;
- low-amplitude coherent turbulence.

This gives Unity-specific weight and sway without leaking presentation motion into collision.

## Audio

The original Three.js MP3 SFX are imported under `Assets/JetHorizon/Resources/Audio`. Unity transcodes them per build target.

- Engine body and edge layers respond continuously to shared speed intensity.
- Steering onset/release uses the source whoosh volume, pitch, cooldown, and stereo-pan language.
- Crash, near miss, lightning, shield, laser, powerup, klaxon, and launch events route from `GameEvents`.
- Short SFX preload; looping layers remain dedicated `AudioSource` channels.

MP3 is acceptable source material. If a loop seam or latency problem is audible on device, only that source should be replaced with WAV/OGG rather than converting the entire library blindly.

## Tuning

Open `Jet Horizon > Control Room`, then use the **Feel**, **Camera**, and **Audio** tabs. The shipped defaults are intended to work without owner tuning. The profile exists for reversible refinement, not as unfinished configuration work.
