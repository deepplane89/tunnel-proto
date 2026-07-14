using System.Collections.Generic;
using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Procedural meshes — everything in Jet Horizon except the ship GLB is generated
    /// (cones, octagon rings, coins, canyon slabs), so no model assets are needed.
    /// </summary>
    public static class MeshFactory
    {
        /// <summary>Cone: 6-sided like the JS ConeGeometry(1.6, h, 6). Base at y=0, tip +Y.</summary>
        public static Mesh Cone(float radius, float height, int segments = 6)
        {
            var verts = new List<Vector3>();
            var tris = new List<int>();
            var uvs = new List<Vector2>();
            Vector3 tip = new Vector3(0, height, 0);

            for (int i = 0; i < segments; i++)
            {
                float a0 = (i / (float)segments) * Mathf.PI * 2f;
                float a1 = ((i + 1) / (float)segments) * Mathf.PI * 2f;
                Vector3 b0 = new Vector3(Mathf.Cos(a0) * radius, 0, Mathf.Sin(a0) * radius);
                Vector3 b1 = new Vector3(Mathf.Cos(a1) * radius, 0, Mathf.Sin(a1) * radius);
                int v = verts.Count;
                verts.Add(b0); verts.Add(b1); verts.Add(tip);          // side (flat-shaded)
                uvs.Add(new Vector2(i / (float)segments, 0));
                uvs.Add(new Vector2((i + 1) / (float)segments, 0));
                uvs.Add(new Vector2((i + 0.5f) / segments, 1));
                tris.Add(v); tris.Add(v + 2); tris.Add(v + 1);
            }
            var m = new Mesh { name = "JH_Cone" };
            m.SetVertices(verts); m.SetTriangles(tris, 0); m.SetUVs(0, uvs);
            m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        /// <summary>Octagon torus — tube following an N-sided polygon in the XY plane (ring faces +Z).</summary>
        public static Mesh PolygonTorus(float ringRadius, float tubeRadius, int sides = 8, int tubeSegs = 10)
        {
            var verts = new List<Vector3>(); var tris = new List<int>(); var uvs = new List<Vector2>();
            int ringSegs = sides * 4; // subdivide each polygon edge for smoother tube path

            Vector3 PathPoint(float t)
            {
                // point along the N-gon perimeter, t in [0,1)
                float fSide = t * sides;
                int si = Mathf.FloorToInt(fSide);
                float frac = fSide - si;
                float a0 = (si / (float)sides) * Mathf.PI * 2f + Mathf.PI / sides;
                float a1 = ((si + 1) / (float)sides) * Mathf.PI * 2f + Mathf.PI / sides;
                Vector3 p0 = new Vector3(Mathf.Cos(a0), Mathf.Sin(a0), 0) * ringRadius;
                Vector3 p1 = new Vector3(Mathf.Cos(a1), Mathf.Sin(a1), 0) * ringRadius;
                return Vector3.Lerp(p0, p1, frac);
            }

            for (int i = 0; i <= ringSegs; i++)
            {
                float t = (i % ringSegs) / (float)ringSegs;
                Vector3 c = PathPoint(t);
                Vector3 cNext = PathPoint((t + 0.01f) % 1f);
                Vector3 tangent = (cNext - c).normalized;
                Vector3 radial = c.normalized;
                Vector3 binormal = Vector3.Cross(tangent, radial).normalized;
                radial = Vector3.Cross(binormal, tangent).normalized;

                for (int j = 0; j <= tubeSegs; j++)
                {
                    float phi = (j / (float)tubeSegs) * Mathf.PI * 2f;
                    Vector3 offset = radial * Mathf.Cos(phi) * tubeRadius + binormal * Mathf.Sin(phi) * tubeRadius;
                    verts.Add(c + offset);
                    uvs.Add(new Vector2(i / (float)ringSegs, j / (float)tubeSegs));
                }
            }
            int stride = tubeSegs + 1;
            for (int i = 0; i < ringSegs; i++)
                for (int j = 0; j < tubeSegs; j++)
                {
                    int a = i * stride + j;
                    tris.Add(a); tris.Add(a + stride); tris.Add(a + 1);
                    tris.Add(a + 1); tris.Add(a + stride); tris.Add(a + stride + 1);
                }
            var m = new Mesh { name = "JH_PolyTorus" };
            m.SetVertices(verts); m.SetTriangles(tris, 0); m.SetUVs(0, uvs);
            m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        /// <summary>
        /// Canyon slab (spec/02 §6, spec/03 §8): box H×W(Z-len)×thick(X) whose inner face is
        /// subdivided, jittered (disp), quantized (snap) and pushed outward by the
        /// foot→sweep→mid→crest profile. Non-indexed flat-shaded tri soup, crystalline look.
        /// Inner face at local x = 0, slab body extends +X (mirror with scale.x = -1 for left wall).
        /// </summary>
        public static Mesh CanyonSlab(float slabH, float slabW, float slabThick,
            int cols, int rows, float disp, float snap,
            float footX, float sweepX, float midX, float crestX, int seed)
        {
            var rnd = new System.Random(seed);
            float Rand() => (float)rnd.NextDouble();

            // Build inner-face grid: v (0..1 vertical), u along Z
            int nx = cols + 1, ny = rows + 1;
            var grid = new Vector3[nx, ny];
            for (int iy = 0; iy < ny; iy++)
            {
                float v = iy / (float)rows;
                // profile: piecewise outward X at v 0 / 0.15 / 0.45 / 0.85 / 1
                float profile;
                if (v < 0.15f)      profile = Mathf.Lerp(footX, sweepX, v / 0.15f);
                else if (v < 0.45f) profile = Mathf.Lerp(sweepX, midX, (v - 0.15f) / 0.30f);
                else if (v < 0.85f) profile = Mathf.Lerp(midX, crestX, (v - 0.45f) / 0.40f);
                else                profile = crestX;

                for (int ix = 0; ix < nx; ix++)
                {
                    float u = ix / (float)cols;
                    float jitter = (Rand() - 0.5f) * 2f * disp;
                    float x = profile + jitter;
                    if (snap > 0.01f) x = Mathf.Round(x / snap) * snap;   // quantize → jagged facets
                    float y = v * slabH;
                    float z = (u - 0.5f) * slabW;
                    if (snap > 0.01f) { y = Mathf.Round(y / snap) * snap; z = Mathf.Round(z / snap) * snap; }
                    grid[ix, iy] = new Vector3(x, y, z);
                }
            }

            var verts = new List<Vector3>(); var tris = new List<int>(); var uvs = new List<Vector2>();
            void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector2 ua, Vector2 ub, Vector2 uc, Vector2 ud)
            {
                int v0 = verts.Count;
                verts.Add(a); verts.Add(b); verts.Add(c); verts.Add(a); verts.Add(c); verts.Add(d);
                uvs.Add(ua); uvs.Add(ub); uvs.Add(uc); uvs.Add(ua); uvs.Add(uc); uvs.Add(ud);
                for (int i = 0; i < 6; i++) tris.Add(v0 + i);
            }

            // inner face (facing -X, toward corridor)
            for (int iy = 0; iy < rows; iy++)
                for (int ix = 0; ix < cols; ix++)
                {
                    Vector2 u00 = new Vector2(ix / (float)cols, iy / (float)rows);
                    Vector2 u10 = new Vector2((ix + 1f) / cols, iy / (float)rows);
                    Vector2 u11 = new Vector2((ix + 1f) / cols, (iy + 1f) / rows);
                    Vector2 u01 = new Vector2(ix / (float)cols, (iy + 1f) / rows);
                    Quad(grid[ix, iy], grid[ix, iy + 1], grid[ix + 1, iy + 1], grid[ix + 1, iy], u00, u01, u11, u10);
                }

            // outer shell (simple box back at x = slabThick)
            float bx = slabThick;
            Vector3 b0 = new Vector3(bx, 0, -slabW / 2), b1 = new Vector3(bx, 0, slabW / 2);
            Vector3 t0 = new Vector3(bx, slabH, -slabW / 2), t1 = new Vector3(bx, slabH, slabW / 2);
            Quad(b1, t1, t0, b0, Vector2.zero, Vector2.up, Vector2.one, Vector2.right); // back
            // top cap: connect inner top edge to back top edge
            Quad(grid[0, rows], new Vector3(bx, slabH, grid[0, rows].z),
                 new Vector3(bx, slabH, grid[cols, rows].z), grid[cols, rows],
                 Vector2.zero, Vector2.up, Vector2.one, Vector2.right);
            // front/rear Z caps
            Quad(grid[0, 0], grid[0, rows], new Vector3(bx, slabH, grid[0, rows].z), new Vector3(bx, 0, grid[0, 0].z),
                 Vector2.zero, Vector2.up, Vector2.one, Vector2.right);
            Quad(new Vector3(bx, 0, grid[cols, 0].z), new Vector3(bx, slabH, grid[cols, rows].z), grid[cols, rows], grid[cols, 0],
                 Vector2.zero, Vector2.up, Vector2.one, Vector2.right);

            var m = new Mesh { name = "JH_CanyonSlab", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            m.SetVertices(verts); m.SetTriangles(tris, 0); m.SetUVs(0, uvs);
            m.RecalculateNormals();   // non-indexed → flat shading
            m.RecalculateBounds();
            return m;
        }

        /// <summary>Coin disc — CylinderGeometry(0.46, 0.46, 0.14) facing the camera (axis Z).</summary>
        public static Mesh Coin(float radius = 0.46f, float thickness = 0.14f, int segs = 24)
        {
            var verts = new List<Vector3>(); var tris = new List<int>(); var uvs = new List<Vector2>();
            float hz = thickness / 2f;
            for (int cap = 0; cap < 2; cap++)
            {
                float z = cap == 0 ? -hz : hz;
                int center = verts.Count;
                verts.Add(new Vector3(0, 0, z)); uvs.Add(new Vector2(0.5f, 0.5f));
                for (int i = 0; i <= segs; i++)
                {
                    float a = i / (float)segs * Mathf.PI * 2f;
                    verts.Add(new Vector3(Mathf.Cos(a) * radius, Mathf.Sin(a) * radius, z));
                    uvs.Add(new Vector2(0.5f + Mathf.Cos(a) * 0.5f, 0.5f + Mathf.Sin(a) * 0.5f));
                }
                for (int i = 0; i < segs; i++)
                {
                    if (cap == 0) { tris.Add(center); tris.Add(center + 1 + i); tris.Add(center + 2 + i); }
                    else          { tris.Add(center); tris.Add(center + 2 + i); tris.Add(center + 1 + i); }
                }
            }
            var m = new Mesh { name = "JH_Coin" };
            m.SetVertices(verts); m.SetTriangles(tris, 0); m.SetUVs(0, uvs);
            m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }

        /// <summary>Placeholder ship (if GLB import isn't set up): stylized dart wing.</summary>
        public static Mesh PlaceholderShip()
        {
            var verts = new List<Vector3>
            {
                new Vector3(0, 0.35f, -4.2f),    // nose (forward = -Z, matches world scroll +Z)
                new Vector3(-5f, 0f, 4.6f),      // left wingtip
                new Vector3(5f, 0f, 4.6f),       // right wingtip
                new Vector3(0, 1.4f, 3.4f),      // dorsal
                new Vector3(0, -0.55f, 3.0f),    // keel
            };
            var tris = new List<int> { 0,3,1,  0,2,3,  0,1,4,  0,4,2,  3,2,1,  4,1,2 };
            var m = new Mesh { name = "JH_PlaceholderShip" };
            m.SetVertices(verts); m.SetTriangles(tris, 0);
            m.RecalculateNormals(); m.RecalculateBounds();
            return m;
        }
    }
}
