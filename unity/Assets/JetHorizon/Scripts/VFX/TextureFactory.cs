using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Ports of the JS canvas-generated textures (spec/03): canyon slab emissive maps,
    /// wake noise, soft particle sprite, sun corona, horizon seam.
    /// </summary>
    public static class TextureFactory
    {
        // seeded LCG identical in spirit to the JS one
        class Lcg { int s; public Lcg(int seed) { s = seed; } public float Next() { s = (s * 9301 + 49297) % 233280; return Mathf.Abs(s) / 233280f; } }

        /// <summary>cyanTex — 512², dark navy base + bright cyan diagonal streak (spec/03 §8).</summary>
        public static Texture2D CyanSlab(int size = 512)
        {
            var tex = NewTex(size, size);
            Color baseCol = Hex("#030b14");
            Vector2 g0 = Vector2.zero, g1 = new Vector2(300f / 512f * size, size);
            Vector2 dir = (g1 - g0).normalized; float len = (g1 - g0).magnitude;
            var stops = new (float t, Color c)[] {
                (0f,    new Color(120/255f, 240/255f, 1f, 0.95f)),
                (0.15f, new Color(60/255f, 200/255f, 1f, 0.70f)),
                (0.40f, new Color(20/255f, 120/255f, 200/255f, 0.30f)),
                (1f,    new Color(0, 0, 0, 0f)) };

            var px = new Color[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float t = Mathf.Clamp01(Vector2.Dot(new Vector2(x, y) - g0, dir) / len);
                    Color grad = SampleStops(stops, t);
                    px[y * size + x] = Color.Lerp(baseCol, new Color(grad.r, grad.g, grad.b, 1f), grad.a);
                }
            tex.SetPixels(px); tex.Apply();
            return tex;
        }

        /// <summary>darkTex — marble veins + jagged magenta cracks (spec/03 §8).</summary>
        public static Texture2D DarkSlab(int size = 512, int crackCount = 6, float crackBright = 1f, int seed = 1234)
        {
            var tex = NewTex(size, size);
            var rnd = new Lcg(seed);
            var px = new Color[size * size];
            Color baseCol = Hex("#030608");
            for (int i = 0; i < px.Length; i++) px[i] = baseCol;

            void Line(Vector2 a, Vector2 b, Color c, float w)
            {
                int steps = Mathf.CeilToInt((b - a).magnitude);
                for (int i = 0; i <= steps; i++)
                {
                    Vector2 p = Vector2.Lerp(a, b, i / (float)Mathf.Max(1, steps));
                    int r = Mathf.CeilToInt(w / 2f);
                    for (int dy = -r; dy <= r; dy++)
                        for (int dx = -r; dx <= r; dx++)
                        {
                            int X = (int)p.x + dx, Y = (int)p.y + dy;
                            if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
                            float falloff = 1f - Mathf.Clamp01(new Vector2(dx, dy).magnitude / Mathf.Max(1f, w));
                            int idx = Y * size + X;
                            px[idx] = Color.Lerp(px[idx], c, c.a * falloff);
                        }
                }
            }

            // 6 wandering vertical marble veins
            for (int v = 0; v < 6; v++)
            {
                float x = rnd.Next() * size;
                Color vein = Hex("#0a1525"); vein.a = 0.3f + rnd.Next() * 0.3f;
                float w = 6f + rnd.Next() * 12f;
                Vector2 p = new Vector2(x, 0);
                for (int s = 0; s < 8; s++)
                {
                    Vector2 q = new Vector2(x + (rnd.Next() - 0.5f) * 60f, (s + 1) / 8f * size);
                    Line(p, q, vein, w); p = q;
                }
            }
            // horizontal magenta cracks with branches
            for (int c = 0; c < crackCount; c++)
            {
                Color col = rnd.Next() < 0.6f ? Hex("#ff00cc") : Hex("#cc44ff");
                col *= crackBright; col.a = 0.7f + rnd.Next() * 0.3f;
                float w = 1.5f + rnd.Next() * 3f;
                float y = rnd.Next() * size;
                Vector2 p = new Vector2(0, y);
                int segs = 5 + (int)(rnd.Next() * 5);
                for (int s = 0; s < segs; s++)
                {
                    Vector2 q = new Vector2((s + 1) / (float)segs * size, y + (rnd.Next() - 0.5f) * 80f);
                    Line(p, q, col, w);
                    if (rnd.Next() < 0.4f)   // branch offshoot
                        Line(q, q + new Vector2((rnd.Next() - 0.5f) * 60f, (rnd.Next() - 0.5f) * 60f), col, w * 0.6f);
                    p = q;
                }
            }
            tex.SetPixels(px); tex.Apply();
            return tex;
        }

        /// <summary>64² two-octave noise for the bank-water wake (spec/03 §6).</summary>
        public static Texture2D WakeNoise(int size = 64)
        {
            var tex = NewTex(size, size, wrap: TextureWrapMode.Repeat);
            int coarseN = 16;
            var coarse = new float[coarseN + 1, coarseN + 1];
            for (int y = 0; y <= coarseN; y++) for (int x = 0; x <= coarseN; x++) coarse[x, y] = Random.value;
            var px = new Color[size * size];
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float fx = x / (float)size * coarseN, fy = y / (float)size * coarseN;
                    int ix = (int)fx, iy = (int)fy; float tx = fx - ix, ty = fy - iy;
                    float c = Mathf.Lerp(Mathf.Lerp(coarse[ix, iy], coarse[ix + 1, iy], tx),
                                         Mathf.Lerp(coarse[ix, iy + 1], coarse[ix + 1, iy + 1], tx), ty);
                    float v = Random.value * 0.4f + c * 0.6f;
                    px[y * size + x] = new Color(v, v, v, 1);
                }
            tex.SetPixels(px); tex.Apply();
            return tex;
        }

        /// <summary>Soft radial sprite (thruster particles, explosion flash, star points).</summary>
        public static Texture2D RadialSprite(int size = 64)
        {
            var tex = NewTex(size, size);
            var px = new Color[size * size];
            float half = size / 2f;
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float d = Vector2.Distance(new Vector2(x, y), new Vector2(half, half)) / half;
                    float a = d < 0.18f ? 1f : d < 0.45f ? Mathf.Lerp(0.9f, 0.15f, (d - 0.18f) / 0.27f)
                            : d < 1f ? Mathf.Lerp(0.15f, 0f, (d - 0.45f) / 0.55f) : 0f;
                    px[y * size + x] = new Color(1, 1, 1, a);
                }
            tex.SetPixels(px); tex.Apply();
            return tex;
        }

        /// <summary>Soft annulus for wake ring ripples.</summary>
        public static Texture2D RingSprite(int size = 64)
        {
            var tex = NewTex(size, size);
            var px = new Color[size * size];
            float half = size / 2f;
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    float d = Vector2.Distance(new Vector2(x, y), new Vector2(half, half)) / half;
                    float a = Mathf.Clamp01(1f - Mathf.Abs(d - 0.68f) / 0.16f);
                    a *= a;
                    px[y * size + x] = new Color(1, 1, 1, a);
                }
            tex.SetPixels(px); tex.Apply();
            return tex;
        }

        /// <summary>
        /// Sun corona sprite — crown bloom radial gradient + the 6-layer limb arc strokes
        /// (spec/03 §4d: ring radius 0.625·half, widths 16/12/10/4/10/16 @2048,
        /// weight taper thickest at 12-o'clock).
        /// </summary>
        public static Texture2D SunCorona(int size = 512, Color? tint = null)
        {
            Color t = tint ?? new Color(1f, 0.66f, 0.16f);
            var tex = NewTex(size, size);
            var px = new Color[size * size];
            float half = size / 2f;
            for (int y = 0; y < size; y++)
                for (int x = 0; x < size; x++)
                {
                    // scaled 2.2x horizontally → ellipse distance
                    float dx = (x - half) / (half * 2.2f), dy = (y - half) / half;
                    float d = Mathf.Sqrt(dx * dx * 4.84f + dy * dy); // undo for radial stops
                    float a = d < 0.15f ? Mathf.Lerp(0.22f, 0.16f, d / 0.15f)
                            : d < 0.40f ? Mathf.Lerp(0.16f, 0.08f, (d - 0.15f) / 0.25f)
                            : d < 1f ? Mathf.Lerp(0.08f, 0f, (d - 0.40f) / 0.60f) : 0f;
                    Color warm = Color.Lerp(new Color(1f, 1f, 0.86f), t, Mathf.Clamp01(d * 2f));
                    px[y * size + x] = new Color(warm.r, warm.g, warm.b, a);
                }

            // ── limb arcs: 6 stacked strokes hugging the sun's upper limb ──
            float scale = size / 2048f;
            float ringR = half * 0.625f;
            float[] rOff   = { -8f, -4.8f, -1.6f, 1.6f, 4.8f, 8f };
            float[] widths = { 16f, 12f, 10f, 4f, 10f, 16f };
            Color[] cols =
            {
                new Color(1f, 130/255f,  25/255f, 0.35f),
                new Color(1f, 170/255f,  55/255f, 0.70f),
                new Color(1f, 215/255f,  95/255f, 1.00f),
                new Color(1f, 250/255f, 200/255f, 1.00f),
                new Color(1f, 185/255f,  60/255f, 0.70f),
                new Color(1f, 148/255f,  30/255f, 0.30f),
            };

            void Stamp(float cx, float cy, float radius, Color c, float alpha)
            {
                int r = Mathf.Max(1, Mathf.CeilToInt(radius));
                for (int oy = -r; oy <= r; oy++)
                    for (int ox = -r; ox <= r; ox++)
                    {
                        int X = (int)cx + ox, Y = (int)cy + oy;
                        if (X < 0 || Y < 0 || X >= size || Y >= size) continue;
                        float fall = 1f - Mathf.Clamp01(Mathf.Sqrt(ox * ox + oy * oy) / Mathf.Max(1f, radius));
                        float aa = alpha * fall * fall;
                        int idx = Y * size + X;
                        Color e = px[idx];
                        px[idx] = new Color(
                            Mathf.Lerp(e.r, c.r, aa), Mathf.Lerp(e.g, c.g, aa), Mathf.Lerp(e.b, c.b, aa),
                            Mathf.Max(e.a, aa));
                    }
            }

            const int steps = 480;
            for (int layer = 0; layer < 6; layer++)
            {
                float lr = ringR + rOff[layer] * scale * 2f;
                float lw = Mathf.Max(1f, widths[layer] * scale);
                for (int i = 0; i <= steps; i++)
                {
                    float tt = i / (float)steps;                          // 0..1 across the top arc
                    float ang = Mathf.PI * (1f - tt);                     // 180° → 0° (upper limb)
                    float weight = 0.28f + 0.72f * Mathf.Pow(1f - Mathf.Abs(tt - 0.5f) * 2f, 1.6f);
                    float cx = half + Mathf.Cos(ang) * lr;
                    float cy = half + Mathf.Sin(ang) * lr;
                    Stamp(cx, cy, lw * weight * 0.5f + 0.75f, cols[layer], cols[layer].a * weight);
                }
            }

            tex.SetPixels(px); tex.Apply();
            return tex;
        }

        /// <summary>Horizon seam — horizontal gradient strip, white-hot center (spec/03 §4d).</summary>
        public static Texture2D HorizonSeam(Color sunColor, int w = 512, int h = 16)
        {
            var tex = NewTex(w, h, wrap: TextureWrapMode.Clamp);
            var stops = new (float t, float a)[] { (0f,0f),(0.10f,0.30f),(0.32f,0.85f),(0.50f,1f),(0.68f,0.85f),(0.90f,0.30f),(1f,0f) };
            Color warm = new Color(Mathf.Min(1f, sunColor.r + 0.15f), Mathf.Min(1f, sunColor.g + 0.05f), sunColor.b);
            var px = new Color[w * h];
            for (int x = 0; x < w; x++)
            {
                float t = x / (float)(w - 1);
                float a = SampleStopsF(stops, t);
                float centerT = 1f - Mathf.Abs(t - 0.5f) * 2f;
                Color c = Color.Lerp(warm, new Color(0.95f, 0.95f, 0.95f), Mathf.Pow(centerT, 3f));
                for (int y = 0; y < h; y++) px[y * w + x] = new Color(c.r, c.g, c.b, a);
            }
            tex.SetPixels(px); tex.Apply();
            return tex;
        }

        // ── helpers ─────────────────────────────────────────────
        static Texture2D NewTex(int w, int h, TextureWrapMode wrap = TextureWrapMode.Clamp)
            => new Texture2D(w, h, TextureFormat.RGBA32, true) { wrapMode = wrap, filterMode = FilterMode.Bilinear };

        public static Color Hex(string hex)
        {
            ColorUtility.TryParseHtmlString(hex, out var c);
            return c;
        }
        public static Color Hex(int rgb) =>
            new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f);

        static Color SampleStops((float t, Color c)[] stops, float t)
        {
            for (int i = 1; i < stops.Length; i++)
                if (t <= stops[i].t)
                    return Color.Lerp(stops[i - 1].c, stops[i].c,
                        Mathf.InverseLerp(stops[i - 1].t, stops[i].t, t));
            return stops[stops.Length - 1].c;
        }
        static float SampleStopsF((float t, float a)[] stops, float t)
        {
            for (int i = 1; i < stops.Length; i++)
                if (t <= stops[i].t)
                    return Mathf.Lerp(stops[i - 1].a, stops[i].a,
                        Mathf.InverseLerp(stops[i - 1].t, stops[i].t, t));
            return stops[stops.Length - 1].a;
        }
    }
}
