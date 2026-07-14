// Two-color synthwave sky gradient (spec/03 §4a): smoothstep around a horizon line.
Shader "JH/SkyboxGradient"
{
    Properties
    {
        _TopColor ("Top Color", Color) = (0.012, 0.027, 0.06, 1)
        _BotColor ("Bottom Color", Color) = (0.03, 0.06, 0.165, 1)
        _HorizonLine ("Horizon Line", Range(0,1)) = 0.38
        _PanoTex ("Milkyway Panorama", 2D) = "black" {}
        _PanoBrightness ("Pano Brightness", Range(0,6)) = 0
        _PanoTint ("Pano Tint", Color) = (0.56, 1, 1, 1)
        _PanoOffsetY ("Pano Offset Y", Float) = -0.06
    }
    SubShader
    {
        Tags { "RenderType"="Background" "Queue"="Background" "RenderPipeline"="UniversalPipeline" "PreviewType"="Skybox" }
        Cull Off ZWrite Off

        Pass
        {
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_PanoTex); SAMPLER(sampler_PanoTex);
            CBUFFER_START(UnityPerMaterial)
                half4 _TopColor;
                half4 _BotColor;
                half  _HorizonLine;
                float4 _PanoTex_ST;
                half  _PanoBrightness;
                half4 _PanoTint;
                half  _PanoOffsetY;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; };
            struct Varyings { float4 positionHCS : SV_POSITION; float3 dirWS : TEXCOORD0; };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionHCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.dirWS = IN.positionOS.xyz;
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                // map view elevation to the JS screen-space vUv.y feel:
                // horizon (y=0) ≈ vUv.y 0.38; zenith → 1
                float3 d = normalize(IN.dirWS);
                float y = d.y;
                float v = saturate(_HorizonLine + y * 0.9);
                half t = smoothstep(_HorizonLine - 0.05, _HorizonLine + 0.25, v);
                half3 col = lerp(_BotColor.rgb, _TopColor.rgb, t);

                // Milky-way panorama layer (spec/03 §4b): equirect sample, cyan-shifted,
                // faded out at the horizon so the sun band stays clean.
                float2 panoUV;
                panoUV.x = atan2(d.x, -d.z) / (2.0 * PI) + 0.5;
                panoUV.y = saturate(asin(clamp(y, -1, 1)) / PI + 0.5 + _PanoOffsetY);
                half3 pano = SAMPLE_TEXTURE2D(_PanoTex, sampler_PanoTex, panoUV).rgb;
                col += pano * _PanoBrightness * _PanoTint.rgb * smoothstep(0.02, 0.22, y);

                return half4(col, 1);
            }
            ENDHLSL
        }
    }
}
