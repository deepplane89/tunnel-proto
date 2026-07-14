// Direct port of the Three.js NDC blinking-star point shader.
Shader "JH/SkyStars"
{
    Properties
    {
        _StarColor ("Star Color", Color) = (0.40, 0.56, 0.78, 1)
        _Brightness ("Brightness", Range(0,8)) = 3.70
        _TwinkleMin ("Twinkle Minimum", Range(0,2)) = 0.64
        _TwinkleRange ("Twinkle Range", Range(0,2)) = 0.67
        _SizeMult ("Size Multiplier", Range(0,4)) = 1.30
    }
    SubShader
    {
        // Unity draws its skybox after opaque/background-queue meshes. Stars must be
        // transparent-queue geometry so the skybox cannot paint over them.
        Tags { "RenderType"="Transparent" "Queue"="Transparent-100" "RenderPipeline"="UniversalPipeline" }
        Pass
        {
            Blend One One
            ZWrite Off
            ZTest LEqual
            Cull Off

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                half4 _StarColor;
                half _Brightness;
                half _TwinkleMin;
                half _TwinkleRange;
                half _SizeMult;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION; // source NDC center
                float2 corner : TEXCOORD0;    // -1..1 quad corner
                float2 starData : TEXCOORD1;  // seed, source pixel size
            };

            struct Varyings
            {
                float4 positionHCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                half alpha : TEXCOORD1;
                half size : TEXCOORD2;
            };

            Varyings vert(Attributes IN)
            {
                Varyings OUT;
                float seed = IN.starData.x;
                float sourceSize = IN.starData.y;
                float speed = 0.4 + frac(seed * 0.0137);
                float twinkle = _TwinkleMin + _TwinkleRange * sin(_Time.y * speed + seed);
                float coreSize = sourceSize * _SizeMult * (0.7 + 0.3 * twinkle) * 1.5;
                float glowMul = sourceSize > 2.5 ? 1.6 : 1.0;
                float2 ndcOffset = IN.corner * coreSize * glowMul * 2.0 / _ScreenParams.xy;

                float farDepth = 0.9999;
                #if UNITY_REVERSED_Z
                    farDepth = 0.0001;
                #endif
                // Three.js authored these points in WebGL NDC (+Y is screen-up). This
                // Unity Metal path presents direct clip-space geometry with the opposite
                // screen Y convention, so convert the center explicitly. Without this,
                // the dense upper-sky field appears beneath the waterline.
                float2 screenNdc = float2(IN.positionOS.x, -IN.positionOS.y);
                // Far-depth placement lets opaque water, sun, ship and hazards occlude stars.
                OUT.positionHCS = float4(screenNdc + ndcOffset, farDepth, 1.0);
                OUT.uv = IN.corner * 0.5 + 0.5;
                OUT.alpha = twinkle;
                OUT.size = sourceSize;
                return OUT;
            }

            half4 frag(Varyings IN) : SV_Target
            {
                float d = distance(IN.uv, float2(0.5, 0.5));
                float intensity;
                if (IN.size > 2.5)
                {
                    float coreD = d * 1.6;
                    float core = 1.0 - saturate(coreD * 2.0);
                    core = pow(core, 2.2);
                    float glow = pow(max(1.0 - d * 2.0, 0.0), 4.0) * 0.08;
                    intensity = (core + glow) * IN.alpha;
                }
                else
                {
                    float strength = pow(max(1.0 - d * 2.0, 0.0), 2.2);
                    intensity = strength * IN.alpha;
                }
                clip(intensity - 0.01);
                return half4(_StarColor.rgb * intensity * _Brightness, 1.0);
            }
            ENDHLSL
        }
    }
}
