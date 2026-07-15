using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

namespace JetHorizon
{
    /// <summary>
    /// Planar reflection for the water plane (y = 0) — the Unity equivalent of the
    /// three.js Water mirror (512² RT). Only layer <see cref="ReflectLayer"/> renders
    /// into the mirror (ship + canyon slabs), matching the JS layer exclusions where
    /// sky/stars/obstacles stay hidden from the reflection. The hero sun shares the
    /// reflectable layer with ship/canyon so the water receives its real mirrored disc,
    /// matching the Three.js Water pass rather than relying on a synthetic strip.
    /// </summary>
    public sealed class PlanarReflection : MonoBehaviour
    {
        public Material WaterMaterial;
        public int TextureSize = 512;
        public int ReflectLayer = 8;
        public float PlaneY = 0f;
        [Min(100f)] public float MaxReflectionDistance = 1600f;

        UnityEngine.Camera _reflCam;
        RenderTexture _rt;
        UniversalRenderPipeline.SingleCameraRequest _renderRequest;
        static readonly int ReflTexId = Shader.PropertyToID("_ReflectionTex");

        void OnEnable() => RenderPipelineManager.beginCameraRendering += OnBeginCamera;

        void OnDisable()
        {
            RenderPipelineManager.beginCameraRendering -= OnBeginCamera;
            if (_rt != null) { _rt.Release(); Destroy(_rt); _rt = null; }
            if (_reflCam != null) Destroy(_reflCam.gameObject);
        }

        void EnsureCamera(UnityEngine.Camera main)
        {
            if (_reflCam != null) return;

            _rt = new RenderTexture(TextureSize, TextureSize, 16, RenderTextureFormat.DefaultHDR)
            { name = "JH_WaterReflection", useMipMap = false };
            _rt.Create();
            _renderRequest = new UniversalRenderPipeline.SingleCameraRequest { destination = _rt };

            var go = new GameObject("WaterReflectionCam")
            {
                hideFlags = HideFlags.HideAndDontSave
            };
            go.transform.SetParent(transform, false);
            _reflCam = go.AddComponent<UnityEngine.Camera>();
            _reflCam.CopyFrom(main);
            _reflCam.enabled = false;             // rendered explicitly before the gameplay camera
            _reflCam.cameraType = CameraType.Reflection;
            _reflCam.targetTexture = _rt;
            _reflCam.cullingMask = 1 << ReflectLayer;
            _reflCam.clearFlags = CameraClearFlags.SolidColor;
            _reflCam.backgroundColor = Color.black;
            _reflCam.allowMSAA = false;
            _reflCam.useOcclusionCulling = false;

            var data = go.AddComponent<UniversalAdditionalCameraData>();
            data.renderPostProcessing = false;
            data.renderShadows = false;
            data.antialiasing = AntialiasingMode.None;
            data.requiresColorOption = CameraOverrideOption.Off;
            data.requiresDepthOption = CameraOverrideOption.Off;

            WaterMaterial.SetTexture(ReflTexId, _rt);
        }

        void UpdateMatrices(UnityEngine.Camera main)
        {
            _reflCam.fieldOfView = main.fieldOfView;
            _reflCam.aspect = main.aspect;
            _reflCam.nearClipPlane = main.nearClipPlane;
            // The gameplay camera sees the complete prebuilt canyon so its far plane
            // never reveals wall geometry. The reflection only needs the fog-visible
            // range; capping it avoids doubling the full-depth mobile render cost.
            _reflCam.farClipPlane = Mathf.Min(main.farClipPlane, MaxReflectionDistance);

            // reflection matrix about plane y = PlaneY
            Vector4 plane = new Vector4(0f, 1f, 0f, -PlaneY);
            Matrix4x4 refl = CalculateReflectionMatrix(plane);
            _reflCam.worldToCameraMatrix = main.worldToCameraMatrix * refl;

            // oblique near clip at the water plane (don't render what's above-mirrored)
            Vector4 clipPlane = CameraSpacePlane(_reflCam.worldToCameraMatrix, new Vector3(0f, PlaneY, 0f), Vector3.up);
            _reflCam.projectionMatrix = main.CalculateObliqueMatrix(clipPlane);
        }

        void OnBeginCamera(ScriptableRenderContext ctx, UnityEngine.Camera cam)
        {
            if (WaterMaterial == null || cam == null || cam != UnityEngine.Camera.main || cam == _reflCam) return;

            EnsureCamera(cam);
            UpdateMatrices(cam);

            // An explicit render is deterministic in URP and avoids relying on a
            // dynamically-created disabled camera being discovered in the frame list.
            GL.invertCulling = true;
            try
            {
                RenderPipeline.SubmitRenderRequest(_reflCam, _renderRequest);
            }
            finally
            {
                GL.invertCulling = false;
            }
        }

        static Matrix4x4 CalculateReflectionMatrix(Vector4 p)
        {
            var m = Matrix4x4.identity;
            m.m00 = 1f - 2f * p.x * p.x; m.m01 = -2f * p.x * p.y; m.m02 = -2f * p.x * p.z; m.m03 = -2f * p.w * p.x;
            m.m10 = -2f * p.y * p.x; m.m11 = 1f - 2f * p.y * p.y; m.m12 = -2f * p.y * p.z; m.m13 = -2f * p.w * p.y;
            m.m20 = -2f * p.z * p.x; m.m21 = -2f * p.z * p.y; m.m22 = 1f - 2f * p.z * p.z; m.m23 = -2f * p.w * p.z;
            return m;
        }

        static Vector4 CameraSpacePlane(Matrix4x4 worldToCam, Vector3 pos, Vector3 normal)
        {
            Vector3 cpos = worldToCam.MultiplyPoint(pos);
            Vector3 cnormal = worldToCam.MultiplyVector(normal).normalized;
            return new Vector4(cnormal.x, cnormal.y, cnormal.z, -Vector3.Dot(cpos, cnormal));
        }
    }
}
