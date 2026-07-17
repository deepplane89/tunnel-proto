using System;

namespace JetHorizon.Simulation
{
    public readonly struct WorldParcelSelection
    {
        public WorldParcelKind FirstMajor { get; }
        public WorldParcelKind SecondMajor { get; }
        public int FormationVariant { get; }
        public int FirstVariant { get; }
        public int SecondVariant { get; }
        public string Signature => FormationVariant + ":" + FirstMajor + ":" + FirstVariant
            + ">" + SecondMajor + ":" + SecondVariant;

        public WorldParcelSelection(
            WorldParcelKind firstMajor,
            WorldParcelKind secondMajor,
            int formationVariant,
            int firstVariant,
            int secondVariant)
        {
            if (firstMajor == secondMajor)
                throw new ArgumentException("A run sentence cannot immediately repeat a major family.");
            FirstMajor = firstMajor;
            SecondMajor = secondMajor;
            FormationVariant = formationVariant;
            FirstVariant = firstVariant;
            SecondVariant = secondVariant;
        }
    }

    public interface IWorldParcelSelector
    {
        WorldParcelSelection Select(int sector);
    }

    /// <summary>
    /// Stateless deterministic selector with authored family cooldowns. The six-row
    /// circuit keeps hero corridors sparse, changes the physical steering sentence,
    /// and rotates formation/major variants independently of mirror or tint.
    /// </summary>
    public sealed class DeterministicWorldParcelSelector : IWorldParcelSelector
    {
        static readonly WorldParcelKind[][] Sentences =
        {
            new[] { WorldParcelKind.CrystallineCanyon, WorldParcelKind.RoutePortal },
            new[] { WorldParcelKind.OpenWaterLightning, WorldParcelKind.CrystallineCanyon },
            new[] { WorldParcelKind.RoutePortal, WorldParcelKind.PrismaticCorridor },
            new[] { WorldParcelKind.CrystallineCanyon, WorldParcelKind.OpenWaterLightning },
            new[] { WorldParcelKind.KnifeEdgeTunnel, WorldParcelKind.CrystallineCanyon },
            new[] { WorldParcelKind.OpenWaterLightning, WorldParcelKind.RoutePortal }
        };

        public WorldParcelSelection Select(int sector)
        {
            if (sector < 0) throw new ArgumentOutOfRangeException(nameof(sector));
            int circuit = sector / Sentences.Length;
            int row = sector % Sentences.Length;
            WorldParcelKind[] sentence = Sentences[row];
            return new WorldParcelSelection(
                sentence[0],
                sentence[1],
                (sector + circuit) % 4,
                (sector + circuit * 2) % 3,
                (sector + circuit * 2 + 1) % 3);
        }
    }
}
