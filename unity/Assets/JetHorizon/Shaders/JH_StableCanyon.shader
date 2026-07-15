Shader "JH/StableCanyon"
{
    Properties
    {
        _CyanSurface ("Original Cyan Slab Surface", 2D) = "white" {}
        _DarkSurface ("Original Dark Slab Surface", 2D) = "black" {}
        _CyanBody ("Cyan Body", Color) = (0.07, 0.35, 0.40, 1)
        _DarkBody ("Dark Body", Color) = (0.10, 0.06, 0.16, 1)
        _Brightness ("Brightness", Range(0, 1)) = 0.72
        _Emission ("Emission", Range(0, 2)) = 0.28
        _FadeStart ("Fade Start", Float) = -305
        _FadeEnd ("Fade End", Float) = -235
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
                half4 _CyanBody;
                half4 _DarkBody;
                float _Brightness;
                float _Emission;
                float _FadeStart;
                float _FadeEnd;
            CBUFFER_END

            TEXTURE2D(_CyanSurface);
            SAMPLER(sampler_CyanSurface);
            TEXTURE2D(_DarkSurface);
            SAMPLER(sampler_DarkSurface);

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

                float2 surfaceUv = float2(frac(input.uv.x), input.uv.y);
                half3 cyanSurface = SAMPLE_TEXTURE2D(_CyanSurface, sampler_CyanSurface, surfaceUv).rgb;
                half3 darkSurface = SAMPLE_TEXTURE2D(_DarkSurface, sampler_DarkSurface, surfaceUv).rgb;
                float darkBand = frac(floor(max(0.0, input.uv.x + 0.001)) * 0.5) * 2.0;
                half3 surface = lerp(cyanSurface, darkSurface, darkBand);
                half3 body = lerp(_CyanBody.rgb, _DarkBody.rgb, darkBand);

                // Derivatives keep every generated triangle visually flat without
                // splitting the seam-locked vertices that make the route watertight.
                float3 geometricNormal = normalize(cross(ddy(input.positionWS), ddx(input.positionWS)));
                float facet = 0.67 + 0.33 * abs(dot(
                    geometricNormal,
                    normalize(float3(0.62, 0.45, 0.65))));
                half3 crystal = lerp(body, surface, 0.72) * (_Brightness * facet) * input.color.rgb;
                half emissiveDetail = saturate((max(surface.r, max(surface.g, surface.b)) - 0.06) * 1.6);
                crystal += surface * _Emission * lerp(0.25, 1.0, emissiveDetail);
                crystal = MixFog(crystal, input.fogFactor);
                return half4(crystal, 1.0);
            }
            ENDHLSL
        }
    }
}
