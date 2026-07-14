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
        _BandAmount ("Neon Band Amount", Range(0,1)) = 0
        _EdgeStrength ("Edge Strength", Range(0,1)) = 0.12
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
                half  _BandAmount;
                half  _EdgeStrength;
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
                half3 n = normalize(IN.normalWS);
                half fresnel = 1.0 - saturate(dot(n, normalize(IN.viewDirWS)));

                // Source treatment: nearly-black obsidian with restrained facets. Standard
                // cones do not become fully neon merely because they approach the camera.
                half facet = 0.76 + 0.24 * saturate(dot(n, normalize(half3(-0.35, 0.75, 0.45))));
                half3 col = _BodyColor.rgb * facet;

                // The narrow floating band is opt-in for corridor/slalom language only.
                half coreBand = smoothstep(0.255, 0.292, IN.uv.y)
                              * (1.0 - smoothstep(0.308, 0.345, IN.uv.y));
                half haloBand = smoothstep(0.215, 0.278, IN.uv.y)
                              * (1.0 - smoothstep(0.322, 0.385, IN.uv.y));
                half band = saturate(coreBand + haloBand * 0.24) * _BandAmount;
                half edge = pow(fresnel, 3.0) * _EdgeStrength;

                col = lerp(col, _Tint.rgb * _GlowStrength, saturate(band + edge));
                col += _Tint.rgb * coreBand * _BandAmount * _GlowStrength * 0.85;
                col = MixFog(col, IN.fogFactor);   // depth cueing like the JS FogExp2
                return half4(col, _Fade);
            }
            ENDHLSL
        }
    }
}
