using System;

namespace JetHorizon.Simulation
{
    /// <summary>Canonical event-score rules. Economy value remains owned by CargoCatalog.</summary>
    public static class RunScoreModel
    {
        public static float GateScore(SpeedGateKind kind, int streak)
        {
            float basis;
            switch (kind)
            {
                case SpeedGateKind.Surge: basis = 600f; break;
                case SpeedGateKind.CanyonTransition:
                case SpeedGateKind.PrismaticTransition: basis = 1000f; break;
                case SpeedGateKind.Extraction: basis = 0f; break;
                default: basis = 100f; break;
            }
            float multiplier = 1f + Math.Min(20, Math.Max(0, streak)) * .025f;
            return basis * multiplier;
        }

        public static float CargoPickupScore(RunCargoKind kind, int units)
        {
            int safeUnits = Math.Max(0, units);
            switch (kind)
            {
                case RunCargoKind.Alloy: return safeUnits * 80f;
                case RunCargoKind.Prism: return safeUnits * 250f;
                default: return safeUnits * 20f;
            }
        }

        public static float HeroEncounterCompletion(EncounterKind kind)
        {
            switch (kind)
            {
                case EncounterKind.PrismaticSineCorridor: return 4000f;
                case EncounterKind.CrystallineCanyon: return 3000f;
                default: return 1500f;
            }
        }
    }
}
