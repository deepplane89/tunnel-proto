using UnityEngine;
using JetHorizon.Simulation;

namespace JetHorizon
{
    /// <summary>
    /// Builds the ship visual: loads the spaceship_01 GLB prefab if the glTFast
    /// package has imported it (Models/Ships/spaceship_01.glb), else a stylized
    /// placeholder. Applies one of the 4 skins by material-slot name (spec/03 §9).
    /// </summary>
    public static class ShipFactory
    {
        public enum Skin { Runner = 0, Ghost = 1, BlackMamba = 2, Cipher = 3 }

        public static GameObject Build(Transform parent, Skin skin, Material holographicMaterial)
        {
            ShipDefinition definition = ShipCatalog.Runner;
            GameObject model = null;
#if UNITY_EDITOR
            var prefab = UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>(
                $"Assets/JetHorizon/Models/Ships/{definition.ModelKey}");
            if (prefab != null) model = Object.Instantiate(prefab);
#endif
            if (model == null)
            {
                model = new GameObject("PlaceholderShip");
                var mf = model.AddComponent<MeshFilter>();
                mf.sharedMesh = MeshFactory.PlaceholderShip();
                var mr = model.AddComponent<MeshRenderer>();
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            }

            model.name = "ShipModel";
            model.transform.SetParent(parent, false);

            var sockets = parent.GetComponent<ShipSocketRig>();
            if (sockets == null) sockets = parent.gameObject.AddComponent<ShipSocketRig>();
            sockets.Configure(definition, model.transform);

            // Layer 8 = "reflectable" — renders into the water's planar reflection
            SetLayerRecursively(model, 8);

            ApplySkin(model, skin, holographicMaterial);
            return model;
        }

        static void SetLayerRecursively(GameObject go, int layer)
        {
            go.layer = layer;
            foreach (Transform child in go.transform)
                SetLayerRecursively(child.gameObject, layer);
        }

        public static void ApplySkin(GameObject model, Skin skin, Material holographicMaterial)
        {
            var shader = Shader.Find("Universal Render Pipeline/Lit");

            Material Std(int color, float metallic, float smooth, int emissive = 0, float emiStrength = 0f)
            {
                var m = new Material(shader);
                m.SetColor("_BaseColor", TextureFactory.Hex(color));
                m.SetFloat("_Metallic", metallic);
                m.SetFloat("_Smoothness", smooth);
                if (emiStrength > 0f)
                {
                    m.EnableKeyword("_EMISSION");
                    m.SetColor("_EmissionColor", TextureFactory.Hex(emissive) * emiStrength);
                    m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
                }
                return m;
            }

            // slot name → material, per skin (spec/03 §9 table)
            Material nozzle, gray, rocketLight, rocketBase, white, fallback;
            switch (skin)
            {
                case Skin.Ghost:
                    nozzle = Std(0x0a0a0a, 0.95f, 0.88f);
                    gray = rocketLight = rocketBase = white = fallback = holographicMaterial;
                    break;
                case Skin.BlackMamba:
                    nozzle = Std(0x050505, 0f, 0.68f);
                    gray = rocketBase = fallback = Std(0xd36b4a, 1.0f, 0.68f);
                    rocketLight = Std(0x000000, 0.5f, 0.7f, 0x19d9e6, 11f);
                    white = Std(0x797234, 0.5f, 0.6f, 0x19d9e6, 5f);
                    break;
                case Skin.Cipher:
                    nozzle = Std(0x080808, 0.95f, 0.90f);
                    rocketLight = Std(0x000000, 0.5f, 0.7f, 0x88bbff, 6f);
                    gray = rocketBase = white = fallback = Std(0x000000, 0.98f, 1.0f, 0x33c2ff, 0.9f);
                    break;
                default: // Runner
                    // Source roughness is preserved as Unity smoothness. Metallic values
                    // are calibrated down where URP lacks the browser's environment response,
                    // preventing the dark hull from collapsing into a silhouette.
                    nozzle = Std(0x0a0a0a, 0.65f, 0.88f);
                    gray = Std(0x888899, 0.35f, 0.68f);
                    rocketLight = Std(0x0044ff, 0.0f, 0.95f, 0x0033cc, 2.5f);
                    rocketBase = Std(0x0e1014, 0.55f, 0.70f);
                    white = Std(0xddeeff, 0.25f, 0.92f, 0x2255ff, 0.6f);
                    fallback = Std(0x141820, 0.45f, 0.75f);
                    break;
            }

            foreach (var r in model.GetComponentsInChildren<Renderer>())
            {
                var mats = r.sharedMaterials;
                for (int i = 0; i < mats.Length; i++)
                {
                    string n = (mats[i] != null ? mats[i].name : "").ToLowerInvariant();
                    if (n.Contains("fire")) continue;              // engine glow meshes left as-is
                    if (n.Contains("nozzle")) mats[i] = nozzle;
                    else if (n.Contains("rocket_light") || n.Contains("rocketlight")) mats[i] = rocketLight;
                    else if (n.Contains("rocket_base") || n.Contains("rocketbase")) mats[i] = rocketBase;
                    else if (n.Contains("gray") || n.Contains("grey")) mats[i] = gray;
                    else if (n.Contains("white")) mats[i] = white;
                    else mats[i] = fallback;
                }
                r.sharedMaterials = mats;
            }

            // Ship-local lights (spec/03 §2): key + fill + warm underlight pool
            var shipRoot = model.transform.parent;
            if (shipRoot != null && shipRoot.Find("ShipKeyLight") == null)
            {
                void L(string name, LightType type, Color c, float intensity, Vector3 pos, float range = 0f)
                {
                    var go = new GameObject(name);
                    go.transform.SetParent(shipRoot, false);
                    go.transform.localPosition = pos;
                    if (type == LightType.Directional) go.transform.LookAt(shipRoot.position);
                    var l = go.AddComponent<Light>();
                    l.type = type; l.color = c; l.intensity = intensity;
                    if (range > 0f) l.range = range;
                    l.shadows = LightShadows.None;
                }
                L("ShipKeyLight", LightType.Directional, Color.white, 2.2f, new Vector3(2f, 4f, -3f));
                L("ShipFillLight", LightType.Directional, TextureFactory.Hex(0x8899bb), 0.9f, new Vector3(-2f, 1f, 2f));
                L("ShipUnderlight", LightType.Point, TextureFactory.Hex(0xff6620), 0.65f, new Vector3(0f, -1.2f, 0f), 6f);
            }
        }
    }
}
