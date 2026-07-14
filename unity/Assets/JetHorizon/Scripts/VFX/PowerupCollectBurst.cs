using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>Production pickup absorb: six cube faces shatter while the icon zips into the ship.</summary>
    public sealed class PowerupCollectBurst : MonoBehaviour
    {
        const float Duration = 0.35f;
        readonly Transform[] _fragments = new Transform[6];
        readonly Vector3[] _velocities = new Vector3[6];
        readonly Vector3[] _spins = new Vector3[6];
        Transform _icon;
        Transform _ship;
        Material _fragmentMaterial;
        Material _iconMaterial;
        float _age;
        Vector3 _origin;

        public static void Spawn(Transform parent, Vector3 position, PowerupType type, Mesh iconMesh, Material sourceIconMaterial)
        {
            var root = new GameObject($"{type}CollectBurst");
            root.transform.SetParent(parent, false);
            root.transform.position = position;
            var burst = root.AddComponent<PowerupCollectBurst>();
            burst.Build(type, iconMesh, sourceIconMaterial);
        }

        void Build(PowerupType type, Mesh iconMesh, Material sourceIconMaterial)
        {
            _origin = transform.position;
            _ship = GameObject.Find("ShipRoot")?.transform;
            _fragmentMaterial = new Material(sourceIconMaterial) { name = "JH_PowerupShatter" };
            _fragmentMaterial.SetColor("_HologramColor", TextureFactory.Hex(PowerupCatalog.Get(type).ColorRgb));
            _fragmentMaterial.SetFloat("_ZWrite", 0f);
            _fragmentMaterial.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
            _fragmentMaterial.SetFloat("_DstBlend", (float)BlendMode.One);

            var normals = new[] { Vector3.forward, Vector3.back, Vector3.right, Vector3.left, Vector3.up, Vector3.down };
            for (int i = 0; i < normals.Length; i++)
            {
                var face = GameObject.CreatePrimitive(PrimitiveType.Quad);
                Destroy(face.GetComponent<Collider>());
                face.name = "ShatterFace";
                face.layer = 8;
                face.transform.SetParent(transform, false);
                face.transform.localPosition = normals[i] * 1.75f;
                face.transform.localRotation = Quaternion.FromToRotation(Vector3.back, normals[i]);
                face.transform.localScale = Vector3.one * 3.5f;
                var renderer = face.GetComponent<MeshRenderer>();
                renderer.sharedMaterial = _fragmentMaterial;
                renderer.shadowCastingMode = ShadowCastingMode.Off;
                _fragments[i] = face.transform;
                _velocities[i] = normals[i] * 7f + Random.insideUnitSphere * 1.5f;
                _spins[i] = Random.onUnitSphere * 420f;
            }

            var icon = new GameObject("AbsorbedIcon");
            icon.layer = 8;
            icon.transform.SetParent(transform, false);
            icon.AddComponent<MeshFilter>().sharedMesh = iconMesh;
            _iconMaterial = new Material(sourceIconMaterial) { name = "JH_PowerupAbsorbIcon" };
            var iconRenderer = icon.AddComponent<MeshRenderer>();
            iconRenderer.sharedMaterial = _iconMaterial;
            iconRenderer.shadowCastingMode = ShadowCastingMode.Off;
            _icon = icon.transform;
        }

        void Update()
        {
            _age += Time.deltaTime;
            float t = Mathf.Clamp01(_age / Duration);
            float fade = 1f - t;
            if (_fragmentMaterial != null) _fragmentMaterial.SetFloat("_HologramOpacity", fade * 0.9f);
            if (_iconMaterial != null) _iconMaterial.SetFloat("_HologramOpacity", fade);

            for (int i = 0; i < _fragments.Length; i++)
            {
                if (_fragments[i] == null) continue;
                _fragments[i].position += _velocities[i] * Time.deltaTime;
                _fragments[i].Rotate(_spins[i] * Time.deltaTime, Space.Self);
                _fragments[i].localScale = Vector3.one * (3.5f * fade);
            }

            if (_icon != null)
            {
                Vector3 target = _ship != null ? _ship.position : _origin + Vector3.forward * 4f;
                float ease = 1f - Mathf.Pow(1f - t, 3f);
                _icon.position = Vector3.Lerp(_origin, target, ease);
                _icon.localScale = Vector3.one * (1f - 0.65f * t);
                _icon.Rotate(0f, 720f * Time.deltaTime, 0f, Space.Self);
            }

            if (t < 1f) return;
            Destroy(_fragmentMaterial);
            Destroy(_iconMaterial);
            Destroy(gameObject);
        }
    }
}
