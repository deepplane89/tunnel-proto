Shader "JH/StableCanyon"
{
    Properties
    {
        _DarkColor ("Dark Color", Color) = (0.006, 0.009, 0.018, 1)
        _Brightness ("Brightness", Range(0, 1)) = 0.34
        _Emission ("Emission", Range(0, 2)) = 0.20
        _FadeStart ("Fade Start", Float) = -290
        _FadeEnd ("Fade End", Float) = -155
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Name "Forward"
            Tags { "LightMode"="UniversalForward" }
            Cull Off
            ZWrite On

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                float4 color : COLOR;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float2 uv : TEXCOORD1;
                float4 color : COLOR;
                float fogFactor : TEXCOORD2;
            };

            CBUFFER_START(UnityPerMaterial)
                half4 _DarkColor;
                float _Brightness;
                float _Emission;
                float _FadeStart;
                float _FadeEnd;
            CBUFFER_END

            Varyings vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs position = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = position.positionCS;
                output.positionWS = position.positionWS;
                output.uv = input.uv;
                output.color = input.color;
                output.fogFactor = ComputeFogFactor(position.positionCS.z);
                return output;
            }

            float Dither(float2 pixel)
            {
                return frac(52.9829189 * frac(dot(floor(pixel), float2(0.06711056, 0.00583715))));
            }

            half4 frag(Varyings input) : SV_Target
            {
                float fade = smoothstep(_FadeStart, _FadeEnd, input.positionWS.z);
                clip(fade - Dither(input.positionCS.xy));

                float facet = 0.72 + 0.28 * sin(input.uv.x * 19.0 + input.uv.y * 7.0);
                float seam = pow(1.0 - abs(frac(input.uv.y) * 2.0 - 1.0), 10.0);
                half3 crystal = lerp(_DarkColor.rgb, input.color.rgb, 0.58) * (_Brightness * facet);
                crystal += input.color.rgb * seam * _Emission;
                crystal = MixFog(crystal, input.fogFactor);
                return half4(crystal, 1.0);
            }
            ENDHLSL
        }
    }
}
