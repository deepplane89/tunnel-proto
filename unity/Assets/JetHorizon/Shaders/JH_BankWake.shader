// Bank-water wake strip (verbatim port of src/fx/19-bank-water-effect.js shaders):
// cone-tapered plane, two-octave panned noise, sine foam fingers, edge dissolve.
Shader "JH/BankWake"
{
    Properties
    {
        _Noise ("Noise (64x64 repeat)", 2D) = "gray" {}
        _Tint ("Tint", Color) = (0.918, 0.973, 1, 1)
        _Opacity ("Opacity", Range(0,1)) = 0
        _Scroll ("Scroll (V/s)", Float) = 6.0
        _Intensity ("Intensity", Range(0,1)) = 0
        _ConeShape ("Cone Shape", Range(0,1)) = 0.65
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+8" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_Noise); SAMPLER(sampler_Noise);
            CBUFFER_START(UnityPerMaterial)
                float4 _Noise_ST;
                half4 _Tint;
                half _Opacity, _Scroll, _Intensity, _ConeShape;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings { float4 positionHCS : SV_POSITION; float2 uv : TEXCOORD0; };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                // Narrow the HEAD, widen the TAIL (head 45% width at v=0)
                float taper = lerp(0.45, 1.0, IN.uv.y);
                taper = lerp(1.0, taper, _ConeShape);
                float3 p = IN.positionOS.xyz;
                p.x *= taper;
                OUT.positionHCS = TransformObjectToHClip(p);
                OUT.uv = IN.uv;
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float2 vUv = IN.uv;
                float uTime = _Time.y;

                float feather = smoothstep(0.0, 0.35, vUv.x) * smoothstep(0.0, 0.35, 1.0 - vUv.x);

                float head    = smoothstep(0.00, 0.18, vUv.y);
                float tail    = smoothstep(1.00, 0.18, vUv.y);
                float profile = head * tail;

                float panA = uTime * _Scroll;
                float panB = uTime * _Scroll * 0.55;
                float nA = SAMPLE_TEXTURE2D(_Noise, sampler_Noise, float2(vUv.x * 1.4, vUv.y * 1.5 + panA)).r;
                float nB = SAMPLE_TEXTURE2D(_Noise, sampler_Noise, float2(vUv.x * 0.7 - 0.13, vUv.y * 0.8 - panB)).r;
                float n  = (nA * 0.55 + nB * 0.45);

                float fingers = sin((vUv.y - uTime * _Scroll * 0.6) * 22.0 + n * 6.2832);
                fingers = smoothstep(0.55, 0.95, fingers);

                float dissolveThresh = lerp(0.65, 0.15, _Intensity);
                float dissolve = smoothstep(dissolveThresh - 0.10, dissolveThresh + 0.05, n + profile * 0.6);

                float alpha = (profile * feather) * dissolve;
                float bright = alpha + fingers * feather * profile * 0.85;

                return half4(_Tint.rgb * (0.65 + bright * 0.6), bright * _Opacity);
            }
            ENDHLSL
        }
    }
}
