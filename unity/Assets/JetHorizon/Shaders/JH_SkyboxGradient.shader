// Two-color synthwave sky gradient (spec/03 §4a): smoothstep around a horizon line.
Shader "JH/SkyboxGradient"
{
    Properties
    {
        _TopColor ("Top Color", Color) = (0.012, 0.027, 0.06, 1)
        _BotColor ("Bottom Color", Color) = (0.03, 0.06, 0.165, 1)
        _HorizonLine ("Horizon Line", Range(0,1)) = 0.38
        _PanoTex ("Milkyway Panorama", 2D) = "black" {}
        _PanoBrightness ("Pano Brightness", Range(0,6)) = 0
        _PanoTint ("Pano Tint", Color) = (0.56, 1, 1, 1)
        _PanoOffsetY ("Pano Offset Y", Float) = -0.06
        _StarTint ("Star Tint", Color) = (0.40, 0.56, 0.78, 1)
        _StarBrightness ("Star Brightness", Range(0,8)) = 3.7
        _StarDensity ("Star Density", Range(0,1)) = 1
        _MilkyWayStrength ("Milky Way Strength", Range(0,2)) = 0.55
        _Twinkle ("Twinkle", Range(0,1)) = 0.18
    }
    SubShader
    {
        Tags { "RenderType"="Background" "Queue"="Background" "RenderPipeline"="UniversalPipeline" "PreviewType"="Skybox" }
        Cull Off ZWrite Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_PanoTex); SAMPLER(sampler_PanoTex);
            CBUFFER_START(UnityPerMaterial)
                half4 _TopColor;
                half4 _BotColor;
                half  _HorizonLine;
                float4 _PanoTex_ST;
                half  _PanoBrightness;
                half4 _PanoTint;
                half  _PanoOffsetY;
                half4 _StarTint;
                half  _StarBrightness;
                half  _StarDensity;
                half  _MilkyWayStrength;
                half  _Twinkle;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings { float4 positionHCS : SV_POSITION; float3 dirWS : TEXCOORD0; };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionHCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.dirWS = IN.positionOS.xyz;
                return OUT;
            }

            float hash21(float2 p)
            {
                p = frac(p * float2(127.1, 311.7));
                p += dot(p, p + 19.19);
                return frac(p.x * p.y);
            }

            float starCell(float2 uv, float2 cells, float threshold, float radius, float seed)
            {
                float2 p = uv * cells;
                float2 id = floor(p);
                float2 gv = frac(p) - 0.5;
                float rnd = hash21(id + seed);
                float2 offset = float2(hash21(id + seed + 17.2), hash21(id + seed + 83.1)) - 0.5;
                float d = length(gv - offset * 0.72);
                float size = radius * lerp(0.65, 1.35, hash21(id + seed + 4.7));
                float aa = max(fwidth(d), 0.001);
                float core = smoothstep(size + aa, size - aa, d) * step(threshold, rnd);
                float phase = hash21(id + seed + 41.3) * 6.2831853;
                float speed = lerp(0.35, 1.10, hash21(id + seed + 63.8));
                float pulse = 1.0 + sin(_Time.y * speed + phase) * _Twinkle;
                return core * pulse;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                // map view elevation to the JS screen-space vUv.y feel:
                // horizon (y=0) ≈ vUv.y 0.38; zenith → 1
                float3 d = normalize(IN.dirWS);
                float y = d.y;
                float v = saturate(_HorizonLine + y * 0.9);
                half t = smoothstep(_HorizonLine - 0.05, _HorizonLine + 0.25, v);
                half3 col = lerp(_BotColor.rgb, _TopColor.rgb, t);

                // Milky-way panorama layer (spec/03 §4b): equirect sample, cyan-shifted,
                // faded out at the horizon so the sun band stays clean.
                float2 panoUV;
                panoUV.x = atan2(d.x, -d.z) / (2.0 * PI) + 0.5;
                panoUV.y = saturate(asin(clamp(y, -1, 1)) / PI + 0.5 + _PanoOffsetY);
                half3 pano = SAMPLE_TEXTURE2D(_PanoTex, sampler_PanoTex, panoUV).rgb;
                col += pano * _PanoBrightness * _PanoTint.rgb * smoothstep(0.02, 0.22, y);

                // Deterministic GPU star layers. Direction-space placement keeps the sky
                // stable through camera rolls and avoids hundreds of tiny GameObjects.
                float densityThreshold = lerp(0.997, 0.962, _StarDensity);
                float stars = starCell(panoUV, float2(210.0, 105.0), densityThreshold, 0.060, 3.1);
                stars += starCell(panoUV, float2(96.0, 48.0), min(0.995, densityThreshold + 0.017), 0.095, 91.7) * 1.55;

                // A restrained diagonal Milky Way made from denser micro-stars, not a PNG.
                float bandCenter = 0.55 + 0.12 * sin((panoUV.x - 0.5) * 3.4);
                float band = smoothstep(0.18, 0.015, abs(panoUV.y - bandCenter));
                float bandStars = starCell(panoUV, float2(320.0, 160.0),
                    lerp(0.999, 0.945, _StarDensity), 0.042, 217.4);
                stars += bandStars * band * _MilkyWayStrength;

                float horizonFade = smoothstep(-0.34, -0.04, y);
                half3 starColor = lerp(half3(1.0, 1.0, 1.0), _StarTint.rgb, 0.55);
                col += starColor * stars * _StarBrightness * horizonFade;

                return half4(col, 1);
            }
            ENDHLSL
        }
    }
}
