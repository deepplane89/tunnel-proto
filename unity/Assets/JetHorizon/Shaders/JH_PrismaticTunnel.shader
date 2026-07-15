Shader "JH/PrismaticTunnel"
{
    Properties
    {
        _Opacity ("Opacity", Range(0,2)) = 0.82
        _TimeValue ("Time", Float) = 0
        _FadeNear ("Fade Near", Float) = 10
        _FadeFar ("Fade Far", Float) = -250
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+12" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Blend SrcAlpha One
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half _Opacity;
                float _TimeValue;
                float _FadeNear;
                float _FadeFar;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float2 uv : TEXCOORD2;
            };

            float3 hue(float h)
            {
                float3 p = abs(frac(h + float3(0.0, 0.666667, 0.333333)) * 6.0 - 3.0);
                return saturate(p - 1.0);
            }

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionWS = TransformObjectToWorld(IN.positionOS.xyz);
                OUT.normalWS = normalize(TransformObjectToWorldNormal(IN.normalOS));
                OUT.positionHCS = TransformWorldToHClip(OUT.positionWS);
                OUT.uv = IN.uv;
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float3 viewDir = normalize(GetCameraPositionWS() - IN.positionWS);
                float fresnel = pow(1.0 - saturate(abs(dot(normalize(IN.normalWS), viewDir))), 1.65);
                float travel = IN.uv.y * 0.065 - _TimeValue * 0.26;
                float rainbowPhase = travel + IN.uv.x * 0.55;
                float3 spectrum = hue(rainbowPhase);

                // Continuous membrane plus two scales of energized ribs.
                float rib = 1.0 - smoothstep(0.025, 0.11, abs(frac(IN.uv.y) - 0.5));
                float fineRib = 1.0 - smoothstep(0.03, 0.10, abs(frac(IN.uv.y * 4.0) - 0.5));
                float arcRail = 1.0 - smoothstep(0.018, 0.07, abs(frac(IN.uv.x * 12.0) - 0.5));
                float wave = 0.5 + 0.5 * sin((IN.uv.y * 1.5 + IN.uv.x * 8.0) - _TimeValue * 4.2);
                float membrane = 0.10 + fresnel * 0.52 + wave * 0.10;
                float energy = membrane + rib * 1.45 + fineRib * 0.26 + arcRail * 0.18;

                float distanceFade = saturate((IN.positionWS.z - _FadeFar) / max(0.001, _FadeNear - _FadeFar));
                distanceFade = smoothstep(0.0, 0.24, distanceFade) * smoothstep(_FadeNear, _FadeNear - 10.0, IN.positionWS.z);
                float alpha = saturate(energy * _Opacity * distanceFade);
                float3 color = spectrum * (0.70 + energy * 1.65) + float3(0.12, 0.40, 0.75) * fresnel;
                return half4(color * _Opacity * distanceFade, alpha);
            }
            ENDHLSL
        }
    }
}
