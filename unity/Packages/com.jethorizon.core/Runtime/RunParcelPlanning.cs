namespace JetHorizon.Simulation
{
    public sealed class CargoRoutePlanner
    {
        public bool TryCreate(int gateIndex, int heat, GateRouteNode gate, float gateZ, out RunParcelCommand command)
        {
            if (gateIndex <= 2 || gateIndex % 4 != 2)
            {
                command = default;
                return false;
            }

            int count = 3 + (gateIndex % 4);
            float sign = ((gateIndex / 4) & 1) == 0 ? 1f : -1f;
            float offset = heat >= 2 ? 8f : 5f;
            RunCargoKind cargo = heat >= 4 && gateIndex % 12 == 6
                ? RunCargoKind.Prism
                : heat >= 1 && gateIndex % 8 == 6
                    ? RunCargoKind.Alloy
                    : RunCargoKind.Salvage;
            command = new RunParcelCommand(
                RunParcelCommandType.CargoTrail,
                gate.CenterX + sign * offset,
                gateZ - 18f,
                gate.CenterX,
                count,
                cargo);
            return true;
        }
    }

    public static class HazardPatternCatalog
    {
        public static LightningSequenceKind LightningFor(int heat, int beat)
            => heat == 0
                ? LightningSequenceKind.Random
                : (LightningSequenceKind)System.Math.Min(4, heat + beat);

        public static AsteroidSequenceKind AsteroidFor(int heat, int beat)
            => (AsteroidSequenceKind)System.Math.Min(5, heat - 2 + beat);
    }

    public sealed class EncounterSelector
    {
        public bool TrySelectHazard(
            int gateIndex,
            int heat,
            GateRouteNode gate,
            float gateZ,
            out RunParcelCommand command)
        {
            if (gateIndex != 9 && gateIndex != 20 && gateIndex != 31)
            {
                command = default;
                return false;
            }

            int beat = gateIndex == 9 ? 0 : gateIndex == 20 ? 1 : 2;
            if (heat < 2 || (heat >= 3 && beat == 1))
            {
                command = new RunParcelCommand(
                    RunParcelCommandType.LightningPattern,
                    gate.CenterX,
                    gateZ - 55f,
                    lightningSequence: HazardPatternCatalog.LightningFor(heat, beat),
                    safeCenterX: gate.CenterX,
                    safeHalfWidth: gate.HalfWidth);
            }
            else
            {
                command = new RunParcelCommand(
                    RunParcelCommandType.AsteroidPattern,
                    gate.CenterX,
                    gateZ - 15f,
                    asteroidSequence: HazardPatternCatalog.AsteroidFor(heat, beat),
                    safeCenterX: gate.CenterX,
                    safeHalfWidth: gate.HalfWidth);
            }
            return true;
        }
    }

    /// <summary>Composes one gate parcel from focused cargo and encounter planners.</summary>
    public sealed class RunParcelPlanner
    {
        readonly CargoRoutePlanner _cargo = new CargoRoutePlanner();
        readonly EncounterSelector _encounters = new EncounterSelector();

        public void Publish(
            int gateIndex,
            int heat,
            GateRouteNode gate,
            float gateZ,
            RunParcelCommandBuffer commands)
        {
            if (_cargo.TryCreate(gateIndex, heat, gate, gateZ, out RunParcelCommand cargo))
                commands.Add(cargo);

            if (gateIndex == 13)
                commands.Add(new RunParcelCommand(
                    RunParcelCommandType.Powerup,
                    gate.CenterX,
                    gateZ - 24f,
                    powerup: PowerupType.Laser));
            if (gateIndex == 16)
                commands.Add(new RunParcelCommand(
                    RunParcelCommandType.LaserFormation,
                    gate.CenterX,
                    gateZ - 8f,
                    safeCenterX: gate.CenterX,
                    safeHalfWidth: gate.HalfWidth));
            if (gateIndex == 7)
                commands.Add(new RunParcelCommand(
                    RunParcelCommandType.FatCone,
                    gate.CenterX + (gate.CenterX >= 0f ? 16f : -16f),
                    gateZ - 5f,
                    safeCenterX: gate.CenterX,
                    safeHalfWidth: gate.HalfWidth));

            if (_encounters.TrySelectHazard(gateIndex, heat, gate, gateZ, out RunParcelCommand hazard))
                commands.Add(hazard);
        }
    }
}
