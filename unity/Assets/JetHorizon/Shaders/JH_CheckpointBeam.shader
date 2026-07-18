Shader "JH/CheckpointBeam"
{
    Properties
    {
        _Tint ("Tint", Color) = (0.141, 0.847, 1, 1)
        _Opacity ("Opacity", Range(0,1)) = 0.72
        _DistanceFade ("Distance Fade", Range(0,1)) = 1
        _Reveal ("Sky To Water Reveal", Range(0,1)) = 1
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+20" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Blend SrcAlpha One
            ZWrite Off
            Cull Off

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
                float4 positionHCS : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            CBUFFER_START(UnityPerMaterial)
                half4 _Tint;
                half _Opacity;
                half _DistanceFade;
                half _Reveal;
            CBUFFER_END

            Varyings vert(Attributes input)
            {
                Varyings output;
                output.positionHCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = input.uv;
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                half baseFade = smoothstep(0.0h, 0.035h, input.uv.y);
                half skyFade = 1.0h - 0.72h * smoothstep(0.70h, 1.0h, input.uv.y);
                half bands = 0.78h + 0.22h * sin(input.uv.y * 180.0h + _Time.y * 5.0h);
                half shimmer = 0.92h + 0.08h * sin(_Time.y * 3.0h + input.uv.y * 23.0h);
                half revealEdge = 1.0h - _Reveal;
                half revealMask = smoothstep(revealEdge - 0.018h, revealEdge + 0.018h, input.uv.y);
                half leadingEdge = 1.0h - smoothstep(0.0h, 0.028h, abs(input.uv.y - revealEdge));
                half alpha = _Opacity * _DistanceFade * baseFade * skyFade
                    * (bands * revealMask + leadingEdge * 0.72h);
                half3 color = _Tint.rgb * (1.05h + 0.38h * shimmer + leadingEdge * 1.15h);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
