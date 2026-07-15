using System;
using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    public readonly struct CanyonRouteFrame
    {
        public readonly float Distance;
        public readonly float Progress;
        public readonly Vector3 Center;
        public readonly Vector3 Forward;
        public readonly Vector3 Right;
        public readonly Vector3 Up;
        public readonly float HalfWidth;

        public CanyonRouteFrame(
            float distance,
            float progress,
            Vector3 center,
            Vector3 forward,
            Vector3 right,
            Vector3 up,
            float halfWidth)
        {
            Distance = distance;
            Progress = progress;
            Center = center;
            Forward = forward;
            Right = right;
            Up = up;
            HalfWidth = halfWidth;
        }
    }

    /// <summary>
    /// Unity presentation adapter over the immutable engine-neutral canyon definition.
    /// Cardinal interpolation makes the authoring knots a real curved route while the
    /// gameplay core continues to own openings, reachability and lethal boundaries.
    /// </summary>
    public sealed class CanyonRouteSampler
    {
        readonly EncounterPlan _plan;
        readonly HybridCanyonWorldSettings _settings;

        public float Length => _plan.Length;

        public CanyonRouteSampler(EncounterPlan plan, HybridCanyonWorldSettings settings)
        {
            _plan = plan ?? throw new ArgumentNullException(nameof(plan));
            _settings = settings ?? throw new ArgumentNullException(nameof(settings));
        }

        public CanyonRouteFrame Sample(float distance)
        {
            distance = Mathf.Clamp(distance, 0f, _plan.Length);
            SampleScalar(distance, opening => opening.CenterX, 0f, out float centerX);
            SampleScalar(distance, opening => opening.HalfWidth, _plan.GetOpening(0).HalfWidth + 24f, out float halfWidth);

            const float derivativeSpan = 1f;
            SampleScalar(Mathf.Max(0f, distance - derivativeSpan), opening => opening.CenterX, 0f, out float beforeX);
            SampleScalar(Mathf.Min(_plan.Length, distance + derivativeSpan), opening => opening.CenterX, 0f, out float afterX);
            Vector3 forward = new Vector3(beforeX - afterX, 0f, 2f * derivativeSpan).normalized;
            if (forward.sqrMagnitude < .5f) forward = Vector3.forward;

            Vector3 right = Vector3.Cross(Vector3.up, forward).normalized;
            float progress = distance / Mathf.Max(1f, _plan.Length);
            float bank = Evaluate(_settings.BankDegreesByProgress, progress, 0f);
            Quaternion roll = Quaternion.AngleAxis(bank, forward);
            right = roll * right;
            Vector3 up = Vector3.Cross(forward, right).normalized;
            return new CanyonRouteFrame(
                distance,
                progress,
                new Vector3(centerX, 0f, -distance),
                forward,
                right,
                up,
                Mathf.Max(2f, halfWidth));
        }

        void SampleScalar(float distance, Func<EncounterOpening, float> value, float approachValue, out float result)
        {
            EncounterOpening first = _plan.GetOpening(0);
            if (distance <= first.Distance)
            {
                float t = Smooth(Mathf.InverseLerp(0f, Mathf.Max(1f, first.Distance), distance));
                result = Mathf.Lerp(approachValue, value(first), t);
                return;
            }

            for (int i = 1; i < _plan.OpeningCount; i++)
            {
                EncounterOpening b = _plan.GetOpening(i);
                if (distance > b.Distance) continue;
                EncounterOpening a = _plan.GetOpening(i - 1);
                EncounterOpening previous = _plan.GetOpening(Mathf.Max(0, i - 2));
                EncounterOpening next = _plan.GetOpening(Mathf.Min(_plan.OpeningCount - 1, i + 1));
                float span = Mathf.Max(.001f, b.Distance - a.Distance);
                float t = Mathf.Clamp01((distance - a.Distance) / span);
                float tension = Mathf.Clamp01(_settings.PathTension);
                float m0 = (value(b) - value(previous)) * .5f * (1f - tension);
                float m1 = (value(next) - value(a)) * .5f * (1f - tension);
                result = Hermite(value(a), value(b), m0, m1, t);
                return;
            }

            EncounterOpening last = _plan.GetOpening(_plan.OpeningCount - 1);
            result = value(last);
        }

        static float Hermite(float a, float b, float tangentA, float tangentB, float t)
        {
            float t2 = t * t;
            float t3 = t2 * t;
            return (2f * t3 - 3f * t2 + 1f) * a
                + (t3 - 2f * t2 + t) * tangentA
                + (-2f * t3 + 3f * t2) * b
                + (t3 - t2) * tangentB;
        }

        static float Smooth(float t) => t * t * (3f - 2f * t);

        public static float Evaluate(AnimationCurve curve, float t, float fallback)
            => curve != null && curve.length > 0 ? curve.Evaluate(Mathf.Clamp01(t)) : fallback;
    }

    [DisallowMultipleComponent]
    public sealed class CanyonWallChunkMarker : MonoBehaviour
    {
        public int Side;
        public int FirstVisualPatch;
        public int VisualPatchCount;
        public float StartDistance;
        public float EndDistance;
    }

    /// <summary>
    /// Generates opaque, thick, flat-faceted wall shells. A visual patch preserves the
    /// source slab's 5x6 / 9-4-17-20 DNA, but every longitudinal column samples the
    /// curved route independently. Adjacent patches and mobile chunks therefore share
    /// identical mathematical boundary edges without behaving like rigid prefab slabs.
    /// </summary>
    public static class CanyonCurvedWallBuilder
    {
        public static GameObject Build(
            CanyonRouteSampler route,
            HybridCanyonWorldSettings settings,
            float startDistance,
            float endDistance,
            Transform parent,
            Material material,
            IList<UnityEngine.Object> ownedAssets)
        {
            if (route == null || settings == null || parent == null) return null;
            float patchLength = Mathf.Max(4f, settings.SlabLength);
            startDistance = Mathf.Clamp(startDistance, 0f, route.Length);
            endDistance = Mathf.Clamp(endDistance, startDistance + patchLength, route.Length);
            int patchCount = Mathf.Max(1, Mathf.CeilToInt((endDistance - startDistance) / patchLength));
            patchLength = (endDistance - startDistance) / patchCount;
            int patchesPerChunk = Mathf.Max(1, Mathf.RoundToInt(Mathf.Max(patchLength, settings.WallChunkLength) / patchLength));

            var root = new GameObject("Spline-Extruded Faceted Canyon Walls");
            root.layer = 8;
            root.transform.SetParent(parent, false);

            for (int side = -1; side <= 1; side += 2)
            {
                for (int firstPatch = 0; firstPatch < patchCount; firstPatch += patchesPerChunk)
                {
                    int count = Mathf.Min(patchesPerChunk, patchCount - firstPatch);
                    float chunkStart = startDistance + firstPatch * patchLength;
                    float chunkEnd = Mathf.Min(endDistance, chunkStart + count * patchLength);
                    Mesh mesh = BuildChunkMesh(route, settings, side, firstPatch, count, startDistance, patchLength, chunkStart, chunkEnd,
                        firstPatch == 0, firstPatch + count == patchCount);
                    ownedAssets?.Add(mesh);

                    var chunk = new GameObject($"Curved Wall Chunk {(side < 0 ? "L" : "R")} {firstPatch / patchesPerChunk:00}");
                    chunk.layer = 8;
                    chunk.transform.SetParent(root.transform, false);
                    chunk.AddComponent<MeshFilter>().sharedMesh = mesh;
                    var renderer = chunk.AddComponent<MeshRenderer>();
                    renderer.sharedMaterial = material;
                    renderer.shadowCastingMode = settings.CastMeshShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
                    renderer.receiveShadows = settings.ReceiveMeshShadows;
                    var marker = chunk.AddComponent<CanyonWallChunkMarker>();
                    marker.Side = side;
                    marker.FirstVisualPatch = firstPatch;
                    marker.VisualPatchCount = count;
                    marker.StartDistance = chunkStart;
                    marker.EndDistance = chunkEnd;
                }
            }
            return root;
        }

        static Mesh BuildChunkMesh(
            CanyonRouteSampler route,
            HybridCanyonWorldSettings settings,
            int side,
            int firstPatch,
            int patchCount,
            float routeStart,
            float patchLength,
            float chunkStart,
            float chunkEnd,
            bool capNear,
            bool capFar)
        {
            int columnsPerPatch = Mathf.Max(2, settings.SlabColumns);
            int rows = Mathf.Max(2, settings.SlabRows);
            int columns = patchCount * columnsPerPatch;
            var inner = new Vector3[columns + 1, rows + 1];
            var outer = new Vector3[columns + 1, rows + 1];
            float visualClearance = Mathf.Max(0f, settings.SlabFootX - settings.SlabSweepX)
                + Mathf.Max(0f, settings.SlabDisplacement) + .75f;

            for (int column = 0; column <= columns; column++)
            {
                int globalColumn = firstPatch * columnsPerPatch + column;
                float distance = Mathf.Min(chunkEnd, routeStart + globalColumn * patchLength / columnsPerPatch);
                CanyonRouteFrame frame = route.Sample(distance);
                Vector3 outward = frame.Right * side;
                Vector3 foot = frame.Center + outward * (frame.HalfWidth + visualClearance);
                float wallHeightScale = Mathf.Max(.1f, CanyonRouteSampler.Evaluate(settings.WallHeightByProgress, frame.Progress, 1f));
                float wallHeight = settings.SlabHeight * wallHeightScale;

                for (int row = 0; row <= rows; row++)
                {
                    float v = row / (float)rows;
                    float face = SourceProfile(v, settings)
                        + SignedHash(settings.Seed, globalColumn, row, side) * settings.SlabDisplacement;
                    if (settings.SlabSnap > .01f)
                        face = Mathf.Round(face * settings.SlabSnap) / settings.SlabSnap;

                    float y = v * wallHeight;
                    if (v > .85f)
                        y += (Hash01(settings.Seed + 307, globalColumn, row, side) - .4f) * wallHeight * .18f;
                    y = Mathf.Round(y * 1.5f) / 1.5f;

                    inner[column, row] = foot
                        + outward * (face - settings.SlabFootX)
                        + frame.Up * (settings.SlabBaseY + y);
                    outer[column, row] = foot
                        + outward * (settings.SlabThickness + settings.TerrainLipEmbedDepth)
                        + frame.Up * (settings.SlabBaseY + Mathf.Lerp(-settings.BottomSkirtDepth, wallHeight, v));
                }
            }

            var vertices = new List<Vector3>(columns * rows * 36);
            var uv = new List<Vector2>(columns * rows * 36);
            var colors = new List<Color>(columns * rows * 36);
            var triangles = new List<int>(columns * rows * 36);

            void AddTriangle(Vector3 a, Vector3 b, Vector3 c, Vector2 ta, Vector2 tb, Vector2 tc, float shade)
            {
                int index = vertices.Count;
                vertices.Add(a);
                uv.Add(ta);
                if (side > 0)
                {
                    vertices.Add(b); vertices.Add(c);
                    uv.Add(tb); uv.Add(tc);
                }
                else
                {
                    // The left shell is a mirror of the right shell. Reverse every
                    // triangle so back-face culling can never make that wall transparent.
                    vertices.Add(c); vertices.Add(b);
                    uv.Add(tc); uv.Add(tb);
                }
                Color tint = new Color(shade, shade, shade, 1f);
                colors.Add(tint); colors.Add(tint); colors.Add(tint);
                triangles.Add(index); triangles.Add(index + 1); triangles.Add(index + 2);
            }

            void AddQuad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector2 ta, Vector2 tb, Vector2 tc, Vector2 td, float shade)
            {
                AddTriangle(a, b, c, ta, tb, tc, shade);
                AddTriangle(c, b, d, tc, tb, td, shade);
            }

            for (int column = 0; column < columns; column++)
            {
                float u0 = (firstPatch * columnsPerPatch + column) / (float)columnsPerPatch;
                float u1 = (firstPatch * columnsPerPatch + column + 1f) / columnsPerPatch;
                for (int row = 0; row < rows; row++)
                {
                    float v0 = row / (float)rows;
                    float v1 = (row + 1f) / rows;
                    AddQuad(inner[column, row], inner[column, row + 1], inner[column + 1, row], inner[column + 1, row + 1],
                        new Vector2(u0, v0), new Vector2(u0, v1), new Vector2(u1, v0), new Vector2(u1, v1), 1f);
                    AddQuad(outer[column + 1, row], outer[column + 1, row + 1], outer[column, row], outer[column, row + 1],
                        new Vector2(u1, v0), new Vector2(u1, v1), new Vector2(u0, v0), new Vector2(u0, v1), .66f);
                }

                AddQuad(inner[column, 0], outer[column, 0], inner[column + 1, 0], outer[column + 1, 0],
                    new Vector2(u0, 0f), new Vector2(u0, 1f), new Vector2(u1, 0f), new Vector2(u1, 1f), .72f);
                AddQuad(inner[column + 1, rows], outer[column + 1, rows], inner[column, rows], outer[column, rows],
                    new Vector2(u1, 0f), new Vector2(u1, 1f), new Vector2(u0, 0f), new Vector2(u0, 1f), .84f);
            }

            if (capNear || capFar)
            {
                for (int row = 0; row < rows; row++)
                {
                    float v0 = row / (float)rows;
                    float v1 = (row + 1f) / rows;
                    if (capNear)
                        AddQuad(inner[0, row], inner[0, row + 1], outer[0, row], outer[0, row + 1],
                            new Vector2(firstPatch, v0), new Vector2(firstPatch, v1), new Vector2(firstPatch + 1f, v0), new Vector2(firstPatch + 1f, v1), .76f);
                    if (capFar)
                        AddQuad(outer[columns, row], outer[columns, row + 1], inner[columns, row], inner[columns, row + 1],
                            new Vector2(firstPatch + patchCount, v0), new Vector2(firstPatch + patchCount, v1),
                            new Vector2(firstPatch + patchCount - 1f, v0), new Vector2(firstPatch + patchCount - 1f, v1), .76f);
                }
            }

            var mesh = new Mesh
            {
                name = $"JH_CurvedCanyon_{(side < 0 ? "L" : "R")}_{firstPatch:000}",
                indexFormat = IndexFormat.UInt32
            };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, uv);
            mesh.SetColors(colors);
            mesh.SetTriangles(triangles, 0);
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        static float SourceProfile(float v, HybridCanyonWorldSettings settings)
        {
            if (v < .15f) return Mathf.Lerp(settings.SlabFootX, settings.SlabSweepX, v / .15f);
            if (v < .45f) return Mathf.Lerp(settings.SlabSweepX, settings.SlabMidX, (v - .15f) / .30f);
            if (v < .85f) return Mathf.Lerp(settings.SlabMidX, settings.SlabCrestX, (v - .45f) / .40f);
            return settings.SlabCrestX;
        }

        static float SignedHash(int seed, int longitudinal, int vertical, int side)
        {
            unchecked
            {
                uint value = (uint)seed;
                value ^= (uint)(longitudinal * 374761393);
                value ^= (uint)(vertical * 668265263);
                value ^= side < 0 ? 0x9E3779B9u : 0x85EBCA6Bu;
                value = (value ^ (value >> 13)) * 1274126177u;
                value ^= value >> 16;
                return value / (float)uint.MaxValue * 2f - 1f;
            }
        }

        static float Hash01(int seed, int longitudinal, int vertical, int side)
            => SignedHash(seed, longitudinal, vertical, side) * .5f + .5f;
    }
}
