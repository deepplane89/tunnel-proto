// Neon obstacle shader: obsidian body + neon tint band/edge glow + fade-in.
// Used for cones, angled walls, zipper/slalom cones (tint via MaterialPropertyBlock).
Shader "JH/NeonCone"
{
    Properties
    {
        _Tint ("Tint", Color) = (1, 0.1, 0.55, 1)
        _Fade ("Fade", Range(0,1)) = 1
        _BodyColor ("Body Color", Color) = (0.07, 0.07, 0.10, 1)
        _GlowStrength ("Glow Strength", Range(0,4)) = 1.6
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite On
            Cull Back

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 viewDirWS : TEXCOORD2;
                float fogFactor : TEXCOORD3;
            };

            CBUFFER_START(UnityPerMaterial)
                half4 _Tint;
                half  _Fade;
                half4 _BodyColor;
                half  _GlowStrength;
            CBUFFER_END

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                float3 posWS = TransformObjectToWorld(IN.positionOS.xyz);
                OUT.positionHCS = TransformWorldToHClip(posWS);
                OUT.uv = IN.uv;
                OUT.normalWS = TransformObjectToWorldNormal(IN.normalOS);
                OUT.viewDirWS = GetWorldSpaceNormalizeViewDir(posWS);
                OUT.fogFactor = ComputeFogFactor(OUT.positionHCS.z);
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                half fresnel = 1.0 - saturate(dot(normalize(IN.normalWS), normalize(IN.viewDirWS)));
                // neon UV band around the lower-middle (uGlowBot 0.255 / uGlowTop 0.345 vibe)
                half band = smoothstep(0.18, 0.28, IN.uv.y) * smoothstep(0.45, 0.35, IN.uv.y);
                half glow = saturate(band + pow(fresnel, 2.0));
                half3 col = lerp(_BodyColor.rgb, _Tint.rgb * _GlowStrength, glow);
                // HDR push on the band so URP bloom (threshold 1) picks it up
                col += _Tint.rgb * band * _GlowStrength;
                col = MixFog(col, IN.fogFactor);   // depth cueing like the JS FogExp2
                return half4(col, _Fade);
            }
            ENDHLSL
        }
    }
}
