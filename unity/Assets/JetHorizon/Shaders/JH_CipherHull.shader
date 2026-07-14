Shader "JH/CipherHull"
{
    Properties
    {
        _BaseColor ("Base", Color) = (0,0,0,1)
        _GlowColor ("Diamond Glow", Color) = (0.2,0.76,1,1)
        _DiamondScale ("Diamond Scale", Float) = 0.5
        _BumpStrength ("Bump", Range(0,1)) = 0.6
        _GlowMultiplier ("Glow", Float) = 0.9
        _Smoothness ("Smoothness", Range(0,1)) = 1
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
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _BaseColor;
                half4 _GlowColor;
                half _DiamondScale;
                half _BumpStrength;
                half _GlowMultiplier;
                half _Smoothness;
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
                OUT.positionHCS = TransformWorldToHClip(OUT.positionWS);
                OUT.normalWS = normalize(TransformObjectToWorldNormal(IN.normalOS));
                return OUT;
            }

            float diamondHeight(float2 p)
            {
                float2 r = float2(p.x + p.y, p.y - p.x) * max(0.001, _DiamondScale);
                float2 f = abs(frac(r) - 0.5) * 2.0;
                return 1.0 - max(f.x, f.y);
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float3 baseN = normalize(IN.normalWS);
                float3 an = abs(baseN);
                float2 uv = an.x > an.y && an.x > an.z ? IN.positionWS.yz
                          : an.y > an.z ? IN.positionWS.xz : IN.positionWS.xy;
                float h = diamondHeight(uv);
                float2 grad = float2(ddx(h), ddy(h)) * _BumpStrength;
                float3 n = normalize(baseN + float3(grad.x, grad.y, -(grad.x + grad.y)));

                float edge = smoothstep(0.10, 0.50, 1.0 - h);
                Light mainLight = GetMainLight();
                float ndl = saturate(dot(n, mainLight.direction));
                float3 viewDir = normalize(GetCameraPositionWS() - IN.positionWS);
                float3 halfDir = normalize(mainLight.direction + viewDir);
                float spec = pow(saturate(dot(n, halfDir)), lerp(24.0, 180.0, _Smoothness));
                float fresnel = pow(1.0 - saturate(dot(n, viewDir)), 4.0);

                half3 color = _BaseColor.rgb * (0.08 + ndl * mainLight.color);
                color += spec * mainLight.color * 1.4;
                color += fresnel * _GlowColor.rgb * 0.20;
                color += _GlowColor.rgb * edge * _GlowMultiplier;
                return half4(color, 1);
            }
            ENDHLSL
        }
    }
}
