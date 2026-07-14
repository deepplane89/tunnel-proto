using System;

namespace JetHorizon.Simulation
{
    /// <summary>Engine-neutral three-dimensional value used by content definitions.</summary>
    public readonly struct Float3
    {
        public float X { get; }
        public float Y { get; }
        public float Z { get; }

        public Float3(float x, float y, float z)
        {
            X = x;
            Y = y;
            Z = z;
        }
    }

    /// <summary>
    /// Named ship-root-local attachment points that keep effects independent of a model importer.
    /// The production Three.js values were authored in its reference world pose; catalogue entries
    /// convert those values once so every renderer can attach them without applying ship scale twice.
    /// </summary>
    public sealed class ThrusterSocketDefinition
    {
        public Float3 MainLeft { get; }
        public Float3 MainRight { get; }
        public Float3 MiniLeft { get; }
        public Float3 MiniRight { get; }
        public bool MiniThrustersEnabled { get; }

        public ThrusterSocketDefinition(
            Float3 mainLeft,
            Float3 mainRight,
            Float3 miniLeft,
            Float3 miniRight,
            bool miniThrustersEnabled = true)
        {
            MainLeft = mainLeft;
            MainRight = mainRight;
            MiniLeft = miniLeft;
            MiniRight = miniRight;
            MiniThrustersEnabled = miniThrustersEnabled;
        }
    }

    /// <summary>Portable GLB placement plus attachment metadata for one ship hull.</summary>
    public sealed class ShipDefinition
    {
        public string Id { get; }
        public string ModelKey { get; }
        public Float3 ModelPosition { get; }
        public Float3 ModelRotationRadians { get; }
        public float ModelScale { get; }
        public ThrusterSocketDefinition Thrusters { get; }

        public ShipDefinition(
            string id,
            string modelKey,
            Float3 modelPosition,
            Float3 modelRotationRadians,
            float modelScale,
            ThrusterSocketDefinition thrusters)
        {
            if (string.IsNullOrWhiteSpace(id)) throw new ArgumentException("Ship id is required.", nameof(id));
            if (string.IsNullOrWhiteSpace(modelKey)) throw new ArgumentException("Model key is required.", nameof(modelKey));
            if (modelScale <= 0f) throw new ArgumentOutOfRangeException(nameof(modelScale));
            Id = id;
            ModelKey = modelKey;
            ModelPosition = modelPosition;
            ModelRotationRadians = modelRotationRadians;
            ModelScale = modelScale;
            Thrusters = thrusters ?? throw new ArgumentNullException(nameof(thrusters));
        }
    }

    /// <summary>Portable visual tuning for an exhaust style; renderers choose how to draw it.</summary>
    public sealed class ThrusterEffectDefinition
    {
        public string Id { get; }
        public float Scale { get; }
        public float ParticleOpacity { get; }
        public float ParticleSize { get; }
        public float ParticleLifeBase { get; }
        public float ParticleLifeJitter { get; }
        public float SpawnJitter { get; }
        public float BloomScale { get; }
        public float BloomOpacity { get; }
        public float BloomPulse { get; }
        public float ConeLength { get; }
        public float ConeRadius { get; }

        public ThrusterEffectDefinition(
            string id,
            float scale,
            float particleOpacity,
            float particleSize,
            float particleLifeBase,
            float particleLifeJitter,
            float spawnJitter,
            float bloomScale,
            float bloomOpacity,
            float bloomPulse,
            float coneLength,
            float coneRadius)
        {
            Id = id;
            Scale = scale;
            ParticleOpacity = particleOpacity;
            ParticleSize = particleSize;
            ParticleLifeBase = particleLifeBase;
            ParticleLifeJitter = particleLifeJitter;
            SpawnJitter = spawnJitter;
            BloomScale = bloomScale;
            BloomOpacity = bloomOpacity;
            BloomPulse = bloomPulse;
            ConeLength = coneLength;
            ConeRadius = coneRadius;
        }
    }

    /// <summary>Canonical content copied from the production web game's current dev configuration.</summary>
    public static class ShipCatalog
    {
        static readonly ShipDefinition RunnerDefinition = new ShipDefinition(
            "runner",
            "spaceship_01.glb",
            new Float3(0f, -0.590f, 0f),
            new Float3(0f, 3.142f, 0f),
            1f,
            // Source calibration pose: ship root (0, .28, 4.5), scale .30.
            // Root-local = (source world socket - source root position) / source scale.
            new ThrusterSocketDefinition(
                new Float3(-1.600000f, -0.766667f, 2.000000f),
                new Float3( 1.600000f, -0.766667f, 2.000000f),
                new Float3(-0.733333f, -0.666667f, 2.000000f),
                new Float3( 0.733333f, -0.666667f, 2.000000f)));

        public static ShipDefinition Runner => RunnerDefinition;
    }

    public static class ThrusterEffectCatalog
    {
        static readonly ThrusterEffectDefinition LightDefinition = new ThrusterEffectDefinition(
            "light",
            scale: 0.80f,
            particleOpacity: 0.48f,
            particleSize: 0.06f,
            particleLifeBase: 0.20f,
            particleLifeJitter: 0.05f,
            spawnJitter: 0.07f,
            bloomScale: 0.10f,
            bloomOpacity: 0.43f,
            bloomPulse: 0.15f,
            coneLength: 3.30f,
            coneRadius: 0.29f);

        public static ThrusterEffectDefinition Light => LightDefinition;
    }
}
