Shader "JH/ShipHull"
{
    Properties
    {
        _BaseColor ("Hull Color", Color) = (0.055,0.063,0.08,1)
        _AccentColor ("Panel Accent", Color) = (0.08,0.25,0.55,1)
        _Metallic ("Metallic", Range(0,1)) = 0.9
        _Smoothness ("Smoothness", Range(0,1)) = 0.7
        _PanelScale ("Panel Scale", Float) = 2
        _PanelStrength ("Panel Relief", Range(0,1)) = 0.22
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Tags { "LightMode"="UniversalForward" }
            Cull Back
            ZWrite On

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _ADDITIONAL_LIGHTS
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half4 _AccentColor;
                half _Metallic;
                half _Smoothness;
                float _PanelScale;
                float _PanelStrength;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float3 positionWS : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionWS = TransformObjectToWorld(IN.positionOS.xyz);
                OUT.normalWS = normalize(TransformObjectToWorldNormal(IN.normalOS));
                OUT.positionHCS = TransformWorldToHClip(OUT.positionWS);
                return OUT;
            }

            float panelCell(float2 uv)
            {
                float2 a = frac(uv) - 0.5;
                float2 b = frac(uv + 0.5) - 0.5;
                float cell = min(length(a), length(b));
                return 1.0 - smoothstep(0.30, 0.46, cell);
            }

            half3 EvaluateLight(Light light, float3 n, float3 viewDirection, half3 albedo, float panel)
            {
                float ndl = saturate(dot(n, light.direction));
                float3 halfDirection = normalize(light.direction + viewDirection);
                float specularPower = lerp(24.0, 180.0, _Smoothness);
                float specular = pow(saturate(dot(n, halfDirection)), specularPower);
                float panelSpec = lerp(0.72, 1.2, panel);
                return (albedo * ndl * (1.0 - _Metallic * 0.72)
                    + specular * lerp(half3(0.04, 0.04, 0.04), albedo, _Metallic) * panelSpec * 2.2) * light.color * light.distanceAttenuation;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float3 n = normalize(IN.normalWS);
                float3 absN = abs(n);
                float2 uvXZ = IN.positionWS.xz * _PanelScale;
                float2 uvXY = IN.positionWS.xy * _PanelScale;
                float panel = lerp(panelCell(uvXY), panelCell(uvXZ), absN.y);
                float groove = smoothstep(0.04, 0.55, panel);
                half3 albedo = _BaseColor.rgb * lerp(0.72, 1.06, groove);
                albedo += _AccentColor.rgb * panel * _PanelStrength * 0.12;

                float3 viewDirection = normalize(GetCameraPositionWS() - IN.positionWS);
                Light mainLight = GetMainLight();
                half3 color = albedo * half3(0.16, 0.18, 0.24);
                color += EvaluateLight(mainLight, n, viewDirection, albedo, panel);
                #if defined(_ADDITIONAL_LIGHTS)
                    uint lightCount = GetAdditionalLightsCount();
                    for (uint i = 0u; i < lightCount; i++)
                        color += EvaluateLight(GetAdditionalLight(i, IN.positionWS), n, viewDirection, albedo, panel);
                #endif
                float fresnel = pow(1.0 - saturate(dot(n, viewDirection)), 4.0);
                color += _AccentColor.rgb * fresnel * 0.16;
                color += _AccentColor.rgb * panel * _PanelStrength * 0.10;
                return half4(color, 1.0);
            }
            ENDHLSL
        }
    }
}
