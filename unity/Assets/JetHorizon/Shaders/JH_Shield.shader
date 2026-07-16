Shader "JH/Shield"
{
    Properties
    {
        _Color ("Shield Color", Color) = (0.149, 0.54, 1, 1)
        _HitColor ("Hit Color", Color) = (1, 0.1, 0.1, 1)
        _Life ("Life", Range(0,1)) = 1
        _Reveal ("Dissolve", Range(0,1)) = 0
        _TimeValue ("Time", Float) = 0
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+20" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Blend SrcAlpha One
            ZWrite Off
            Cull Back

            HLSLPROGRAM
            #pragma target 3.5
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            #define MAX_HITS 6

            CBUFFER_START(UnityPerMaterial)
                half4 _Color;
                half4 _HitColor;
                half _Life;
                half _Reveal;
                float _TimeValue;
            CBUFFER_END

            // xyz = object-space hit direction, w = impact time. Kept outside the
            // material cbuffer because Unity uploads it as a fixed vector array.
            float4 _HitData[MAX_HITS];

            struct Attributes { float4 positionOS : POSITION; float3 normalOS : NORMAL; };
            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float3 positionOS : TEXCOORD0;
                float3 normalOS : TEXCOORD1;
                float3 positionWS : TEXCOORD2;
                float3 normalWS : TEXCOORD3;
            };

            float hash31(float3 p)
            {
                p = frac(p * 0.1031);
                p += dot(p, p.yzx + 33.33);
                return frac((p.x + p.y) * p.z);
            }

            float noise3(float3 p)
            {
                float3 i = floor(p), f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(lerp(hash31(i), hash31(i + float3(1,0,0)), f.x),
                                 lerp(hash31(i + float3(0,1,0)), hash31(i + float3(1,1,0)), f.x), f.y),
                            lerp(lerp(hash31(i + float3(0,0,1)), hash31(i + float3(1,0,1)), f.x),
                                 lerp(hash31(i + float3(0,1,1)), hash31(i + 1.0), f.x), f.y), f.z);
            }

            void hexData(float2 p, out float edge, out float2 cellId)
            {
                p *= 2.2;
                const float2 spacing = float2(1.0, 1.7320508);
                float4 cell = floor(float4(p, p - float2(0.5, 1.0)) / spacing.xyxy) + 0.5;
                float4 local = float4(p - cell.xy * spacing, p - (cell.zw + 0.5) * spacing);
                bool first = dot(local.xy, local.xy) < dot(local.zw, local.zw);
                float2 h = first ? local.xy : local.zw;
                cellId = first ? cell.xy : cell.zw + 0.5;
                h = abs(h);
                float d = max(dot(h, spacing * 0.5), h.x);
                edge = smoothstep(0.40, 0.50, d);
            }

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                float3 p = IN.positionOS.xyz;
                float3 n = normalize(IN.normalOS);
                float3 sphereDirection = normalize(p);
                float displacement = 0.0;
                [unroll] for (int i = 0; i < MAX_HITS; i++)
                {
                    float elapsed = _TimeValue - _HitData[i].w;
                    float active = step(0.0, _HitData[i].w) * step(0.0, elapsed) * step(elapsed, 1.5);
                    float angularDistance = acos(clamp(dot(sphereDirection, normalize(_HitData[i].xyz)), -1.0, 1.0));
                    float wave = sin(angularDistance * 12.0 - elapsed * 40.0);
                    float envelope = smoothstep(2.0, 0.0, angularDistance - elapsed * 5.0);
                    float fade = 1.0 - smoothstep(0.6, 1.5, elapsed);
                    displacement += wave * envelope * fade * active;
                }
                p += n * clamp(displacement, -1.0, 1.0) * 0.03;
                OUT.positionOS = p;
                OUT.normalOS = n;
                OUT.positionWS = TransformObjectToWorld(p);
                OUT.normalWS = normalize(TransformObjectToWorldNormal(n));
                OUT.positionHCS = TransformWorldToHClip(OUT.positionWS);
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float3 objectDirection = normalize(IN.positionOS);
                float3 absDirection = abs(objectDirection);
                float dominance = max(absDirection.x, max(absDirection.y, absDirection.z));
                float hexFaceFade = smoothstep(0.65, 0.85, dominance);
                float2 faceUV = absDirection.x >= absDirection.y && absDirection.x >= absDirection.z ? IN.positionOS.yz
                              : absDirection.y >= absDirection.z ? IN.positionOS.xz : IN.positionOS.xy;
                float hex;
                float2 cellId;
                hexData(faceUV, hex, cellId);
                hex *= hexFaceFade;

                float randomCell = frac(sin(dot(cellId, float2(127.1, 311.7))) * 43758.5453);
                float cellPulse = smoothstep(0.6, 1.0,
                    sin(_TimeValue * 1.25 * (0.5 + randomCell * 1.5) + randomCell * 6.2831)) * 0.46 * hexFaceFade;

                float3 viewDirection = normalize(GetCameraPositionWS() - IN.positionWS);
                float fresnel = pow(1.0 - saturate(dot(normalize(IN.normalWS), viewDirection)), 1.8) * 1.45;
                float flowTime = _TimeValue * 0.25;
                float flowA = noise3(IN.positionOS * 1.9 + float3(flowTime, flowTime * 0.6, flowTime * 0.4));
                float flowB = noise3(IN.positionOS * 3.99 + float3(-flowTime * 0.5, flowTime * 0.9, flowTime * 0.3));
                float flowNoise = (flowA * 0.6 + flowB * 0.4) * 1.2;

                float dissolveNoise = noise3(IN.positionOS * 1.3);
                float revealMask = smoothstep(_Reveal - 0.02, _Reveal, dissolveNoise);
                clip(revealMask - 0.001);
                float innerFade = 0.407;
                float edgeLow = smoothstep(_Reveal - 0.02, _Reveal - 0.02 * innerFade, dissolveNoise);
                float edgeHigh = smoothstep(_Reveal - 0.003, _Reveal, dissolveNoise);
                float revealEdge = edgeLow * (1.0 - edgeHigh);

                float ringContribution = 0.0;
                float hexHitBoost = 0.0;
                [unroll] for (int i = 0; i < MAX_HITS; i++)
                {
                    float elapsed = _TimeValue - _HitData[i].w;
                    float active = step(0.0, _HitData[i].w) * step(0.0, elapsed) * step(elapsed, 1.5);
                    float angularDistance = acos(clamp(dot(objectDirection, normalize(_HitData[i].xyz)), -1.0, 1.0));
                    float ringRadius = min(elapsed * 5.0, 2.0);
                    float noisyDistance = angularDistance + (noise3(objectDirection * 5.0 + elapsed * 2.0) - 0.5) * 0.10;
                    float ring = smoothstep(0.5, 0.0, abs(noisyDistance - ringRadius));
                    float ringFade = 1.0 - smoothstep(0.75, 1.5, elapsed);
                    float radialFade = 1.0 - smoothstep(1.5, 2.0, ringRadius);
                    ringContribution += ring * ringFade * radialFade * active;
                    float zone = smoothstep(1.0, 0.0, angularDistance);
                    float zoneFade = 1.0 - smoothstep(0.0, 0.525, elapsed);
                    hexHitBoost += zone * zoneFade * active;
                }
                ringContribution = min(ringContribution, 2.0);
                hexHitBoost = min(hexHitBoost, 1.0);

                half3 lifeColor = lerp(half3(0.6, 0.85, 1.0), _Color.rgb, _Life);
                float effectiveHex = 0.50 + hexHitBoost * 20.0;
                float intensity = hex * effectiveHex * (0.3 + fresnel * 0.7) + fresnel * 0.4 + cellPulse;
                half3 color = lifeColor * intensity * 2.0;
                color += lifeColor * flowNoise * fresnel;
                color += _HitColor.rgb * ringContribution * 20.0;
                color += lifeColor * revealEdge * 7.9;
                float alpha = saturate(intensity * 1.09 * revealMask + revealEdge * 7.9);
                alpha *= smoothstep(-1.0, 0.40, IN.positionOS.y * 1.3333);
                return half4(color, alpha);
            }
            ENDHLSL
        }
    }
}
