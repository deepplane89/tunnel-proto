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
        readonly float _thresholdStart;
        readonly float _breakupStart;

        public float Length => _plan.Length;
        public float ThresholdStartDistance => _thresholdStart;
        public float BreakupStartDistance => _breakupStart;

        public CanyonRouteSampler(EncounterPlan plan, HybridCanyonWorldSettings settings)
        {
            _plan = plan ?? throw new ArgumentNullException(nameof(plan));
            _settings = settings ?? throw new ArgumentNullException(nameof(settings));
            _thresholdStart = FindFirstPhaseDistance(CanyonEnvironmentPhase.Threshold, _plan.Length * .25f);
            _breakupStart = FindFirstPhaseDistance(CanyonEnvironmentPhase.Breakup, _plan.Length * .82f);
        }

        /// <summary>
        /// Presentation-only exit envelope over the core-authored environment phases.
        /// The solid region begins at full-height threshold geometry and sinks below
        /// the water only during breakup.
        /// </summary>
        public float EnclosureAtDistance(float distance)
        {
            if (distance <= _breakupStart) return 1f;
            float breakup = Smooth(Mathf.InverseLerp(_breakupStart, _plan.Length, distance));
            return Mathf.Lerp(1f, Mathf.Clamp01(_settings.ExitSubmergedHeight), breakup);
        }

        public float WallRetreatAtDistance(float distance)
            => (1f - EnclosureAtDistance(distance)) * Mathf.Max(0f, _settings.ExitWallRetreat);

        float FindFirstPhaseDistance(CanyonEnvironmentPhase phase, float fallback)
        {
            for (int i = 0; i < _plan.OpeningCount; i++)
                if (_plan.GetOpening(i).EnvironmentPhase == phase) return _plan.GetOpening(i).Distance;
            return fallback;
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
    public sealed class SolidCanyonRegionMarker : MonoBehaviour
    {
        public float StartDistance;
        public float EndDistance;
        public int LongitudinalColumns;
        public int TriangleCount;
    }

    /// <summary>
    /// Generates one opaque carved landmass for the complete canyon. The source slab's
    /// 5x6 / 9-4-17-20 profile is retained only as the inner-wall faceting language;
    /// there are no independently streamed wall pieces or per-row activation seams.
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
            float sampleSpacing = Mathf.Max(2f, settings.SlabLength / Mathf.Max(2, settings.SlabColumns));
            startDistance = Mathf.Clamp(startDistance, 0f, route.Length - sampleSpacing);
            endDistance = Mathf.Clamp(endDistance, startDistance + sampleSpacing, route.Length);
            int columns = Mathf.Max(2, Mathf.CeilToInt((endDistance - startDistance) / sampleSpacing));

            var root = new GameObject("Solid Carved Canyon Region");
            root.layer = 8;
            root.transform.SetParent(parent, false);

            Mesh mesh = BuildRegionMesh(route, settings, startDistance, endDistance, columns);
            ownedAssets?.Add(mesh);
            root.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = root.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = settings.CastMeshShadows ? ShadowCastingMode.On : ShadowCastingMode.Off;
            renderer.receiveShadows = settings.ReceiveMeshShadows;
            var marker = root.AddComponent<SolidCanyonRegionMarker>();
            marker.StartDistance = startDistance;
            marker.EndDistance = endDistance;
            marker.LongitudinalColumns = columns;
            marker.TriangleCount = mesh.triangles.Length / 3;
            return root;
        }

        static Mesh BuildRegionMesh(
            CanyonRouteSampler route,
            HybridCanyonWorldSettings settings,
            float startDistance,
            float endDistance,
            int columns)
        {
            int rows = Mathf.Max(2, settings.SlabRows);
            int topBands = Mathf.Max(2, settings.SolidLandmassTopBands);
            var inner = new Vector3[2, columns + 1, rows + 1];
            var top = new Vector3[2, columns + 1, topBands + 1];
            var outerBottom = new Vector3[2, columns + 1];
            float visualClearance = Mathf.Max(0f, settings.SlabFootX - settings.SlabSweepX)
                + Mathf.Max(0f, settings.SlabDisplacement) + .75f;

            for (int column = 0; column <= columns; column++)
            {
                float distance = Mathf.Lerp(startDistance, endDistance, column / (float)columns);
                CanyonRouteFrame frame = route.Sample(distance);
                float enclosure = route.EnclosureAtDistance(distance);
                float wallHeightScale = Mathf.Max(.1f, CanyonRouteSampler.Evaluate(settings.WallHeightByProgress, frame.Progress, 1f));
                float wallHeight = settings.SlabHeight * wallHeightScale * enclosure;
                for (int sideIndex = 0; sideIndex < 2; sideIndex++)
                {
                    int side = sideIndex == 0 ? -1 : 1;
                    Vector3 outward = frame.Right * side;
                    Vector3 foot = frame.Center + outward * (
                        frame.HalfWidth + visualClearance + route.WallRetreatAtDistance(distance));
                    for (int row = 0; row <= rows; row++)
                    {
                        float v = row / (float)rows;
                        float face = SourceProfile(v, settings)
                            + SignedHash(settings.Seed, column, row, side) * settings.SlabDisplacement;
                        if (settings.SlabSnap > .01f)
                            face = Mathf.Round(face * settings.SlabSnap) / settings.SlabSnap;
                        float y = v * wallHeight;
                        if (v > .85f)
                            y += (Hash01(settings.Seed + 307, column, row, side) - .4f) * wallHeight * .12f;
                        y = Mathf.Round(y * 1.5f) / 1.5f;
                        inner[sideIndex, column, row] = foot
                            + outward * (face - settings.SlabFootX)
                            + frame.Up * (settings.SlabBaseY + y);
                    }

                    Vector3 crest = inner[sideIndex, column, rows];
                    float outerWidth = Mathf.Max(settings.SolidLandmassHalfWidth,
                        frame.HalfWidth + visualClearance + settings.SlabThickness);
                    for (int band = 0; band <= topBands; band++)
                    {
                        float t = band / (float)topBands;
                        float shoulderNoise = SignedHash(settings.Seed + 811, column, band, side)
                            * settings.SolidLandmassTopNoise * Mathf.Sin(t * Mathf.PI);
                        Vector3 outerTarget = frame.Center
                            + outward * outerWidth
                            + frame.Up * (settings.SolidLandmassOuterTopY * enclosure + shoulderNoise);
                        top[sideIndex, column, band] = Vector3.Lerp(crest, outerTarget, t);
                    }
                    outerBottom[sideIndex, column] = frame.Center
                        + outward * outerWidth
                        + Vector3.up * settings.SolidLandmassBaseY;
                }
            }

            var vertices = new List<Vector3>(columns * (rows + topBands + 4) * 36);
            var uv = new List<Vector2>(vertices.Capacity);
            var colors = new List<Color>(vertices.Capacity);
            var triangles = new List<int>(vertices.Capacity);

            void AddTriangle(Vector3 a, Vector3 b, Vector3 c, Vector2 ta, Vector2 tb, Vector2 tc, float shade)
            {
                int index = vertices.Count;
                vertices.Add(a);
                vertices.Add(b);
                vertices.Add(c);
                uv.Add(ta); uv.Add(tb); uv.Add(tc);
                Color tint = new Color(shade, shade, shade, 1f);
                colors.Add(tint); colors.Add(tint); colors.Add(tint);
                triangles.Add(index); triangles.Add(index + 1); triangles.Add(index + 2);
            }

            void AddQuad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector2 ta, Vector2 tb, Vector2 tc, Vector2 td, float shade)
            {
                AddTriangle(a, b, c, ta, tb, tc, shade);
                AddTriangle(c, b, d, tc, tb, td, shade);
            }

            for (int sideIndex = 0; sideIndex < 2; sideIndex++)
            {
                for (int column = 0; column < columns; column++)
                {
                    float u0 = Mathf.Lerp(startDistance, endDistance, column / (float)columns) / Mathf.Max(1f, settings.SlabLength);
                    float u1 = Mathf.Lerp(startDistance, endDistance, (column + 1f) / columns) / Mathf.Max(1f, settings.SlabLength);
                    for (int row = 0; row < rows; row++)
                    {
                        float v0 = row / (float)rows;
                        float v1 = (row + 1f) / rows;
                        AddQuad(inner[sideIndex, column, row], inner[sideIndex, column, row + 1],
                            inner[sideIndex, column + 1, row], inner[sideIndex, column + 1, row + 1],
                            new Vector2(u0, v0), new Vector2(u0, v1), new Vector2(u1, v0), new Vector2(u1, v1), 1f);
                    }
                    for (int band = 0; band < topBands; band++)
                    {
                        float v0 = band / (float)topBands;
                        float v1 = (band + 1f) / topBands;
                        AddQuad(top[sideIndex, column, band], top[sideIndex, column, band + 1],
                            top[sideIndex, column + 1, band], top[sideIndex, column + 1, band + 1],
                            new Vector2(u0, v0), new Vector2(u0, v1), new Vector2(u1, v0), new Vector2(u1, v1), .84f);
                    }
                    AddQuad(top[sideIndex, column, topBands], outerBottom[sideIndex, column],
                        top[sideIndex, column + 1, topBands], outerBottom[sideIndex, column + 1],
                        new Vector2(u0, 1f), new Vector2(u0, 0f), new Vector2(u1, 1f), new Vector2(u1, 0f), .62f);
                    AddQuad(outerBottom[sideIndex, column], inner[sideIndex, column, 0],
                        outerBottom[sideIndex, column + 1], inner[sideIndex, column + 1, 0],
                        new Vector2(u0, 0f), new Vector2(u0, 1f), new Vector2(u1, 0f), new Vector2(u1, 1f), .68f);
                }
            }

            // A submerged floor joins both banks into one actual region instead of
            // two unrelated wall ribbons. It remains below the water presentation.
            for (int column = 0; column < columns; column++)
            {
                AddQuad(outerBottom[0, column], outerBottom[1, column], outerBottom[0, column + 1], outerBottom[1, column + 1],
                    Vector2.zero, Vector2.right, Vector2.up, Vector2.one, .55f);
            }

            AddBankCap(0, 0, false);
            AddBankCap(1, 0, false);
            AddBankCap(0, columns, true);
            AddBankCap(1, columns, true);

            void AddBankCap(int sideIndex, int column, bool reverse)
            {
                var ring = new List<Vector3>(rows + topBands + 4) { inner[sideIndex, column, 0] };
                for (int row = 1; row <= rows; row++) ring.Add(inner[sideIndex, column, row]);
                for (int band = 1; band <= topBands; band++) ring.Add(top[sideIndex, column, band]);
                ring.Add(outerBottom[sideIndex, column]);
                Vector3 center = Vector3.zero;
                for (int i = 0; i < ring.Count; i++) center += ring[i];
                center /= ring.Count;
                for (int i = 0; i < ring.Count; i++)
                {
                    Vector3 a = ring[i];
                    Vector3 b = ring[(i + 1) % ring.Count];
                    if (reverse) AddTriangle(center, b, a, Vector2.zero, Vector2.right, Vector2.up, .74f);
                    else AddTriangle(center, a, b, Vector2.zero, Vector2.right, Vector2.up, .74f);
                }
            }

            var mesh = new Mesh
            {
                name = "JH_SolidCarvedCanyonRegion",
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

        public static bool ValidateSightlines(
            CanyonRouteSampler route,
            HybridCanyonWorldSettings settings,
            Mesh mesh,
            float startDistance,
            float endDistance,
            out int blockedSamples,
            out int exitSamples,
            out string error)
        {
            blockedSamples = 0;
            exitSamples = 0;
            error = string.Empty;
            if (route == null || settings == null || mesh == null)
            {
                error = "Missing route, settings, or solid-region mesh.";
                return false;
            }

            Vector3[] vertices = mesh.vertices;
            int[] triangles = mesh.triangles;
            float sampleStart = Mathf.Max(startDistance + 18f, route.ThresholdStartDistance + 18f);
            float sampleEnd = Mathf.Min(endDistance - 8f, route.Length - 8f);
            for (float distance = sampleStart; distance <= sampleEnd; distance += 22f)
            {
                CanyonRouteFrame frame = route.Sample(distance);
                bool shouldReachExit = HasStraightChannelToExit(route, distance, frame.Center.x);
                var ray = new Ray(new Vector3(frame.Center.x, settings.SolidSightlineHeight, frame.Center.z), Vector3.back);
                bool hitsRock = IntersectsMesh(ray, vertices, triangles, out _);
                if (shouldReachExit)
                {
                    exitSamples++;
                    if (hitsRock)
                    {
                        error = $"The route is straight to the exit at {distance:0}m, but solid canyon geometry blocks that valid horizon view.";
                        return false;
                    }
                }
                else
                {
                    blockedSamples++;
                    if (!hitsRock)
                    {
                        error = $"The route bends after {distance:0}m, but the solid canyon does not physically occlude the horizon.";
                        return false;
                    }
                }
            }
            if (blockedSamples == 0)
            {
                error = "The authored route never produces a geometry-blocked canyon sightline.";
                return false;
            }
            if (exitSamples == 0)
            {
                error = "The canyon exit never opens a legitimate straight sightline.";
                return false;
            }
            return true;
        }

        static bool HasStraightChannelToExit(CanyonRouteSampler route, float distance, float observerX)
        {
            for (float future = distance + 4f; future < route.Length - 2f; future += 4f)
            {
                CanyonRouteFrame frame = route.Sample(future);
                float allowance = frame.HalfWidth + 3f;
                if (observerX < frame.Center.x - allowance || observerX > frame.Center.x + allowance)
                    return false;
            }
            return true;
        }

        static bool IntersectsMesh(Ray ray, Vector3[] vertices, int[] triangles, out float nearest)
        {
            nearest = float.MaxValue;
            for (int i = 0; i < triangles.Length; i += 3)
            {
                if (!RayTriangle(ray, vertices[triangles[i]], vertices[triangles[i + 1]], vertices[triangles[i + 2]], out float distance)) continue;
                if (distance > .1f && distance < nearest) nearest = distance;
            }
            return nearest < float.MaxValue;
        }

        static bool RayTriangle(Ray ray, Vector3 a, Vector3 b, Vector3 c, out float distance)
        {
            distance = 0f;
            Vector3 edge1 = b - a;
            Vector3 edge2 = c - a;
            Vector3 p = Vector3.Cross(ray.direction, edge2);
            float determinant = Vector3.Dot(edge1, p);
            if (Mathf.Abs(determinant) < .00001f) return false;
            float inverse = 1f / determinant;
            Vector3 t = ray.origin - a;
            float u = Vector3.Dot(t, p) * inverse;
            if (u < 0f || u > 1f) return false;
            Vector3 q = Vector3.Cross(t, edge1);
            float v = Vector3.Dot(ray.direction, q) * inverse;
            if (v < 0f || u + v > 1f) return false;
            distance = Vector3.Dot(edge2, q) * inverse;
            return distance > .1f;
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
