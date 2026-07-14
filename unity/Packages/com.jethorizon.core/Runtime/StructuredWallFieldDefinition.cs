using System;

namespace JetHorizon.Simulation
{
    /// <summary>
    /// Engine-neutral geometry for the production structured angled-wall field.
    /// Positions describe wall mesh centers, so renderers and OBB collision consume
    /// exactly the same transform without recreating the old parent/child hierarchy.
    /// </summary>
    public sealed class StructuredWallFieldDefinition
    {
        public int RowCount { get; } = 20;
        public float RowSpacing { get; } = 50f;
        public float WallWidth { get; } = 22f;
        public float WallHeight { get; } = 4f;
        public float WallThickness { get; } = 0.3f;
        public float AngleDegrees { get; } = 35f;
        public float XOffset { get; } = 12f;
        public int CopiesX { get; } = 6;
        public float SpacingX { get; } = 42f;
        public int CopiesY { get; } = 2;
        public float SpacingY { get; } = 6f;
        public int CopiesZ { get; } = 2;
        public float SpacingZ { get; } = 5f;
        public float RotationXDegrees { get; } = -36f;
        public float FieldShift { get; } = -9.5f;

        public int WallsPerRow => CopiesX * CopiesY * CopiesZ;

        public HazardSpawn CreateWall(int row, int copyX, int copyY, int copyZ, float shipX, float spawnZ)
        {
            if (row < 0) throw new ArgumentOutOfRangeException(nameof(row));
            if (copyX < 0 || copyX >= CopiesX) throw new ArgumentOutOfRangeException(nameof(copyX));
            if (copyY < 0 || copyY >= CopiesY) throw new ArgumentOutOfRangeException(nameof(copyY));
            if (copyZ < 0 || copyZ >= CopiesZ) throw new ArgumentOutOfRangeException(nameof(copyZ));

            int angleSign = row % 2 == 0 ? 1 : -1;
            float baseX = shipX + angleSign * XOffset + FieldShift;
            float groupX = baseX - (CopiesX - 1) * SpacingX * 0.5f + copyX * SpacingX;
            float groupY = -(CopiesY - 1) * SpacingY * 0.5f + copyY * SpacingY;
            float groupZ = spawnZ - (CopiesZ - 1) * SpacingZ * 0.5f + copyZ * SpacingZ;

            float rotationX = DegreesToRadians(RotationXDegrees);
            float rotationY = DegreesToRadians(angleSign * AngleDegrees);

            // three.js Euler XYZ applies yaw before pitch. The mesh's local
            // half-height offset therefore gains world Y/Z components, but no X.
            float localCenterY = WallHeight * 0.5f;
            float centerY = groupY + (float)Math.Cos(rotationX) * localCenterY;
            float centerZ = groupZ + (float)Math.Sin(rotationX) * localCenterY;

            return HazardSpawn.Wall(
                groupX,
                centerY,
                centerZ,
                WallWidth,
                WallHeight,
                WallThickness,
                rotationX,
                rotationY,
                0f,
                HazardStyle.StructuredWall,
                0);
        }

        static float DegreesToRadians(float degrees) => degrees * (float)(Math.PI / 180.0);
    }

    public static class StructuredWallFieldCatalog
    {
        public static readonly StructuredWallFieldDefinition Production = new StructuredWallFieldDefinition();
    }
}
