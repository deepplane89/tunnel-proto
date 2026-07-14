namespace JetHorizon.Simulation
{
    /// <summary>
    /// Engine-neutral production tuning copied from the Three.js game. Rendering
    /// adapters may use the color and label, but gameplay consumes only these values.
    /// </summary>
    public readonly struct PowerupDefinition
    {
        public readonly PowerupType Type;
        public readonly string Id;
        public readonly string Label;
        public readonly int ColorRgb;
        public readonly float DurationSeconds;
        public readonly float GraceSeconds;
        public readonly float Radius;
        public readonly int HitPoints;

        public PowerupDefinition(
            PowerupType type,
            string id,
            string label,
            int colorRgb,
            float durationSeconds,
            float graceSeconds = 0f,
            float radius = 0f,
            int hitPoints = 0)
        {
            Type = type;
            Id = id;
            Label = label;
            ColorRgb = colorRgb;
            DurationSeconds = durationSeconds;
            GraceSeconds = graceSeconds;
            Radius = radius;
            HitPoints = hitPoints;
        }
    }

    public static class PowerupCatalog
    {
        public const float LaserFireRate = 8.5f;
        public const float OverdriveSpeedMultiplier = 1.8f;

        public static readonly PowerupDefinition Shield = new PowerupDefinition(
            PowerupType.Shield, "shield", "SHIELD", 0x00f0ff, 10f, hitPoints: 1);
        public static readonly PowerupDefinition Laser = new PowerupDefinition(
            PowerupType.Laser, "laser", "LASER", 0xff2200, 4f);
        public static readonly PowerupDefinition Overdrive = new PowerupDefinition(
            PowerupType.Overdrive, "invincible", "OVERDRIVE", 0xffcc00, 5f, graceSeconds: 2f);
        public static readonly PowerupDefinition Magnet = new PowerupDefinition(
            PowerupType.Magnet, "magnet", "MAGNET", 0x44ff88, 4f, radius: 18f);

        public static PowerupDefinition Get(PowerupType type)
        {
            switch (type)
            {
                case PowerupType.Shield: return Shield;
                case PowerupType.Laser: return Laser;
                case PowerupType.Overdrive: return Overdrive;
                case PowerupType.Magnet: return Magnet;
                default: return default;
            }
        }
    }
}
