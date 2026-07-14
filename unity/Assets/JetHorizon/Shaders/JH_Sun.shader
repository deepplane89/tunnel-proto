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
        _Emission ("Emission Boost", Range(0,4)) = 1.25
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
                half  _Emission;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 normalVS : TEXCOORD1;
                float3 posOS : TEXCOORD2;
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

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionHCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.uv = IN.uv;
                OUT.normalVS = mul((float3x3)UNITY_MATRIX_IT_MV, IN.normalOS);
                OUT.posOS = IN.positionOS.xyz;
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float t = _Time.y;
                float3 viewNormal = normalize(IN.normalVS);
                float limb = saturate(viewNormal.z);

                // View-normal coordinates produce a circular, camera-facing disc even when
                // the camera banks. UVs are retained only as a stable noise seed.
                float rd = sqrt(saturate(1.0 - limb * limb));
                float yN = saturate(viewNormal.y * 0.5 + 0.5);
                float2 surfaceUv = viewNormal.xy * 1.6 + 0.5;

                // ── PLAIN branch: dark core → bright rim, FBM churn ──
                float2 noiseUv = surfaceUv * 3.2 + float2(t * 0.015, t * 0.008);
                float n = fbm2(noiseUv);
                float churn = 0.94 + n * 0.12;
                // Relative coefficients reproduce the source's orange .68/.24/.02 core
                // and .90/.38/.04 rim while still respecting later vibe palettes.
                half3 coreCol = _SunColor.rgb * half3(0.56, 0.42, 0.50) + half3(0.12, 0.00, 0.02);
                half3 rimCol  = _SunColor.rgb * half3(0.78, 0.58, 0.72) + half3(0.12, 0.04, 0.03);
                half3 col = lerp(coreCol, rimCol, smoothstep(0.15, 0.85, rd));
                col += (_SunColor.rgb * 0.12 + half3(0.06, 0.03, 0.01)) * smoothstep(0.45, 0.85, yN);
                col *= 1.0 - 0.08 * smoothstep(0.60, 0.48, yN);                    // bottom dim
                half3 corona = saturate(_SunColor.rgb * 1.25 + half3(0.20, 0.10, 0.04));
                float coronaBlend = smoothstep(0.82, 0.97, rd);
                float coronaBias = 0.3 + 0.7 * max(smoothstep(0.4, 0.9, yN), smoothstep(0.58, 0.50, yN) * 0.85);
                col = lerp(col, corona, coronaBlend * coronaBias);
                col *= churn;

                // ── WARP branch: Quilez double domain warp ──
                float2 p = surfaceUv * 3.5;
                float2 drift = float2(t * 0.021, t * 0.013);
                float q1 = fbm2(p + drift);
                float q2 = fbm2(p + drift + float2(5.2, 1.3));
                float r1 = fbm2(p + 3.5 * float2(q1, q2) + float2(1.7, 9.2));
                float r2 = fbm2(p + 3.5 * float2(q1, q2) + float2(8.3, 2.8));
                float f  = fbm2(p + 3.5 * float2(r1, r2));
                half3 warpCol = lerp(_WarpCol1.rgb, _WarpCol2.rgb, smoothstep(0.2, 0.7, f));
                warpCol = lerp(warpCol, _WarpCol3.rgb, smoothstep(0.6, 0.9, f));
                warpCol = lerp(warpCol, _WarpCol2.rgb * 1.1, smoothstep(0.4, 0.8, abs(q1)) * 0.35);
                warpCol *= pow(limb, 1.2) * 0.5 + 0.5;

                col = lerp(col, warpCol, _Warp);
                col *= smoothstep(0.0, 0.045, limb);          // crisp black edge kill
                return half4(col * _Emission, 1);
            }
            ENDHLSL
        }
    }
}
