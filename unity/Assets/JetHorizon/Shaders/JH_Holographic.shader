// Verbatim HLSL port of src/15-holographic-material.js (Anderson Mancini, MIT).
// GHOST ship skin: color #00e0ff, fresnelAmount .70, fresnelOpacity .82, scanlineSize 5.5,
// brightness 1.94, signalSpeed 0 (clean holo), opacity 0.31, Normal blending.
// Powerup cubes: defaults with signalSpeed 1 (scanlines on), Additive blending.
Shader "JH/Holographic"
{
    Properties
    {
        _HologramColor ("Hologram Color", Color) = (0, 0.84, 1, 1)
        _FresnelOpacity ("Fresnel Opacity", Range(0,1)) = 1.0
        _FresnelAmount ("Fresnel Amount", Range(0,2)) = 0.45
        _ScanlineSize ("Scanline Size", Float) = 8.0
        _SignalSpeed ("Signal Speed", Float) = 1.0
        _HologramBrightness ("Brightness", Float) = 1.0
        _HologramOpacity ("Opacity", Range(0,1)) = 1.0
        [Toggle] _BlinkFresnelOnly ("Blink Fresnel Only", Float) = 1
        [Toggle] _EnableBlinking ("Enable Blinking", Float) = 1
        [Enum(Additive,1,Normal,0)] _AdditiveBlend ("Blend Mode", Float) = 1
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcBlend ("Src Blend", Float) = 5
        [Enum(UnityEngine.Rendering.BlendMode)] _DstBlend ("Dst Blend", Float) = 1
        [Enum(Off,0,On,1)] _ZWrite ("ZWrite", Float) = 0
        [Enum(UnityEngine.Rendering.CompareFunction)] _ZTest ("ZTest", Float) = 4
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Blend [_SrcBlend] [_DstBlend]
            ZWrite [_ZWrite]
            ZTest [_ZTest]
            Cull Off

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _HologramColor;
                half _FresnelOpacity, _FresnelAmount, _ScanlineSize, _SignalSpeed;
                half _HologramBrightness, _HologramOpacity;
                half _BlinkFresnelOnly, _EnableBlinking;
                half _AdditiveBlend, _SrcBlend, _DstBlend, _ZWrite, _ZTest;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; float2 uv : TEXCOORD0; };
            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float4 vPos : TEXCOORD1;
                float3 normalW : TEXCOORD2;
                float3 positionW : TEXCOORD3;
            };

            float flicker(float amt, float t) { return clamp(frac(cos(t) * 43758.5453123), amt, 1.0); }
            float rnd2(float a, float b) { return frac(cos(dot(float2(a, b), float2(12.9898, 78.233))) * 43758.5453); }

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.positionW = TransformObjectToWorld(IN.positionOS.xyz);
                OUT.positionHCS = TransformWorldToHClip(OUT.positionW);
                OUT.vPos = OUT.positionHCS;
                OUT.normalW = normalize(TransformObjectToWorldNormal(IN.normalOS));
                OUT.uv = IN.uv;
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float time = _Time.y;
                float2 vCoords = IN.vPos.xy / IN.vPos.w;
                vCoords = vCoords * 0.5 + 0.5;
                float2 myUV = frac(vCoords);

                half4 holoCol = half4(_HologramColor.rgb, lerp(_HologramBrightness, IN.uv.y, 0.5));

                float scanlines = 10.0;
                scanlines += 20.0 * sin(time * _SignalSpeed * 20.8 - myUV.y * 60.0 * _ScanlineSize);
                scanlines *= smoothstep(1.3 * cos(time * _SignalSpeed + myUV.y * _ScanlineSize), 0.78, 0.9);
                scanlines *= max(0.25, sin(time * _SignalSpeed) * 1.0);

                float r = rnd2(IN.uv.x, IN.uv.y);
                float b = rnd2(IN.uv.y * 0.9, IN.uv.y * 0.2);

                // Gate scanline noise on signalSpeed (ghost ship = clean holo)
                float signalGate = clamp(_SignalSpeed * 50.0, 0.0, 1.0);
                holoCol += (half4(r * scanlines, b * scanlines, r, 1.0) / 84.0) * signalGate;
                half4 scanlineMix = lerp(half4(0,0,0,0), holoCol, holoCol.a);

                float3 viewDirectionW = normalize(GetCameraPositionWS() - IN.positionW);
                float fresnelEffect = dot(viewDirectionW, normalize(IN.normalW)) * (1.6 - _FresnelOpacity / 2.0);
                fresnelEffect = clamp(_FresnelAmount - fresnelEffect, 0.0, _FresnelOpacity);

                float blinkValue = _EnableBlinking > 0.5 ? 0.6 - _SignalSpeed : 1.0;
                float blink = flicker(blinkValue, time * _SignalSpeed * 0.02);

                half3 finalColor;
                if (_BlinkFresnelOnly > 0.5)
                    finalColor = scanlineMix.rgb + fresnelEffect * blink;
                else
                    finalColor = scanlineMix.rgb * blink + fresnelEffect;

                finalColor = min(finalColor, half3(0.95, 0.95, 0.95));   // stay under bloom threshold
                return half4(finalColor, _HologramOpacity);
            }
            ENDHLSL
        }
    }
}
