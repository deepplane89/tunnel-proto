using System;

namespace JetHorizon.Simulation
{
    public enum ObstacleAlgorithmFamily
    {
        ConeField,
        WallField,
        GateField,
        Lightning,
        Corridor,
        Asteroid,
        Ring
    }

    public enum ObstacleTargetingMode
    {
        ShipRelativePredicted,
        ShipRelativeLive,
        AuthoredRoute,
        AlternatingGate,
        MovingGap,
        SymmetricPinch,
        StaticField
    }

    public enum ObstacleAlgorithmId
    {
        RandomConeRows,
        FatConeRows,
        AngledWallRows,
        LethalRingRows,
        SlalomClosingDoors,
        ZipperAlternatingGates,
        LightningRandom,
        LightningSweep,
        LightningStagger,
        LightningSalvo,
        LightningPinch,
        L3ConeCorridor,
        L4SineCorridor,
        L5SineCorridor,
        PreT4ARandomLightningCanyon,
        PreT4BChillLightningCanyon,
        AsteroidRandom,
        AsteroidSweep,
        AsteroidStagger,
        AsteroidSalvo,
        AsteroidPinch
    }

    /// <summary>
    /// Searchable source-of-truth record for a production obstacle algorithm.
    /// Records preserve the GitHub behavior and its anti-camping idea separately
    /// from whether the algorithm is currently eligible for gameplay.
    /// </summary>
    public sealed class ObstacleAlgorithmDescriptor
    {
        public ObstacleAlgorithmId Id { get; }
        public string Name { get; }
        public ObstacleAlgorithmFamily Family { get; }
        public ObstacleTargetingMode Targeting { get; }
        public string SourceFile { get; }
        public string SourceSymbol { get; }
        public string CoreOwner { get; }
        public string PatternRule { get; }
        public string AntiCampingRule { get; }
        public bool ActiveInRockProof { get; }

        internal ObstacleAlgorithmDescriptor(
            ObstacleAlgorithmId id,
            string name,
            ObstacleAlgorithmFamily family,
            ObstacleTargetingMode targeting,
            string sourceFile,
            string sourceSymbol,
            string coreOwner,
            string patternRule,
            string antiCampingRule,
            bool activeInRockProof = false)
        {
            Id = id;
            Name = Required(name, nameof(name));
            Family = family;
            Targeting = targeting;
            SourceFile = Required(sourceFile, nameof(sourceFile));
            SourceSymbol = Required(sourceSymbol, nameof(sourceSymbol));
            CoreOwner = Required(coreOwner, nameof(coreOwner));
            PatternRule = Required(patternRule, nameof(patternRule));
            AntiCampingRule = Required(antiCampingRule, nameof(antiCampingRule));
            ActiveInRockProof = activeInRockProof;
        }

        static string Required(string value, string name)
            => !string.IsNullOrWhiteSpace(value) ? value : throw new ArgumentException("Value is required.", name);
    }

    /// <summary>
    /// Dormant algorithm library. Adding an entry here never schedules it; the
    /// TrueWaveWorldCatalog remains the sole eligibility authority.
    /// </summary>
    public static class ObstacleAlgorithmBank
    {
        static readonly ObstacleAlgorithmDescriptor[] Entries =
        {
            D(ObstacleAlgorithmId.RandomConeRows, "Random cone rows", ObstacleAlgorithmFamily.ConeField,
                ObstacleTargetingMode.ShipRelativePredicted, "src/40-main-late.js", "spawnObstacles",
                "RandomConeFormationPlanner", "Shuffle 21 lanes, reserve a two-lane opening, then place a density-capped row.",
                "GitHub recenters the lane field on predicted ship X every row; the finite port rejects every stationary X instead.", true),
            D(ObstacleAlgorithmId.FatConeRows, "Fat cone rows", ObstacleAlgorithmFamily.ConeField,
                ObstacleTargetingMode.ShipRelativeLive, "src/40-main-late.js + src/72-main-late-mid.js", "fat_cones / _spawnFatConeRow",
                "JetHorizonSimulation world spawner", "Place four-to-five wide cones with a larger lane spread and five-lane anti-bunch gap.",
                "Center the field on live ship X and spread blockers laterally so a parked lane is temporary."),
            D(ObstacleAlgorithmId.AngledWallRows, "Angled wall rows", ObstacleAlgorithmFamily.WallField,
                ObstacleTargetingMode.ShipRelativePredicted, "src/40-main-late.js", "spawnObstacles angled band",
                "StructuredWallFieldDefinition", "Shuffle lane anchors, enforce wall separation, then alternate 25-to-45 degree wall angles.",
                "Predicted ship-relative origin plus angled footprints removes a persistent straight channel."),
            D(ObstacleAlgorithmId.LethalRingRows, "Lethal ring rows", ObstacleAlgorithmFamily.Ring,
                ObstacleTargetingMode.ShipRelativePredicted, "src/40-main-late.js", "_spawnLethalRing / lethal band",
                "JetHorizonSimulation world spawner", "Place three-to-four separated lethal rings from the shuffled lane field.",
                "Ship-relative origin and four-lane separation change the safe interval every row."),
            D(ObstacleAlgorithmId.SlalomClosingDoors, "Slalom closing doors", ObstacleAlgorithmFamily.GateField,
                ObstacleTargetingMode.MovingGap, "src/40-main-late.js", "spawnSlalomRow / _drNextGapCenter",
                "JetHorizonSimulation slalom runtime", "Build both sides around an eight-to-ten-unit opening driven by a bounded physics curve.",
                "The gap must change and cannot repeat the same lane; rows are walls rather than sparse points."),
            D(ObstacleAlgorithmId.ZipperAlternatingGates, "Zipper alternating gates", ObstacleAlgorithmFamily.GateField,
                ObstacleTargetingMode.AlternatingGate, "src/40-main-late.js", "spawnZipperRow",
                "JetHorizonSimulation zipper runtime", "Fill the full lateral field except one offset gate and flip its side every row.",
                "Alternating forced gates explicitly reject every constant-X hold."),
            Lightning(ObstacleAlgorithmId.LightningRandom, "Lightning random", ObstacleTargetingMode.ShipRelativeLive, "random", "Scatter around live ship X each tick."),
            Lightning(ObstacleAlgorithmId.LightningSweep, "Lightning sweep", ObstacleTargetingMode.MovingGap, "sweep", "Sweep a multi-strike band across live ship X."),
            Lightning(ObstacleAlgorithmId.LightningStagger, "Lightning stagger", ObstacleTargetingMode.ShipRelativeLive, "stagger", "Re-read ship X for every warning and strike."),
            Lightning(ObstacleAlgorithmId.LightningSalvo, "Lightning salvo", ObstacleTargetingMode.ShipRelativeLive, "salvo", "Fire a simultaneous wall centered on current ship X."),
            Lightning(ObstacleAlgorithmId.LightningPinch, "Lightning pinch", ObstacleTargetingMode.SymmetricPinch, "pinch", "Close symmetric pairs on a captured ship X, then fire center."),
            Corridor(ObstacleAlgorithmId.L3ConeCorridor, "L3 cone corridor", "spawnCorridorRow", "SineCorridorDefinition L3", "Funnel from wide entry into a moving gap, hold, then widen for exit."),
            Corridor(ObstacleAlgorithmId.L4SineCorridor, "L4 sine corridor", "spawnL4CorridorRow", "SineCorridorDefinition L4", "Ramp sine amplitude and period while narrowing the corridor."),
            Corridor(ObstacleAlgorithmId.L5SineCorridor, "L5 sine corridor", "L5 corridor row loop", "SineCorridorDefinition L5", "Run the faster 420-row sine corridor with a controlled exit ramp."),
            D(ObstacleAlgorithmId.PreT4ARandomLightningCanyon, "Pre-T4A random-lightning canyon", ObstacleAlgorithmFamily.Corridor,
                ObstacleTargetingMode.ShipRelativeLive, "src/40-main-late.js", "_startPreT4ACanyon",
                "Environment encounter definitions", "Continuous canyon envelope plus approved random lightning loop.",
                "Walls bound the route while lightning targets live ship-relative positions."),
            D(ObstacleAlgorithmId.PreT4BChillLightningCanyon, "Pre-T4B chill-lightning canyon", ObstacleAlgorithmFamily.Corridor,
                ObstacleTargetingMode.ShipRelativeLive, "src/40-main-late.js", "_startPreT4BCanyon",
                "Environment encounter definitions", "Preset-one canyon with a lower-frequency random lightning layer.",
                "The corridor constrains parking; live-targeted lightning prevents one permanent safe offset."),
            Asteroid(ObstacleAlgorithmId.AsteroidRandom, "Asteroid random", ObstacleTargetingMode.ShipRelativeLive, "random", "Four delayed shots each re-read ship X."),
            Asteroid(ObstacleAlgorithmId.AsteroidSweep, "Asteroid sweep", ObstacleTargetingMode.MovingGap, "sweep", "Five delayed shots sweep across live ship X."),
            Asteroid(ObstacleAlgorithmId.AsteroidStagger, "Asteroid stagger", ObstacleTargetingMode.ShipRelativeLive, "stagger", "A rolling wall remains centered on live ship X."),
            Asteroid(ObstacleAlgorithmId.AsteroidSalvo, "Asteroid salvo", ObstacleTargetingMode.ShipRelativeLive, "salvo", "A simultaneous wall is centered on current ship X."),
            Asteroid(ObstacleAlgorithmId.AsteroidPinch, "Asteroid pinch", ObstacleTargetingMode.SymmetricPinch, "pinch", "Five closing pairs culminate in a center kill shot.")
        };

        public static int Count => Entries.Length;

        public static ObstacleAlgorithmDescriptor Get(int index) => index >= 0 && index < Entries.Length
            ? Entries[index]
            : throw new ArgumentOutOfRangeException(nameof(index));

        public static ObstacleAlgorithmDescriptor Get(ObstacleAlgorithmId id)
        {
            for (int i = 0; i < Entries.Length; i++)
                if (Entries[i].Id == id) return Entries[i];
            throw new ArgumentOutOfRangeException(nameof(id));
        }

        static ObstacleAlgorithmDescriptor Lightning(
            ObstacleAlgorithmId id,
            string name,
            ObstacleTargetingMode targeting,
            string symbol,
            string antiCamping)
            => D(id, name, ObstacleAlgorithmFamily.Lightning, targeting,
                "src/72-main-late-mid.js", "_LT_PANEL_PATTERNS." + symbol,
                "LightningSequenceRuntime", "Use the shared warning/strike lifecycle with the " + symbol + " target sequence.", antiCamping);

        static ObstacleAlgorithmDescriptor Corridor(
            ObstacleAlgorithmId id,
            string name,
            string symbol,
            string owner,
            string rule)
            => D(id, name, ObstacleAlgorithmFamily.Corridor, ObstacleTargetingMode.MovingGap,
                "src/40-main-late.js + src/72-main-late-mid.js", symbol, owner, rule,
                "Continuous walls make the authored moving opening the only traversable route.");

        static ObstacleAlgorithmDescriptor Asteroid(
            ObstacleAlgorithmId id,
            string name,
            ObstacleTargetingMode targeting,
            string symbol,
            string rule)
            => D(id, name, ObstacleAlgorithmFamily.Asteroid, targeting,
                "src/72-main-late-mid.js", "asteroid _patternDefs." + symbol,
                "AsteroidSequenceRuntime", rule,
                "The pattern is centered on current or repeatedly sampled ship X, so no world-space lane stays safe.");

        static ObstacleAlgorithmDescriptor D(
            ObstacleAlgorithmId id,
            string name,
            ObstacleAlgorithmFamily family,
            ObstacleTargetingMode targeting,
            string sourceFile,
            string sourceSymbol,
            string coreOwner,
            string patternRule,
            string antiCampingRule,
            bool active = false)
            => new ObstacleAlgorithmDescriptor(
                id, name, family, targeting, sourceFile, sourceSymbol,
                coreOwner, patternRule, antiCampingRule, active);
    }
}
