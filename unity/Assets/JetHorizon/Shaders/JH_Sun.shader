// The giant synthwave sun (spec/03 §4d): radial core→rim gradient with FBM churn
// (plain/UV branches) cross-faded with a Quilez double-domain-warp branch (ice/gold/crimson).
Shader "JH/Sun"
{
    Properties
    {
        _SunColor ("Sun Color", Color) = (1, 0.584, 0, 1)
        _Warp ("Warp Blend", Range(0,1)) = 0
        _WarpCol1 ("Warp Deep", Color) = (0.25, 0.04, 0.02, 1)
        _WarpCol2 ("Warp Mid",  Color) = (0.85, 0.15, 0.04, 1)
        _WarpCol3 ("Warp Hot",  Color) = (1.0, 0.45, 0.08, 1)
        _Mode ("Surface Mode", Range(0,4)) = 0
        _Emission ("Emission Boost", Range(0,4)) = 1.0
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry+100" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Cull Back ZWrite On

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _SunColor;
                half  _Warp;
                half4 _WarpCol1, _WarpCol2, _WarpCol3;
                half  _Mode;
                half  _Emission;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 normalVS : TEXCOORD1;
                float3 posOS : TEXCOORD2;
                float3 normalWS : TEXCOORD3;
            };

            // ── 2D value-noise FBM (fbm2 port) ──────────────────────
            float hash21(float2 p)
            {
                p = frac(p * float2(127.1, 311.7));
                p += dot(p, p + 19.19);
                return frac(p.x * p.y);
            }
            float vnoise(float2 p)
            {
                float2 i = floor(p), f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                float a = hash21(i), b = hash21(i + float2(1,0));
                float c = hash21(i + float2(0,1)), d = hash21(i + float2(1,1));
                return lerp(lerp(a, b, f.x), lerp(c, d, f.x), f.y);
            }
            float fbm2(float2 p)
            {
                float v = 0.0, amp = 0.5;
                for (int i = 0; i < 4; i++)
                {
                    v += amp * vnoise(p);
                    p *= 2.1; amp *= 0.5;
                }
                return v;
            }

            // Ashima Arts / Ian McEwan simplex noise (MIT), matching the source
            // solar shader. 3D sampling keeps the plasma continuous around the sphere.
            float3 mod289v3(float3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            float4 mod289v4(float4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            float4 permute(float4 x) { return mod289v4(((x * 34.0) + 1.0) * x); }
            float4 taylorInvSqrt(float4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
            float snoise(float3 v)
            {
                const float2 C = float2(1.0 / 6.0, 1.0 / 3.0);
                const float4 D = float4(0.0, 0.5, 1.0, 2.0);
                float3 i = floor(v + dot(v, C.yyy));
                float3 x0 = v - i + dot(i, C.xxx);
                float3 g = step(x0.yzx, x0.xyz);
                float3 l = 1.0 - g;
                float3 i1 = min(g.xyz, l.zxy);
                float3 i2 = max(g.xyz, l.zxy);
                float3 x1 = x0 - i1 + C.xxx;
                float3 x2 = x0 - i2 + C.yyy;
                float3 x3 = x0 - D.yyy;
                i = mod289v3(i);
                float4 p = permute(permute(permute(
                    i.z + float4(0.0, i1.z, i2.z, 1.0))
                    + i.y + float4(0.0, i1.y, i2.y, 1.0))
                    + i.x + float4(0.0, i1.x, i2.x, 1.0));
                float n = 0.142857142857;
                float3 ns = n * D.wyz - D.xzx;
                float4 j = p - 49.0 * floor(p * ns.z * ns.z);
                float4 x_ = floor(j * ns.z);
                float4 y_ = floor(j - 7.0 * x_);
                float4 x = x_ * ns.x + ns.yyyy;
                float4 y = y_ * ns.x + ns.yyyy;
                float4 h = 1.0 - abs(x) - abs(y);
                float4 b0 = float4(x.xy, y.xy);
                float4 b1 = float4(x.zw, y.zw);
                float4 s0 = floor(b0) * 2.0 + 1.0;
                float4 s1 = floor(b1) * 2.0 + 1.0;
                float4 sh = -step(h, float4(0.0, 0.0, 0.0, 0.0));
                float4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
                float4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
                float3 p0 = float3(a0.xy, h.x);
                float3 p1 = float3(a0.zw, h.y);
                float3 p2 = float3(a1.xy, h.z);
                float3 p3 = float3(a1.zw, h.w);
                float4 norm = taylorInvSqrt(float4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
                p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
                float4 m = max(0.6 - float4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                m *= m;
                return 42.0 * dot(m * m, float4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
            }

            float fbmS(float3 p)
            {
                float v = 0.0, amp = 0.5;
                for (int i = 0; i < 4; i++)
                {
                    v += amp * (snoise(p) * 0.5 + 0.5);
                    p *= 2.1;
                    amp *= 0.5;
                }
                return v;
            }

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionHCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.uv = IN.uv;
                OUT.normalVS = mul((float3x3)UNITY_MATRIX_IT_MV, IN.normalOS);
                OUT.posOS = IN.positionOS.xyz;
                OUT.normalWS = TransformObjectToWorldNormal(IN.normalOS);
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float t = _Time.y;
                float3 viewNormal = normalize(IN.normalVS);
                float limb = saturate(viewNormal.z);

                // Source coordinates: intentionally compress X so the internal glow reads
                // broad and solar rather than as a uniform neon ring.
                float rd = saturate(length(float2(IN.posOS.x * 0.55, IN.posOS.y)) / 0.5);
                float yN = saturate(IN.posOS.y + 0.5);
                float2 surfaceUv = IN.uv;

                // ── PLAIN branch: dark core → bright rim, FBM churn ──
                float2 noiseUv = surfaceUv * 3.2 + float2(t * 0.015, t * 0.008);
                float n = fbm2(noiseUv);
                float churn = 0.94 + n * 0.12;
                half3 coreCol = half3(0.68, 0.24, 0.02);
                half3 rimCol  = half3(0.90, 0.38, 0.04);
                half3 col = lerp(coreCol, rimCol, smoothstep(0.15, 0.85, rd));
                col += half3(0.18, 0.10, 0.02) * smoothstep(0.45, 0.85, yN);
                col *= 1.0 - 0.08 * smoothstep(0.60, 0.48, yN);                    // bottom dim
                half3 corona = half3(1.0, 0.55, 0.08);
                float coronaBlend = smoothstep(0.82, 0.97, rd);
                float coronaBias = 0.3 + 0.7 * max(smoothstep(0.4, 0.9, yN), smoothstep(0.58, 0.50, yN) * 0.85);
                col = lerp(col, corona, coronaBlend * coronaBias);
                col *= churn;

                // Source L2 ultraviolet branch uses the same structure with its own palette.
                half3 uvCore = _SunColor.rgb * 0.42;
                half3 uvRim = _SunColor.rgb * 0.82;
                half3 uvCol = lerp(uvCore, uvRim, smoothstep(0.15, 0.88, rd));
                uvCol *= 0.92 + n * 0.16;
                uvCol += _SunColor.rgb * 0.20 * smoothstep(0.45, 0.85, yN);
                half3 uvCorona = saturate(_SunColor.rgb * 1.5 + half3(0.25, 0.12, 0.25));
                uvCol = lerp(uvCol, uvCorona, coronaBlend * coronaBias);
                float uvBlend = 1.0 - saturate(abs(_Mode - 1.0));
                col = lerp(col, uvCol, uvBlend);

                // ── WARP branch: source Quilez double domain warp ──
                float3 p = normalize(IN.normalWS) * 3.5;
                float3 q = float3(
                    fbmS(p + float3(0.0, 0.0, 0.0) + float3(t * 0.031, t * 0.021, t * 0.013)),
                    fbmS(p + float3(5.2, 1.3, 2.7) + float3(t * 0.025, t * 0.018, t * 0.011)),
                    fbmS(p + float3(3.1, 4.4, 1.1) + float3(t * 0.019, t * 0.027, t * 0.015)));
                float3 qOff = p + 3.5 * q;
                float3 r = float3(
                    fbmS(qOff + float3(1.7, 9.2, 4.3) + float3(t * 0.017, t * 0.012, t * 0.008)),
                    fbmS(qOff + float3(8.3, 2.8, 6.1) + float3(t * 0.022, t * 0.016, t * 0.010)),
                    fbmS(qOff + float3(2.9, 7.5, 0.8) + float3(t * 0.014, t * 0.020, t * 0.009)));
                float f = fbmS(p + 3.5 * r + float3(t * 0.011, t * 0.008, t * 0.006));
                half3 warpCol = lerp(_WarpCol1.rgb, _WarpCol2.rgb, smoothstep(0.2, 0.7, f));
                warpCol = lerp(warpCol, _WarpCol3.rgb, smoothstep(0.6, 0.9, f));
                float qMag = length(q) / 1.73;
                warpCol = lerp(warpCol, _WarpCol2.rgb * 1.1, smoothstep(0.4, 0.8, qMag) * 0.35);
                warpCol = lerp(warpCol, _WarpCol1.rgb, smoothstep(0.6, 0.9, r.y) * 0.4);
                warpCol *= pow(limb, 1.2) * 0.5 + 0.5;

                float warpBlend = saturate(max(_Warp, _Mode - 1.0));
                col = lerp(col, warpCol, warpBlend);
                col *= smoothstep(0.0, 0.045, limb);          // crisp black edge kill
                return half4(col * _Emission, 1);
            }
            ENDHLSL
        }
    }
}
