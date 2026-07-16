Shader "JH/Laser"
{
    Properties
    {
        _Tint ("Tint", Color) = (1,0.12,0.02,1)
        _Intensity ("Intensity", Float) = 1
        _EdgeSoftness ("Edge Softness", Range(0.02,0.5)) = 0.2
        _PulseSpeed ("Pulse Speed", Float) = 18
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+30" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Blend SrcAlpha One
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Tint;
                float _Intensity;
                float _EdgeSoftness;
                float _PulseSpeed;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                half4 color : COLOR;
            };
            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                half4 color : COLOR;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionHCS = TransformObjectToHClip(IN.positionOS.xyz);
                OUT.uv = IN.uv;
                OUT.color = IN.color;
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float across = abs(IN.uv.y * 2.0 - 1.0);
                float softEdge = 1.0 - smoothstep(1.0 - _EdgeSoftness, 1.0, across);
                float longitudinal = smoothstep(0.0, 0.08, IN.uv.x) * (1.0 - smoothstep(0.82, 1.0, IN.uv.x));
                float pulse = 0.86 + 0.14 * sin(_Time.y * _PulseSpeed - IN.uv.x * 18.0);
                half3 color = _Tint.rgb * IN.color.rgb * _Intensity * pulse;
                return half4(color, _Tint.a * IN.color.a * softEdge * longitudinal);
            }
            ENDHLSL
        }
    }
}
