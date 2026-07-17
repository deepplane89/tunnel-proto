using UnityEngine;

namespace JetHorizon
{
    /// <summary>
    /// Presentation-only lighting for the hero ship. The environment's directional
    /// sun remains the physical key light; this rig supplies the small, stable
    /// camera fill and water bounce required for a readable mobile silhouette.
    ///
    /// The rig deliberately lives beside the ship rather than under it. Point-light
    /// positions follow the ship, but the lighting directions do not bank or yaw
    /// when the player steers.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ShipLightingPresenter : MonoBehaviour
    {
        const string RigName = "Ship World Lighting Rig";

        Transform _ship;
        Transform _rig;
        Light _cameraFill;
        Light _waterBounce;
        Light _sunKick;
        Camera _camera;
        float _radius = 2.5f;
        bool _initialized;

        public void Initialize(Transform ship = null)
        {
            if (_initialized) return;
            _initialized = true;
            _ship = ship != null ? ship : transform;
            if (_ship == null) return;

            // Old scene lights are children of ShipRoot, including directional
            // lights. Their direction changes with every bank and roll, which is
            // why the ship reads as self-lit instead of existing in the world.
            DisableLegacyShipLights();
            _radius = MeasureRadius();

            Transform parent = _ship.parent;
            var root = new GameObject(RigName);
            _rig = root.transform;
            _rig.SetParent(parent, true);
            _cameraFill = CreateLight("Camera cool fill", new Color(0.26f, 0.71f, 1f), 1.55f, 7.5f);
            _waterBounce = CreateLight("Water cyan bounce", new Color(0.04f, 0.38f, 0.68f), 1.15f, 6.2f);
            _sunKick = CreateLight("Sun warm edge", new Color(1f, 0.48f, 0.18f), 0.90f, 8.4f);
            UpdateRig();
        }

        void Awake() => Initialize(transform);

        void LateUpdate()
        {
            if (!_initialized) Initialize(transform);
            if (_ship == null || _rig == null) return;
            UpdateRig();
        }

        void OnDestroy()
        {
            if (_rig == null) return;
            if (UnityEngine.Application.isPlaying) Destroy(_rig.gameObject);
            else DestroyImmediate(_rig.gameObject);
        }

        void DisableLegacyShipLights()
        {
            foreach (Light light in _ship.GetComponentsInChildren<Light>(true))
            {
                if (light == null) continue;
                string name = light.name;
                if (name == "ShipKeyLight" || name == "ShipFillLight"
                    || name == "ShipCyanRimLight" || name == "ShipUnderlight")
                    light.enabled = false;
            }
        }

        float MeasureRadius()
        {
            Renderer[] renderers = _ship.GetComponentsInChildren<Renderer>(true);
            if (renderers.Length == 0) return 2.5f;

            Bounds bounds = renderers[0].bounds;
            for (int i = 1; i < renderers.Length; i++)
                if (renderers[i] != null) bounds.Encapsulate(renderers[i].bounds);
            return Mathf.Clamp(bounds.extents.magnitude * 1.35f, 1.7f, 4.2f);
        }

        Light CreateLight(string name, Color color, float intensity, float range)
        {
            var go = new GameObject(name);
            go.transform.SetParent(_rig, false);
            var light = go.AddComponent<Light>();
            light.type = LightType.Point;
            light.color = color;
            light.intensity = intensity;
            light.range = range;
            light.shadows = LightShadows.None;
            light.renderMode = LightRenderMode.ForcePixel;
            return light;
        }

        void UpdateRig()
        {
            if (_camera == null) _camera = Camera.main;
            if (_camera == null) return;

            Vector3 shipPosition = _ship.position;
            Vector3 toCamera = _camera.transform.position - shipPosition;
            if (toCamera.sqrMagnitude < .0001f) toCamera = Vector3.back;
            toCamera.Normalize();

            Vector3 cameraRight = _camera.transform.right;
            Vector3 cameraUp = _camera.transform.up;
            Vector3 sunToShip = RenderSettings.sun != null
                ? -RenderSettings.sun.transform.forward
                : new Vector3(-.42f, .62f, -.66f).normalized;

            // The cool fill is deliberately biased toward the viewing side of the
            // hull. It maintains silhouette detail without looking like a headlamp.
            _cameraFill.transform.position = shipPosition
                + toCamera * (_radius * 1.65f)
                + cameraUp * (_radius * .48f)
                + cameraRight * (_radius * .28f);

            // Water provides the lower cyan return beneath the ship; this replaces
            // the old unrelated orange underlight.
            _waterBounce.transform.position = shipPosition
                - Vector3.up * (_radius * 1.05f)
                + toCamera * (_radius * .36f);

            // A compact warm kick complements the global sun. Unlike a child
            // directional light it stays in the same world direction while banking.
            _sunKick.transform.position = shipPosition
                + sunToShip * (_radius * 1.8f)
                + Vector3.up * (_radius * .45f);
        }
    }
}
