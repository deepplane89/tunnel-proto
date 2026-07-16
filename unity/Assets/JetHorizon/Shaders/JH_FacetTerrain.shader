Shader "JH/FacetTerrain"
{
    Properties
    {
        _Surface ("Facet Surface", 2D) = "white" {}
        _Body ("Terrain Body", Color) = (0.045, 0.24, 0.30, 1)
        _Brightness ("Brightness", Range(0, 2)) = 0.88
        _Emission ("Emission", Range(0, 2)) = 0.20
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
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float2 uv : TEXCOORD1;
            };

            CBUFFER_START(UnityPerMaterial)
                half4 _Body;
                float _Brightness;
                float _Emission;
            CBUFFER_END

            TEXTURE2D(_Surface);
            SAMPLER(sampler_Surface);

            Varyings vert(Attributes input)
            {
                Varyings output;
                VertexPositionInputs position = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = position.positionCS;
                output.positionWS = position.positionWS;
                output.uv = input.uv;
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                float2 surfaceUv = float2(frac(input.uv.x), saturate(input.uv.y));
                half3 surface = SAMPLE_TEXTURE2D(_Surface, sampler_Surface, surfaceUv).rgb;
                float3 geometricNormal = normalize(cross(ddy(input.positionWS), ddx(input.positionWS)));
                float key = saturate(dot(geometricNormal, normalize(float3(0.62, 0.48, 0.62))) * 0.5 + 0.5);
                float facet = lerp(0.48, 1.08, key);
                half3 crystal = lerp(_Body.rgb, surface, 0.62) * (_Brightness * facet);
                half detail = saturate((max(surface.r, max(surface.g, surface.b)) - 0.04) * 1.8);
                crystal += surface * _Emission * lerp(0.18, 1.0, detail);
                return half4(crystal, 1.0);
            }
            ENDHLSL
        }
    }
}
