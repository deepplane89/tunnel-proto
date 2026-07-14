Shader "JH/Shield"
{
    Properties
    {
        _Color ("Shield Color", Color) = (0.149, 0.54, 1, 1)
        _HitColor ("Hit Color", Color) = (1, 0.1, 0.1, 1)
        _Life ("Life", Range(0,1)) = 1
        _Reveal ("Dissolve", Range(0,1)) = 1
        _TimeValue ("Time", Float) = 0
        _HitDirection ("Hit Direction", Vector) = (0,0,-1,0)
        _HitAge ("Hit Age", Float) = -1
    }
    SubShader
    {
        Tags { "RenderType"="Transparent" "Queue"="Transparent+20" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Blend One One
            ZWrite Off
            Cull Back

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _Color;
                half4 _HitColor;
                half _Life;
                half _Reveal;
                float _TimeValue;
                float4 _HitDirection;
                float _HitAge;
            CBUFFER_END

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

            float hexEdge(float2 p)
            {
                p *= 2.2;
                float2 q = float2(p.x * 1.1547005, p.y + p.x * 0.5773503);
                float2 cell = floor(q);
                float2 f = frac(q) - 0.5;
                float d = max(abs(f.x), max(abs(f.y), abs(f.x + f.y)));
                float edgeLine = smoothstep(0.48, 0.40, d);
                float flash = step(0.78, hash31(float3(cell, floor(_TimeValue * 1.25))));
                return saturate((1.0 - edgeLine) * (0.5 + flash * 0.46));
            }

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                float3 p = IN.positionOS.xyz;
                float3 n = normalize(IN.normalOS);
                if (_HitAge >= 0.0 && _HitAge < 1.5)
                {
                    float angle = acos(clamp(dot(n, normalize(_HitDirection.xyz)), -1.0, 1.0));
                    float radius = _HitAge * 5.0;
                    float wave = exp(-pow((angle - radius) / 0.5, 2.0)) * sin((angle - radius) * 18.0);
                    p += n * wave * 0.03 * (1.0 - _HitAge / 1.5);
                }
                OUT.positionOS = p;
                OUT.normalOS = n;
                OUT.positionWS = TransformObjectToWorld(p);
                OUT.normalWS = normalize(TransformObjectToWorldNormal(n));
                OUT.positionHCS = TransformWorldToHClip(OUT.positionWS);
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float3 n = normalize(IN.normalOS);
                float3 an = abs(n);
                float2 hp = an.x > an.y && an.x > an.z ? IN.positionOS.yz
                          : an.y > an.z ? IN.positionOS.xz : IN.positionOS.xy;
                float hex = hexEdge(hp);

                float3 viewDir = normalize(GetCameraPositionWS() - IN.positionWS);
                float fresnel = pow(1.0 - saturate(dot(normalize(IN.normalWS), viewDir)), 1.8) * 1.45;

                float t = _TimeValue * 0.25;
                float flowA = noise3(IN.positionOS * 1.9 + float3(t, t * 0.6, t * 0.4));
                float flowB = noise3(IN.positionOS * 3.99 + float3(-t * 0.5, t * 0.9, t * 0.3));
                float flow = saturate((flowA * 0.65 + flowB * 0.35 - 0.34) * 1.2);

                float dissolveNoise = noise3(IN.positionOS * 1.3 + _TimeValue * 0.08);
                float revealMask = smoothstep(_Reveal - 0.02, _Reveal + 0.69, dissolveNoise);
                float dissolveEdge = 1.0 - smoothstep(0.0, 0.02, abs(dissolveNoise - _Reveal));

                float hitRing = 0.0;
                if (_HitAge >= 0.0 && _HitAge < 1.5)
                {
                    float angle = acos(clamp(dot(n, normalize(_HitDirection.xyz)), -1.0, 1.0));
                    float radius = _HitAge * 5.0;
                    hitRing = exp(-pow((angle - radius) / 0.5, 2.0)) * (1.0 - _HitAge / 1.5) * 20.0;
                }

                half3 baseColor = _Color.rgb * ((fresnel + flow) * 1.09 + hex * 0.5) * _Life;
                baseColor += _Color.rgb * dissolveEdge * 7.9;
                baseColor += _HitColor.rgb * hitRing;
                return half4(baseColor * revealMask, saturate((fresnel + flow + hex) * revealMask));
            }
            ENDHLSL
        }
    }
}
