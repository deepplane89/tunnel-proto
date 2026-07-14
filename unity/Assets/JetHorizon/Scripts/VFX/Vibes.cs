using UnityEngine;

namespace JetHorizon
{
    /// <summary>Per-vibe visual palette (LEVELS table + DR vibes, spec/03 §3).</summary>
    [System.Serializable]
    public struct Vibe
    {
        public string name;
        public Color skyTop, skyBot, gridColor, sunColor, fogColor, thrusterColor, nebulaTint;
        public float bloomStrength;
        public int sunShader;   // 0 plain, 1 UV, 2 crimson-warp, 3 ice-warp, 4 gold
    }

    public static class Vibes
    {
        static Color H(int rgb) => TextureFactory.Hex(rgb);

        public static readonly Vibe[] All =
        {
            new Vibe { name = "NEON DAWN",        skyTop = H(0x03070f), skyBot = H(0x08102a), gridColor = H(0x00eeff), sunColor = H(0xff9500), fogColor = H(0x05091a), thrusterColor = H(0x44aaff), nebulaTint = H(0x2244aa), bloomStrength = 0.35f, sunShader = 0 },
            new Vibe { name = "ULTRAVIOLET",      skyTop = H(0x060010), skyBot = H(0x0e0320), gridColor = H(0xdd00ff), sunColor = H(0xcc44ff), fogColor = H(0x080018), thrusterColor = H(0xee00ff), nebulaTint = H(0x661199), bloomStrength = 0.38f, sunShader = 1 },
            new Vibe { name = "ELECTRIC HORIZON", skyTop = H(0x001510), skyBot = H(0x00291e), gridColor = H(0x00ffcc), sunColor = H(0xff6600), fogColor = H(0x02120c), thrusterColor = H(0x00eeff), nebulaTint = H(0x003388), bloomStrength = 0.38f, sunShader = 0 },
            new Vibe { name = "ICE STORM",        skyTop = H(0x000000), skyBot = H(0x000c18), gridColor = H(0x55ffff), sunColor = H(0xaaeeff), fogColor = H(0x00080f), thrusterColor = H(0x33aaee), nebulaTint = H(0x003388), bloomStrength = 0.30f, sunShader = 3 },
            new Vibe { name = "VOID SINGULARITY", skyTop = H(0x000000), skyBot = H(0x060400), gridColor = H(0xffcc00), sunColor = H(0xffaa33), fogColor = H(0x030200), thrusterColor = H(0xff9a00), nebulaTint = H(0x110033), bloomStrength = 0.30f, sunShader = 4 },
            new Vibe { name = "CRIMSON VOID",     skyTop = H(0x000000), skyBot = H(0x0f0005), gridColor = H(0xff1050), sunColor = H(0xff4400), fogColor = H(0x080003), thrusterColor = H(0xff3300), nebulaTint = H(0x990022), bloomStrength = 0.42f, sunShader = 2 },
            new Vibe { name = "DEEP VIOLET",      skyTop = H(0x06000f), skyBot = H(0x0a001a), gridColor = H(0xaa44ff), sunColor = H(0xcc88ff), fogColor = H(0x050010), thrusterColor = H(0xee00ff), nebulaTint = H(0x661199), bloomStrength = 0.38f, sunShader = 1 },
            new Vibe { name = "SOLAR FLARE",      skyTop = H(0x0a0400), skyBot = H(0x140800), gridColor = H(0xff6600), sunColor = H(0xffdd88), fogColor = H(0x080300), thrusterColor = H(0xffcc33), nebulaTint = H(0x110033), bloomStrength = 0.45f, sunShader = 4 },
        };

        public static int Count => All.Length;
        public static Vibe Get(int idx) => All[Mathf.Clamp(idx, 0, All.Length - 1)];

        // Obstacle cone colors — spec/02 §1.1
        public static readonly Color[] ConeColors = { H(0xff1a8c), H(0x44ccff), H(0xffcc00) };
        public static readonly float[] ConeOpacity = { 0.92f, 0.88f, 0.95f };
        public static readonly Color ConeBody = H(0x12121a);
        public static readonly Color ZipperTint = H(0xffcc00);
        public static readonly Color SlalomTint = H(0xff44aa);
        public static readonly Color L4Tint = H(0xff00aa);
        public static readonly Color L5Tint = H(0xffcc00);
        public static readonly Color L3Tint = H(0x00ffcc);
        public static readonly Color StructuredWallTint = new Color(0f, 0.4f, 1f);
        public static readonly Color RingRed = H(0xff1a1a);
        public static readonly Color CoinGold = H(0xffd700);
    }
}
