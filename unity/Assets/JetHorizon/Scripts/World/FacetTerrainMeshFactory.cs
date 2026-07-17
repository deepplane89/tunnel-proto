using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// The exact geometric vocabulary of the original Three.js canyon slab.
    /// This is Unity presentation data only; it does not own route or gameplay state.
    /// </summary>
    [Serializable]
    public struct FacetSurfaceStyle
    {
        public float Height;
        public float Length;
        public float Depth;
        public int Columns;
        public int Rows;
        public float Displacement;
        public float Snap;
        public float FootX;
        public float SweepX;
        public float MidX;
        public float CrestX;
        [Range(.05f, .65f)] public float PlateauShoulderFraction;
        [Range(0f, .08f)] public float PlateauUndulation;

        public static FacetSurfaceStyle ThreeJsSource => new FacetSurfaceStyle
        {
            Height = 55f,
            Length = 20f,
            Depth = 60f,
            Columns = 5,
            Rows = 6,
            Displacement = 4f,
            Snap = .7f,
            FootX = 9f,
            SweepX = 4f,
            MidX = 17f,
            CrestX = 20f,
            PlateauShoulderFraction = .20f,
            PlateauUndulation = .012f
        };

        public void Validate()
        {
            Height = Mathf.Max(.1f, Height);
            Length = Mathf.Max(.1f, Length);
            Depth = Mathf.Max(CrestX + .1f, Depth);
            Columns = Mathf.Max(1, Columns);
            Rows = Mathf.Max(2, Rows);
            Displacement = Mathf.Max(0f, Displacement);
            Snap = Mathf.Max(.0001f, Snap);
            PlateauShoulderFraction = Mathf.Clamp(PlateauShoulderFraction, .05f, .65f);
            PlateauUndulation = Mathf.Clamp(PlateauUndulation, 0f, .08f);
        }
    }

    public readonly struct FacetMassStation
    {
        public readonly float Z;
        public readonly float InnerX;
        public readonly float Height;
        public readonly float Depth;
        public readonly float ProfileScale;

        public FacetMassStation(float z, float innerX, float height, float depth, float profileScale = 1f)
        {
            Z = z;
            InnerX = innerX;
            Height = height;
            Depth = depth;
            ProfileScale = profileScale;
        }
    }

    /// <summary>
    /// Builds watertight, opaque terrain masses from the source slab's planar facet grammar.
    /// The parity slab intentionally preserves every source quirk. Larger masses keep the same
    /// profile, LCG, snap and flat triangle language while sharing their longitudinal seams.
    /// </summary>
    public static class FacetTerrainMeshFactory
    {
        sealed class SourceLcg
        {
            int _state;

            public SourceLcg(int seed) => _state = seed == 0 ? 1 : seed;

            public float Next()
            {
                _state = (_state * 9301 + 49297) % 233280;
                if (_state < 0) _state += 233280;
                return _state / 233280f;
            }
        }

        /// <summary>
        /// Byte-for-byte algorithm port of _buildCanyonSlabGeo's position construction.
        /// Local Z is 0..Length, matching Three.js rather than the older centered Unity port.
        /// </summary>
        public static Mesh BuildThreeJsParitySlab(FacetSurfaceStyle style, int seed)
        {
            style.Validate();
            var rng = new SourceLcg(seed);
            int cols = style.Columns;
            int rows = style.Rows;
            int stride = cols + 1;
            var inner = new Vector3[(rows + 1) * stride];

            for (int row = 0; row <= rows; row++)
            {
                float v = row / (float)rows;
                float profile = Profile(v, style);
                for (int column = 0; column <= cols; column++)
                {
                    float x = profile + (rng.Next() - .5f) * 2f * style.Displacement;
                    if (v > .8f)
                        x += (rng.Next() - .4f) * style.Displacement * (v - .8f) / .2f * 2f;
                    x = Mathf.Round(x * style.Snap) / style.Snap;
                    float y = v * style.Height;
                    if (v > .85f) y += (rng.Next() - .4f) * style.Height * .18f;
                    y = Mathf.Round(y * 1.5f) / 1.5f;
                    inner[row * stride + column] = new Vector3(x, y, column / (float)cols * style.Length);
                }
            }

            var writer = new TriangleWriter("JH_ThreeJsFacetParitySlab");
            int Index(int row, int column) => row * stride + column;

            // Inner face: the source order is significant for its characteristic diagonal facets.
            for (int row = 0; row < rows; row++)
            for (int column = 0; column < cols; column++)
            {
                int i00 = Index(row, column);
                int i10 = Index(row, column + 1);
                int i01 = Index(row + 1, column);
                int i11 = Index(row + 1, column + 1);
                float u0 = column / (float)cols;
                float u1 = (column + 1f) / cols;
                float v0 = row / (float)rows;
                float v1 = (row + 1f) / rows;
                writer.Triangle(inner[i00], inner[i01], inner[i10], new Vector2(u0, v0), new Vector2(u0, v1), new Vector2(u1, v0));
                writer.Triangle(inner[i10], inner[i01], inner[i11], new Vector2(u1, v0), new Vector2(u0, v1), new Vector2(u1, v1));
            }

            // Source back face is deliberately subdivided, not collapsed to one quad.
            for (int row = 0; row < rows; row++)
            for (int column = 0; column < cols; column++)
            {
                float z0 = column / (float)cols * style.Length;
                float z1 = (column + 1f) / cols * style.Length;
                float y0 = row / (float)rows * style.Height;
                float y1 = (row + 1f) / rows * style.Height;
                float u0 = column / (float)cols;
                float u1 = (column + 1f) / cols;
                float v0 = row / (float)rows;
                float v1 = (row + 1f) / rows;
                writer.Triangle(new Vector3(style.Depth, y0, z0), new Vector3(style.Depth, y0, z1), new Vector3(style.Depth, y1, z0), new Vector2(u0, v0), new Vector2(u1, v0), new Vector2(u0, v1));
                writer.Triangle(new Vector3(style.Depth, y0, z1), new Vector3(style.Depth, y1, z1), new Vector3(style.Depth, y1, z0), new Vector2(u1, v0), new Vector2(u1, v1), new Vector2(u0, v1));
            }

            for (int column = 0; column < cols; column++)
            {
                float u0 = column / (float)cols;
                float u1 = (column + 1f) / cols;
                Vector3 a = inner[Index(0, column)];
                Vector3 b = inner[Index(0, column + 1)];
                writer.Triangle(a, new Vector3(style.Depth, 0f, a.z), b, new Vector2(u0, 0f), new Vector2(u0, 0f), new Vector2(u1, 0f));
                writer.Triangle(new Vector3(style.Depth, 0f, a.z), new Vector3(style.Depth, 0f, b.z), b, new Vector2(u0, 0f), new Vector2(u1, 0f), new Vector2(u1, 0f));

                Vector3 crestA = inner[Index(rows, column)];
                Vector3 crestB = inner[Index(rows, column + 1)];
                float backY = style.Height * (.92f + rng.Next() * .08f);
                writer.Triangle(crestA, crestB, new Vector3(style.Depth, backY, crestA.z), new Vector2(u0, 1f), new Vector2(u1, 1f), new Vector2(u0, .8f));
                writer.Triangle(crestB, new Vector3(style.Depth, backY, crestB.z), new Vector3(style.Depth, backY, crestA.z), new Vector2(u1, 1f), new Vector2(u1, .8f), new Vector2(u0, .8f));
            }

            for (int row = 0; row < rows; row++)
            {
                float v0 = row / (float)rows;
                float v1 = (row + 1f) / rows;
                Vector3 nearA = inner[Index(row, 0)];
                Vector3 nearB = inner[Index(row + 1, 0)];
                writer.Triangle(nearA, new Vector3(style.Depth, nearA.y, 0f), nearB, new Vector2(0f, v0), new Vector2(1f, v0), new Vector2(0f, v1));
                writer.Triangle(new Vector3(style.Depth, nearA.y, 0f), new Vector3(style.Depth, nearB.y, 0f), nearB, new Vector2(1f, v0), new Vector2(1f, v1), new Vector2(0f, v1));

                Vector3 farA = inner[Index(row, cols)];
                Vector3 farB = inner[Index(row + 1, cols)];
                writer.Triangle(new Vector3(style.Depth, farA.y, style.Length), farA, new Vector3(style.Depth, farB.y, style.Length), new Vector2(1f, v0), new Vector2(0f, v0), new Vector2(1f, v1));
                writer.Triangle(farA, farB, new Vector3(style.Depth, farB.y, style.Length), new Vector2(0f, v0), new Vector2(0f, v1), new Vector2(1f, v1));
            }

            return writer.Build();
        }

        /// <summary>
        /// Builds one continuous closed land mass. Stations describe the large silhouette;
        /// the source facet grammar supplies the surface, so layout variation never turns
        /// into generic noise or spikes jutting from an otherwise smooth wall.
        /// </summary>
        public static Mesh BuildMass(IReadOnlyList<FacetMassStation> stations, FacetSurfaceStyle style, int seed, string name = "JH_FacetTerrainMass")
        {
            if (stations == null || stations.Count < 2) throw new ArgumentException("A facet mass requires at least two stations.", nameof(stations));
            style.Validate();
            for (int i = 1; i < stations.Count; i++)
                if (stations[i].Z <= stations[i - 1].Z)
                    throw new ArgumentException("Facet mass stations must be ordered by increasing Z.", nameof(stations));

            float startZ = stations[0].Z;
            float endZ = stations[stations.Count - 1].Z;
            int patchCount = Mathf.Max(1, Mathf.CeilToInt((endZ - startZ) / style.Length));
            int columnsPerPatch = style.Columns;
            int columns = patchCount * columnsPerPatch;
            int rows = style.Rows;
            int stride = columns + 1;
            var macro = new FacetMassStation[stride];
            var inner = new Vector3[(rows + 1) * stride];
            var plateauY = new float[stride];

            // Sparse stations control only the large silhouette. They never become
            // visible facet columns; the source 5x6 face retains its original scale.
            for (int column = 0; column <= columns; column++)
            {
                float z = Mathf.Lerp(startZ, endZ, column / (float)columns);
                macro[column] = SampleMacroStation(stations, z);
            }

            // Build each source-sized patch with the original row-major LCG order.
            // The first column after patch zero reuses the preceding patch's far edge:
            // the face remains geometrically closed without smoothing its flat facets.
            for (int patch = 0; patch < patchCount; patch++)
            {
                var rng = new SourceLcg(unchecked(seed + patch));
                for (int row = 0; row <= rows; row++)
                {
                    float v = row / (float)rows;
                    float profile = Profile(v, style);
                    for (int localColumn = 0; localColumn <= columnsPerPatch; localColumn++)
                    {
                        int column = patch * columnsPerPatch + localColumn;
                        FacetMassStation station = macro[column];
                        float localX = profile + (rng.Next() - .5f) * 2f * style.Displacement;
                        if (v > .8f)
                            localX += (rng.Next() - .4f) * style.Displacement * (v - .8f) / .2f * 2f;
                        localX = Mathf.Round(localX * style.Snap) / style.Snap;
                        float y = v * station.Height;
                        if (v > .85f) y += (rng.Next() - .4f) * station.Height * .18f;
                        y = Mathf.Round(y * 1.5f) / 1.5f;

                        // Consume the complete source RNG sequence above, but keep the
                        // already-authored far edge when this is a shared patch boundary.
                        if (patch > 0 && localColumn == 0) continue;
                        float scale = Mathf.Max(.05f, station.ProfileScale);
                        float x = station.InnerX + (localX - style.FootX) * scale;
                        inner[row * stride + column] = new Vector3(x, y, station.Z);
                    }
                }
            }

            for (int column = 0; column <= columns; column++)
            {
                float progress = column / (float)columns;
                float slowVariation = Mathf.Sin(progress * Mathf.PI * 2f + seed * .017f) * style.PlateauUndulation;
                plateauY[column] = macro[column].Height * (1.01f + slowVariation);
            }

            var writer = new TriangleWriter(name);
            int Index(int row, int column) => row * stride + column;
            for (int row = 0; row < rows; row++)
            for (int column = 0; column < columns; column++)
            {
                float u0 = column / (float)columnsPerPatch;
                float u1 = (column + 1f) / columnsPerPatch;
                float v0 = row / (float)rows;
                float v1 = (row + 1f) / rows;
                Vector3 p00 = inner[Index(row, column)];
                Vector3 p01 = inner[Index(row + 1, column)];
                Vector3 p10 = inner[Index(row, column + 1)];
                Vector3 p11 = inner[Index(row + 1, column + 1)];
                writer.Triangle(p00, p01, p10, new Vector2(u0, v0), new Vector2(u0, v1), new Vector2(u1, v0));
                writer.Triangle(p10, p01, p11, new Vector2(u1, v0), new Vector2(u0, v1), new Vector2(u1, v1));

                FacetMassStation a = macro[column];
                FacetMassStation b = macro[column + 1];
                Vector3 o00 = new Vector3(a.InnerX + a.Depth, v0 * plateauY[column], a.Z);
                Vector3 o01 = new Vector3(a.InnerX + a.Depth, v1 * plateauY[column], a.Z);
                Vector3 o10 = new Vector3(b.InnerX + b.Depth, v0 * plateauY[column + 1], b.Z);
                Vector3 o11 = new Vector3(b.InnerX + b.Depth, v1 * plateauY[column + 1], b.Z);
                writer.Triangle(o00, o10, o01, new Vector2(u0, v0), new Vector2(u1, v0), new Vector2(u0, v1));
                writer.Triangle(o10, o11, o01, new Vector2(u1, v0), new Vector2(u1, v1), new Vector2(u0, v1));
            }

            for (int column = 0; column < columns; column++)
            {
                FacetMassStation a = macro[column];
                FacetMassStation b = macro[column + 1];
                float u0 = column / (float)columnsPerPatch;
                float u1 = (column + 1f) / columnsPerPatch;
                Vector3 bottomA = inner[Index(0, column)];
                Vector3 bottomB = inner[Index(0, column + 1)];
                Vector3 outerBottomA = new Vector3(a.InnerX + a.Depth, 0f, a.Z);
                Vector3 outerBottomB = new Vector3(b.InnerX + b.Depth, 0f, b.Z);
                writer.Quad(bottomA, outerBottomA, bottomB, outerBottomB, new Vector2(u0, 0f), new Vector2(u0, 1f), new Vector2(u1, 0f), new Vector2(u1, 1f));

                Vector3 crestA = inner[Index(rows, column)];
                Vector3 crestB = inner[Index(rows, column + 1)];
                Vector3 outerTopA = new Vector3(a.InnerX + a.Depth, plateauY[column], a.Z);
                Vector3 outerTopB = new Vector3(b.InnerX + b.Depth, plateauY[column + 1], b.Z);
                Vector3 shoulderA = new Vector3(
                    Mathf.Lerp(crestA.x, outerTopA.x, style.PlateauShoulderFraction),
                    plateauY[column], a.Z);
                Vector3 shoulderB = new Vector3(
                    Mathf.Lerp(crestB.x, outerTopB.x, style.PlateauShoulderFraction),
                    plateauY[column + 1], b.Z);
                // Short angular shoulder; the remaining majority of the roof is a
                // broad plateau rather than one long slope to the hidden outer wall.
                writer.Quad(crestA, crestB, shoulderA, shoulderB,
                    new Vector2(u0, 1f), new Vector2(u1, 1f), new Vector2(u0, .88f), new Vector2(u1, .88f));
                writer.Quad(shoulderA, shoulderB, outerTopA, outerTopB,
                    new Vector2(u0, .88f), new Vector2(u1, .88f), new Vector2(u0, .72f), new Vector2(u1, .72f));
            }

            AddEndCap(0, false);
            AddEndCap(columns, true);

            void AddEndCap(int column, bool reverse)
            {
                FacetMassStation station = macro[column];
                float outerX = station.InnerX + station.Depth;
                for (int row = 0; row < rows; row++)
                {
                    float v0 = row / (float)rows;
                    float v1 = (row + 1f) / rows;
                    Vector3 innerA = inner[Index(row, column)];
                    Vector3 innerB = inner[Index(row + 1, column)];
                    float outerY0 = Mathf.Lerp(0f, plateauY[column], v0);
                    float outerY1 = Mathf.Lerp(0f, plateauY[column], v1);
                    Vector3 outerA = new Vector3(outerX, outerY0, station.Z);
                    Vector3 outerB = new Vector3(outerX, outerY1, station.Z);
                    if (reverse)
                        writer.Quad(outerA, innerA, outerB, innerB,
                            new Vector2(1f, v0), new Vector2(0f, v0), new Vector2(1f, v1), new Vector2(0f, v1));
                    else
                        writer.Quad(innerA, outerA, innerB, outerB,
                            new Vector2(0f, v0), new Vector2(1f, v0), new Vector2(0f, v1), new Vector2(1f, v1));
                }
            }

            return writer.Build();
        }

        static FacetMassStation SampleMacroStation(IReadOnlyList<FacetMassStation> stations, float z)
        {
            if (z <= stations[0].Z) return stations[0];
            int last = stations.Count - 1;
            if (z >= stations[last].Z) return stations[last];
            int segment = 0;
            while (segment < last - 1 && z > stations[segment + 1].Z) segment++;
            FacetMassStation a = stations[Mathf.Max(0, segment - 1)];
            FacetMassStation b = stations[segment];
            FacetMassStation c = stations[segment + 1];
            FacetMassStation d = stations[Mathf.Min(last, segment + 2)];
            float t = Mathf.InverseLerp(b.Z, c.Z, z);
            return new FacetMassStation(
                z,
                Catmull(a.InnerX, b.InnerX, c.InnerX, d.InnerX, t),
                Mathf.Max(4f, Catmull(a.Height, b.Height, c.Height, d.Height, t)),
                Mathf.Max(8f, Catmull(a.Depth, b.Depth, c.Depth, d.Depth, t)),
                Mathf.Max(.05f, Catmull(a.ProfileScale, b.ProfileScale, c.ProfileScale, d.ProfileScale, t)));
        }

        static float Catmull(float a, float b, float c, float d, float t)
        {
            float t2 = t * t;
            float t3 = t2 * t;
            return .5f * ((2f * b) + (-a + c) * t
                + (2f * a - 5f * b + 4f * c - d) * t2
                + (-a + 3f * b - 3f * c + d) * t3);
        }

        public static bool SameVertexData(Mesh a, Mesh b)
        {
            if (a == null || b == null || a.vertexCount != b.vertexCount) return false;
            Vector3[] av = a.vertices;
            Vector3[] bv = b.vertices;
            for (int i = 0; i < av.Length; i++) if (av[i] != bv[i]) return false;
            int[] at = a.triangles;
            int[] bt = b.triangles;
            if (at.Length != bt.Length) return false;
            for (int i = 0; i < at.Length; i++) if (at[i] != bt[i]) return false;
            return true;
        }

        static float Profile(float v, FacetSurfaceStyle style)
        {
            if (v < .15f) return Mathf.Lerp(style.FootX, style.SweepX, v / .15f);
            if (v < .45f) return Mathf.Lerp(style.SweepX, style.MidX, (v - .15f) / .30f);
            if (v < .85f) return Mathf.Lerp(style.MidX, style.CrestX, (v - .45f) / .40f);
            return style.CrestX;
        }

        sealed class TriangleWriter
        {
            readonly string _name;
            readonly List<Vector3> _vertices = new List<Vector3>();
            readonly List<Vector2> _uv = new List<Vector2>();
            readonly List<Color> _colors = new List<Color>();
            readonly List<int> _triangles = new List<int>();

            public TriangleWriter(string name) => _name = name;

            public void Triangle(Vector3 a, Vector3 b, Vector3 c, Vector2 uvA, Vector2 uvB, Vector2 uvC)
            {
                int index = _vertices.Count;
                _vertices.Add(a); _vertices.Add(b); _vertices.Add(c);
                _uv.Add(uvA); _uv.Add(uvB); _uv.Add(uvC);
                _colors.Add(Color.white); _colors.Add(Color.white); _colors.Add(Color.white);
                _triangles.Add(index); _triangles.Add(index + 1); _triangles.Add(index + 2);
            }

            public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector2 uvA, Vector2 uvB, Vector2 uvC, Vector2 uvD)
            {
                Triangle(a, b, c, uvA, uvB, uvC);
                Triangle(c, b, d, uvC, uvB, uvD);
            }

            public Mesh Build()
            {
                var mesh = new Mesh { name = _name, indexFormat = IndexFormat.UInt32 };
                mesh.SetVertices(_vertices);
                mesh.SetUVs(0, _uv);
                mesh.SetColors(_colors);
                mesh.SetTriangles(_triangles, 0);
                mesh.RecalculateNormals();
                mesh.RecalculateBounds();
                return mesh;
            }
        }
    }
}
