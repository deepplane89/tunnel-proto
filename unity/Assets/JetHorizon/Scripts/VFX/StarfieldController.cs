using System.Collections.Generic;
using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Direct Unity port of the Three.js NDC sky-star system plus world-space speed streaks.
    /// Stars are deterministic screen-space quads in one mesh: sparse field, authored
    /// clusters, constellation nodes, diagonal Milky Way, and below-horizon roll fill.
    /// </summary>
    public sealed class StarfieldController : MonoBehaviour
    {
        public Material StarMaterial;     // JH/SkyStars
        public Material StreakMaterial;   // JH/Additive plain

        const int StreakCount = 400;
        const float VolZ = 600f;
        const float HorizonNdc = -0.40f;
        const float SunCenterXNdc = 0f;
        const float SunCenterYNdc = 0.022f;
        const float SunRadiusNdc = 0.36f;

        Transform[] _streaks;
        Mesh _skyMesh;
        Material _runtimeStarMaterial;

        sealed class SourceRandom
        {
            uint _state = 42;

            public float Next()
            {
                _state = unchecked(_state * 1664525u + 1013904223u);
                return _state / (float)uint.MaxValue;
            }

            public float Range(float min, float max) => min + Next() * (max - min);
        }

        readonly struct StarPoint
        {
            public readonly Vector2 Position;
            public readonly float Seed;
            public readonly float Size;

            public StarPoint(float x, float y, float seed, float size)
            {
                Position = new Vector2(x, y);
                Seed = seed;
                Size = size;
            }
        }

        readonly struct Cluster
        {
            public readonly float X, Y, SigmaX, SigmaY;
            public readonly int Count;

            public Cluster(float x, float y, float sigmaX, float sigmaY, int count)
            {
                X = x; Y = y; SigmaX = sigmaX; SigmaY = sigmaY; Count = count;
            }
        }

        void Start()
        {
            BuildSkyStars();
            BuildStreaks();
        }

        void OnDestroy()
        {
            if (_skyMesh != null) Destroy(_skyMesh);
            if (_runtimeStarMaterial != null) Destroy(_runtimeStarMaterial);
        }

        void BuildSkyStars()
        {
            var rng = new SourceRandom();
            var stars = new List<StarPoint>(1500);

            bool Valid(float x, float y)
            {
                if (y < HorizonNdc + 0.04f) return false;
                float dx = x - SunCenterXNdc;
                float dy = y - SunCenterYNdc;
                return dx * dx + dy * dy >= SunRadiusNdc * SunRadiusNdc;
            }

            void Add(float x, float y, float minSize, float maxSize, float seedScale = 628.318f)
            {
                rng.Next(); // source pickColor() consumes one RNG value (palette is white-only)
                stars.Add(new StarPoint(x, y, rng.Next() * seedScale, rng.Range(minSize, maxSize)));
            }

            // 1. Sparse field — source count and rejection rules.
            int added = 0, attempts = 0;
            while (added < 350 && attempts++ < 350 * 8)
            {
                float x = rng.Range(-1f, 1f);
                float y = rng.Range(HorizonNdc + 0.04f, 1f);
                if (!Valid(x, y)) continue;
                Add(x, y, 0.6f, 2.0f);
                added++;
            }

            // 2. Eight authored gaussian clusters.
            var clusters = new[]
            {
                new Cluster( 0.70f, 0.72f, 0.08f, 0.06f, 30),
                new Cluster(-0.65f, 0.50f, 0.06f, 0.05f, 22),
                new Cluster( 0.10f, 0.84f, 0.10f, 0.07f, 38),
                new Cluster(-0.40f, 0.25f, 0.05f, 0.04f, 16),
                new Cluster( 0.88f, 0.35f, 0.04f, 0.04f, 14),
                new Cluster(-0.78f, 0.60f, 0.07f, 0.05f, 24),
                new Cluster( 0.42f, 0.55f, 0.06f, 0.04f, 18),
                new Cluster(-0.15f, 0.40f, 0.08f, 0.06f, 26),
            };
            foreach (var cluster in clusters)
            {
                added = 0; attempts = 0;
                while (added < cluster.Count && attempts++ < cluster.Count * 10)
                {
                    float u1 = rng.Next(), u2 = rng.Next();
                    float magnitude = Mathf.Sqrt(-2f * Mathf.Log(u1 + 1e-9f));
                    float angle = 2f * Mathf.PI * u2;
                    float x = cluster.X + magnitude * Mathf.Cos(angle) * cluster.SigmaX;
                    float y = cluster.Y + magnitude * Mathf.Sin(angle) * cluster.SigmaY;
                    if (x < -1f || x > 1f || y < -1f || y > 1f || !Valid(x, y)) continue;
                    Add(x, y, 0.6f, 1.6f);
                    added++;
                }
            }

            // 3. Foreground stars — slightly larger and slower seeds.
            added = 0; attempts = 0;
            while (added < 14 && attempts++ < 14 * 20)
            {
                float x = rng.Range(-0.95f, 0.95f);
                float y = rng.Range(HorizonNdc + 0.08f, 0.95f);
                if (!Valid(x, y)) continue;
                Add(x, y, 2.0f, 3.2f, 62.83f);
                added++;
            }

            // Source constellation nodes, including repeated junctions for brighter centers.
            var constellations = new[]
            {
                new[] { new Vector2(-0.72f,0.62f), new Vector2(-0.62f,0.70f), new Vector2(-0.50f,0.66f),
                        new Vector2(-0.44f,0.72f), new Vector2(-0.55f,0.80f), new Vector2(-0.66f,0.78f) },
                new[] { new Vector2( 0.08f,0.88f), new Vector2( 0.00f,0.78f), new Vector2(-0.08f,0.88f),
                        new Vector2( 0.00f,0.78f), new Vector2( 0.00f,0.68f) },
                new[] { new Vector2( 0.62f,0.52f), new Vector2( 0.72f,0.60f), new Vector2( 0.80f,0.52f),
                        new Vector2( 0.72f,0.60f), new Vector2( 0.72f,0.72f), new Vector2( 0.64f,0.80f) },
            };
            foreach (var constellation in constellations)
                foreach (var point in constellation)
                    if (Valid(point.x, point.y)) Add(point.x, point.y, 1.4f, 2.2f, 62.83f);

            // 4. Six hundred point diagonal Milky Way band.
            added = 0; attempts = 0;
            while (added < 600 && attempts++ < 4800)
            {
                float x = rng.Range(-1f, 1f);
                float centerY = 0.28f + x * 0.22f;
                float u1 = rng.Next(), u2 = rng.Next();
                float gaussian = Mathf.Sqrt(-2f * Mathf.Log(u1 + 1e-9f)) * Mathf.Cos(2f * Mathf.PI * u2);
                float y = centerY + gaussian * 0.08f;
                if (y < HorizonNdc + 0.04f || y > 1f || !Valid(x, y)) continue;
                Add(x, y, 0.5f, 1.4f);
                added++;
            }

            // 5. Below-horizon fill revealed during camera rolls.
            added = 0; attempts = 0;
            while (added < 300 && attempts++ < 300 * 8)
            {
                float x = rng.Range(-1f, 1f);
                float y = rng.Range(HorizonNdc + 0.04f, 0.20f);
                if (!Valid(x, y)) continue;
                Add(x, y, 0.5f, 1.8f);
                added++;
            }

            // 6. Unity display compensation. The source points were tuned for a fixed browser
            // device-pixel footprint; at a Retina Game view the upper sky reads much sparser.
            // Keep every source star unchanged, then add a subtle deterministic upper layer so
            // the sky remains populated above and around the hero sun without becoming a cloud.
            added = 0; attempts = 0;
            while (added < 240 && attempts++ < 240 * 10)
            {
                float x = rng.Range(-1f, 1f);
                float y = rng.Range(0.18f, 1f);
                if (!Valid(x, y)) continue;
                Add(x, y, 0.55f, 1.45f);
                added++;
            }

            _skyMesh = BuildStarMesh(stars);
            var go = new GameObject("SkyStarsGPU");
            go.transform.SetParent(transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = _skyMesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = ResolveStarMaterial();
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            renderer.motionVectorGenerationMode = MotionVectorGenerationMode.ForceNoMotion;
        }

        Material ResolveStarMaterial()
        {
            if (StarMaterial != null && StarMaterial.shader != null && StarMaterial.shader.name == "JH/SkyStars")
                return StarMaterial;
            var shader = Shader.Find("JH/SkyStars");
            if (shader == null) return StarMaterial;
            _runtimeStarMaterial = new Material(shader) { name = "RuntimeSkyStars" };
            return _runtimeStarMaterial;
        }

        static Mesh BuildStarMesh(List<StarPoint> stars)
        {
            var vertices = new List<Vector3>(stars.Count * 4);
            var corners = new List<Vector2>(stars.Count * 4);
            var starData = new List<Vector2>(stars.Count * 4);
            var triangles = new List<int>(stars.Count * 6);
            var quadCorners = new[]
            {
                new Vector2(-1f, -1f), new Vector2(1f, -1f),
                new Vector2(1f, 1f), new Vector2(-1f, 1f)
            };

            foreach (var star in stars)
            {
                int v = vertices.Count;
                for (int i = 0; i < 4; i++)
                {
                    vertices.Add(new Vector3(star.Position.x, star.Position.y, 0f));
                    corners.Add(quadCorners[i]);
                    starData.Add(new Vector2(star.Seed, star.Size));
                }
                triangles.Add(v); triangles.Add(v + 1); triangles.Add(v + 2);
                triangles.Add(v); triangles.Add(v + 2); triangles.Add(v + 3);
            }

            var mesh = new Mesh { name = "JH_SourceSkyStars" };
            mesh.SetVertices(vertices);
            mesh.SetUVs(0, corners);
            mesh.SetUVs(1, starData);
            mesh.SetTriangles(triangles, 0);
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 100000f);
            return mesh;
        }

        void BuildStreaks()
        {
            _streaks = new Transform[StreakCount];
            var streakParent = new GameObject("WarpStreaks").transform;
            streakParent.SetParent(transform, false);
            for (int i = 0; i < StreakCount; i++)
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Destroy(go.GetComponent<Collider>());
                go.transform.SetParent(streakParent, false);
                go.transform.position = RandomStreakPos();
                go.transform.localScale = new Vector3(0.05f, 0.05f, 2f);
                var mr = go.GetComponent<MeshRenderer>();
                mr.sharedMaterial = StreakMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                go.SetActive(false);
                _streaks[i] = go.transform;
            }
        }

        static Vector3 RandomStreakPos() => new Vector3(
            Random.Range(-520f, 520f), Random.Range(2f, 450f), Random.Range(-VolZ, 0f));

        void Update()
        {
            if (GameManager.I == null || GameManager.I.Phase != GamePhase.Playing) return;
            var s = GameManager.I.Session;
            float rawDt = Mathf.Min(Time.deltaTime, Tuning.MaxRawDt);
            float step = s.EffectiveSpeed * rawDt;
            float speedFrac = Mathf.Clamp01((s.EffectiveSpeed - Tuning.BaseSpeed) / (Tuning.BaseSpeed * 1.5f));
            int active = Mathf.RoundToInt(Mathf.Lerp(40, StreakCount, speedFrac));
            float len = Mathf.Lerp(1.5f, 4f, speedFrac);
            for (int i = 0; i < _streaks.Length; i++)
            {
                var t = _streaks[i];
                bool on = i < active;
                if (t.gameObject.activeSelf != on) t.gameObject.SetActive(on);
                if (!on) continue;
                var p = t.position;
                p.z += step * 1.4f;
                if (p.z > 40f) p = RandomStreakPos();
                t.position = p;
                t.localScale = new Vector3(0.05f, 0.05f, len);
            }
        }
    }
}
