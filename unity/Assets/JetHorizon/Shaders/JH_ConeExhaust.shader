// Thruster cone exhaust (spec/03 §9, PYLON preset shader) — simplex FBM noise +
// neonRamp (hot white core → saturated color → dark) + fresnel edge fade.
Shader "JH/ConeExhaust"
{
    Properties
    {
        _Color ("Color", Color) = (0.27, 0.67, 1, 1)
        _NeonPower ("Neon Power", Float) = 0.90
        _NoiseSpeed ("Noise Speed", Float) = 0.80
        _NoiseStrength ("Noise Strength", Float) = 0.13
        _FresnelPower ("Fresnel Power", Float) = 6.0
        _Opacity ("Opacity", Range(0,1)) = 1.0
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+20" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Blend SrcAlpha One
            ZWrite Off
            ZTest Always
            Cull Off

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Color;
                half _NeonPower, _NoiseSpeed, _NoiseStrength, _FresnelPower, _Opacity;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float vHeight : TEXCOORD1;
                float3 normalWS : TEXCOORD2;
                float3 viewDirWS : TEXCOORD3;
            };

            float2 hash2(float2 p)
            {
                p = float2(dot(p, float2(127.1, 311.7)), dot(p, float2(269.5, 183.3)));
                return -1.0 + 2.0 * frac(sin(p) * 43758.5453123);
            }
            float snoise2(float2 p)
            {
                const float K1 = 0.366025404, K2 = 0.211324865;
                float2 i = floor(p + (p.x + p.y) * K1);
                float2 a = p - i + (i.x + i.y) * K2;
                float m = step(a.y, a.x);
                float2 o = float2(m, 1.0 - m);
                float2 b = a - o + K2;
                float2 c = a - 1.0 + 2.0 * K2;
                float3 h = max(0.5 - float3(dot(a,a), dot(b,b), dot(c,c)), 0.0);
                h = h * h * h * h;
                float3 n = h * float3(dot(a, hash2(i)), dot(b, hash2(i + o)), dot(c, hash2(i + 1.0)));
                return dot(n, float3(70.0, 70.0, 70.0));
            }
            float fbm(float2 p)
            {
                float f = 0.0;
                f += 0.5000 * snoise2(p); p *= 2.02;
                f += 0.2500 * snoise2(p); p *= 2.03;
                f += 0.1250 * snoise2(p);
                return f / 0.875;
            }
            half3 neonRamp(float value, half3 color)
            {
                float ramp = saturate(value);
                half3 outCol = half3(0,0,0);
                ramp = ramp * ramp; outCol += pow(color, half3(4,4,4)) * ramp;
                ramp = ramp * ramp; outCol += color * ramp;
                ramp = ramp * ramp; outCol += half3(1,1,1) * ramp;
                return outCol;
            }

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                float3 posWS = TransformObjectToWorld(IN.positionOS.xyz);
                OUT.positionHCS = TransformWorldToHClip(posWS);
                OUT.uv = IN.uv;
                OUT.vHeight = IN.uv.y;                 // 0 nozzle → 1 tip on cone UVs
                OUT.normalWS = TransformObjectToWorldNormal(IN.normalOS);
                OUT.viewDirWS = GetWorldSpaceNormalizeViewDir(posWS);
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float grad = 1.0 - IN.vHeight;
                float2 noiseUV = float2(IN.uv.x * 3.0, IN.uv.y * 0.6 - _Time.y * _NoiseSpeed);
                float n = fbm(noiseUV) * _NoiseStrength;
                grad = saturate(grad + n);
                half3 col = neonRamp(pow(grad, _NeonPower), _Color.rgb);
                float fresnel = 1.0 - saturate(dot(normalize(IN.normalWS), normalize(IN.viewDirWS)));
                float edgeFade = 1.0 - pow(fresnel, _FresnelPower);
                float alpha = grad * edgeFade * _Opacity;
                alpha *= smoothstep(0.0, 0.08, grad);
                return half4(col, alpha);
            }
            ENDHLSL
        }
    }
}
