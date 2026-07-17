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
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

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
            };

            CBUFFER_START(UnityPerMaterial)
                half4 _CyanBody;
                half4 _DarkBody;
                float _Brightness;
                float _Emission;
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
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                // The canyon is a persistent landform, not a streamed obstacle row.
                // Distance dithering made its far chunks visibly materialize as the
                // player advanced. Let camera fog and real geometry provide depth;
                // keep every authored canyon section fully opaque once it is visible.

                float2 surfaceUv = float2(frac(input.uv.x), input.uv.y);
                half3 cyanSurface = SAMPLE_TEXTURE2D(_CyanSurface, sampler_CyanSurface, surfaceUv).rgb;
                half3 darkSurface = SAMPLE_TEXTURE2D(_DarkSurface, sampler_DarkSurface, surfaceUv).rgb;
                float darkBand = frac(floor(max(0.0, input.uv.x + 0.001)) * 0.5) * 2.0;
                half3 surface = lerp(cyanSurface, darkSurface, darkBand);
                half3 body = lerp(_CyanBody.rgb, _DarkBody.rgb, darkBand);

                // Derivatives keep every generated triangle visually flat without
                // splitting the seam-locked vertices that make the route watertight.
                float3 geometricNormal = normalize(cross(ddy(input.positionWS), ddx(input.positionWS)));
                float3 viewDirection = SafeNormalize(GetWorldSpaceViewDir(input.positionWS));
                // Generated terrain is intentionally double-sided. Orient the
                // derivative normal toward the viewer so either wall receives
                // the same crisp, low-poly light response.
                if (dot(geometricNormal, viewDirection) < 0.0)
                    geometricNormal = -geometricNormal;

                Light keyLight = GetMainLight();
                float lightFacing = saturate(dot(geometricNormal, keyLight.direction));
                float3 halfDirection = SafeNormalize(keyLight.direction + viewDirection);
                // Cyan faces are polished ice; dark plates are glossier obsidian.
                float gloss = lerp(34.0, 62.0, darkBand);
                float highlight = pow(saturate(dot(geometricNormal, halfDirection)), gloss);
                float rim = pow(1.0 - saturate(dot(geometricNormal, viewDirection)), 4.0);
                float facet = 0.84 + 0.16 * abs(dot(
                    geometricNormal,
                    normalize(float3(0.62, 0.45, 0.65))));
                half3 baseCrystal = lerp(body, surface, 0.72) * input.color.rgb;
                half3 direct = baseCrystal * (0.26 + lightFacing * keyLight.color * 0.90);
                half3 specular = keyLight.color * highlight * lerp(0.30, 0.68, darkBand);
                half3 edgeLight = lerp(half3(0.02, 0.14, 0.20), half3(0.18, 0.015, 0.26), darkBand) * rim;
                half3 crystal = (direct + specular + edgeLight) * (_Brightness * facet);
                half emissiveDetail = saturate((max(surface.r, max(surface.g, surface.b)) - 0.06) * 1.6);
                crystal += surface * _Emission * lerp(0.25, 1.0, emissiveDetail);
                // Global exponential fog is intentionally excluded here. In the
                // fixed-camera Z-scroll presentation it becomes a stationary reveal
                // curtain that makes already-built canyon facets appear to spawn.
                return half4(crystal, 1.0);
            }
            ENDHLSL
        }
    }
}
