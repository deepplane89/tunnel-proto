// The universal reflective black water floor (spec/03 §5b):
// pitch-black base + forward-scrolling normal map (uFlowZ = 0.45 × speed) +
// fresnel sky tint + amber directional sun streak toward the horizon.
// (A screen-space planar reflection can be layered later; this matches the
// original's read at gameplay camera angles.)
Shader "JH/Water"
{
    Properties
    {
        _NormalMap ("Normal Map", 2D) = "bump" {}
        _WaterColor ("Water Color", Color) = (0, 0, 0, 1)
        _SunColor ("Sun Streak Color", Color) = (0.55, 0.28, 0.03, 1)
        _SkyColor ("Fresnel Sky Color", Color) = (0.03, 0.06, 0.165, 1)
        _FlowZ ("Flow Z", Float) = 0
        _RippleSize ("Ripple Size", Float) = 8.0
        _Distortion ("Distortion", Float) = 0.6
        _ReflectionStrength ("Reflection Strength", Range(0, 2)) = 1.15
        _SunDir ("Sun Direction", Vector) = (0, 0.3, -1, 0)
        _ShipX ("Ship X", Float) = 0
        _ShipZ ("Ship Z", Float) = 3.9
        _SpeedIntensity ("Speed Intensity", Range(0, 1)) = 0
        _GatePulse ("Gate Pulse", Range(0, 1)) = 0
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry-10" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            ZWrite On
            Cull Back

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_NormalMap); SAMPLER(sampler_NormalMap);
            TEXTURE2D(_ReflectionTex); SAMPLER(sampler_ReflectionTex);
            CBUFFER_START(UnityPerMaterial)
                float4 _NormalMap_ST;
                half4 _WaterColor, _SunColor, _SkyColor;
                float _FlowZ, _RippleSize, _Distortion, _ReflectionStrength;
                float4 _SunDir;
                float _ShipX, _ShipZ, _SpeedIntensity, _GatePulse;
            CBUFFER_END

            struct Attributes { float4 positionOS : POSITION; float2 uv : TEXCOORD0; };
            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float3 posWS : TEXCOORD0;
                float fogFactor : TEXCOORD1;
                float4 screenPos : TEXCOORD2;
            };

            float4 ScreenPosJH(float4 hclip)
            {
                float4 o = hclip * 0.5;
                o.xy = float2(o.x, o.y * _ProjectionParams.x) + o.w;
                o.zw = hclip.zw;
                return o;
            }

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                OUT.posWS = TransformObjectToWorld(IN.positionOS.xyz);
                OUT.positionHCS = TransformWorldToHClip(OUT.posWS);
                OUT.fogFactor = ComputeFogFactor(OUT.positionHCS.z);
                OUT.screenPos = ScreenPosJH(OUT.positionHCS);
                return OUT;
            }

            half3 SampleWaveNormal(float2 worldXZ)
            {
                // two scales, opposing drift — matches three.js Water's getNoise composite
                float2 uv0 = (worldXZ + float2(0, _FlowZ)) / _RippleSize;
                float t = _Time.y;
                half3 n0 = UnpackNormal(SAMPLE_TEXTURE2D(_NormalMap, sampler_NormalMap, uv0 + float2(t * 0.03, t * 0.01)));
                half3 n1 = UnpackNormal(SAMPLE_TEXTURE2D(_NormalMap, sampler_NormalMap, uv0 * 0.38 - float2(t * 0.015, t * 0.02)));
                half3 n = normalize(half3(n0.xy + n1.xy, n0.z * n1.z));
                // tangent (XZ plane, up = Y)
                return normalize(half3(n.x * _Distortion, 1.0, n.y * _Distortion));
            }

            half4 frag(Varyings IN) : SV_Target
            {
                half3 N = SampleWaveNormal(IN.posWS.xz);
                N.xz *= 1.0 + _SpeedIntensity * 0.16 + _GatePulse * 0.20;
                N = normalize(N);
                float3 V = normalize(GetCameraPositionWS() - IN.posWS);

                // fresnel sky tint on the black mirror
                half fresnel = pow(1.0 - saturate(dot(N, V)), 5.0);
                half3 col = _WaterColor.rgb + _SkyColor.rgb * fresnel * 0.8;

                // planar reflection (ship + canyon slabs), distorted by the ripples —
                // equivalent of the three.js Water mirror sample
                float2 reflUV = IN.screenPos.xy / IN.screenPos.w;
                reflUV += N.xz * 0.045 * _Distortion;
                half3 refl = SAMPLE_TEXTURE2D(_ReflectionTex, sampler_ReflectionTex, saturate(reflUV)).rgb;
                // Strong enough to read at the low gameplay camera angle while the
                // black base and wave distortion retain the source's liquid-metal feel.
                col += refl * _ReflectionStrength * (0.42 + 0.72 * fresnel);

                // The mirror texture now contains the actual hero sun. Layer a wide,
                // low-energy sunlight path plus wave-broken micro-glints over it instead
                // of the old razor-straight point-light strip.
                float3 L = normalize(_SunDir.xyz);
                float3 flatReflection = reflect(-V, float3(0.0, 1.0, 0.0));
                float3 waveReflection = reflect(-V, N);
                half flatAlignment = saturate(dot(flatReflection, L));
                half waveAlignment = saturate(dot(waveReflection, L));
                half broadPath = pow(flatAlignment, 18.0) * 0.15;
                half warmBody = pow(flatAlignment, 46.0)
                    * saturate(0.58 + N.x * 2.4 + N.z * 1.6) * 0.32;
                half glints = pow(waveAlignment, 150.0) * 1.65;
                col += _SunColor.rgb * (broadPath + warmBody + glints);

                // Short local energy sheen under a confirmed speed-gate crossing.
                float2 shipDelta = IN.posWS.xz - float2(_ShipX, _ShipZ);
                half gateSheen = exp(-dot(shipDelta, shipDelta) * .018)
                    * _GatePulse * (.55 + .45 * fresnel);
                col += half3(.20, .72, 1.0) * gateSheen * .32;

                col = MixFog(col, IN.fogFactor);
                return half4(col, 1);
            }
            ENDHLSL
        }
    }
}
