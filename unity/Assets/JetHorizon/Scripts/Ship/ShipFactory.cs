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

            Material Std(string role, int color, float metallic, float roughness, int emissive = 0, float emiStrength = 0f)
            {
                var m = new Material(shader) { name = $"JH_Skin_{skin}_{role}" };
                m.SetColor("_BaseColor", TextureFactory.Hex(color));
                m.SetFloat("_Metallic", metallic);
                m.SetFloat("_Smoothness", 1f - roughness);
                if (emiStrength > 0f)
                {
                    m.EnableKeyword("_EMISSION");
                    m.SetColor("_EmissionColor", TextureFactory.Hex(emissive) * emiStrength);
                    m.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
                }
                return m;
            }

            Material CipherHull(string role)
            {
                var m = new Material(Shader.Find("JH/CipherHull")) { name = $"JH_Skin_{skin}_{role}" };
                m.SetColor("_BaseColor", Color.black);
                m.SetColor("_GlowColor", new Color(0.2f, 0.76f, 1f, 1f));
                m.SetFloat("_DiamondScale", 0.5f);
                m.SetFloat("_BumpStrength", 0.6f);
                m.SetFloat("_GlowMultiplier", 0.9f);
                m.SetFloat("_Smoothness", 1f);
                return m;
            }

            Material RunnerHull(string role, int color, float metallic, float roughness)
            {
                var hullShader = Shader.Find("JH/ShipHull");
                if (hullShader == null) return Std(role, color, metallic, roughness);
                var m = new Material(hullShader) { name = $"JH_Skin_{skin}_{role}" };
                m.SetColor("_BaseColor", TextureFactory.Hex(color));
                m.SetColor("_AccentColor", new Color(0.08f, 0.30f, 0.72f, 1f));
                m.SetFloat("_Metallic", metallic);
                m.SetFloat("_Smoothness", 1f - roughness);
                m.SetFloat("_PanelScale", 2f);
                m.SetFloat("_PanelStrength", role == "fallback" ? .18f : .22f);
                return m;
            }

            if (holographicMaterial == null)
            {
                holographicMaterial = new Material(Shader.Find("JH/Holographic")) { name = "JH_Skin_Ghost_Hologram" };
                holographicMaterial.SetColor("_HologramColor", TextureFactory.Hex(0x00e0ff));
                holographicMaterial.SetFloat("_FresnelAmount", 0.70f);
                holographicMaterial.SetFloat("_FresnelOpacity", 0.82f);
                holographicMaterial.SetFloat("_ScanlineSize", 5.5f);
                holographicMaterial.SetFloat("_HologramBrightness", 1.94f);
                holographicMaterial.SetFloat("_SignalSpeed", 0f);
                holographicMaterial.SetFloat("_HologramOpacity", 0.31f);
                holographicMaterial.SetFloat("_ZWrite", 1f);
                holographicMaterial.SetFloat("_SrcBlend", (float)UnityEngine.Rendering.BlendMode.SrcAlpha);
                holographicMaterial.SetFloat("_DstBlend", (float)UnityEngine.Rendering.BlendMode.OneMinusSrcAlpha);
            }

            // slot name → material, per skin (spec/03 §9 table)
            Material nozzle, gray, rocketLight, rocketBase, white, fallback;
            switch (skin)
            {
                case Skin.Ghost:
                    nozzle = Std("nozzle", 0x0a0a0a, 0.95f, 0.12f);
                    gray = rocketLight = rocketBase = white = fallback = holographicMaterial;
                    break;
                case Skin.BlackMamba:
                    nozzle = Std("nozzle", 0x050505, 0f, 0.32f);
                    gray = rocketBase = fallback = Std("hull", 0xd36b4a, 1.0f, 0.32f);
                    rocketLight = Std("rocket_light", 0x000000, 0f, 0.32f, 0x19d9e6, 11f);
                    white = Std("white", 0x797234, 0f, 0.32f, 0x19d9e6, 5f);
                    break;
                case Skin.Cipher:
                    nozzle = Std("nozzle", 0x080808, 0.95f, 0.10f);
                    rocketLight = Std("rocket_light", 0x000000, 0f, 0.32f, 0x88bbff, 6f);
                    gray = rocketBase = white = fallback = CipherHull("diamond_hull");
                    break;
                default: // Runner
                    nozzle = Std("nozzle", 0x0a0a0a, 0.95f, 0.12f);
                    gray = Std("gray", 0x888899, 0.6f, 0.32f);
                    rocketLight = Std("rocket_light", 0x0044ff, 0.0f, 0.05f, 0x0033cc, 2.5f);
                    rocketBase = RunnerHull("rocket_base", 0x0e1014, 0.90f, 0.30f);
                    white = Std("white", 0xddeeff, 0.5f, 0.08f, 0x2255ff, 0.6f);
                    fallback = RunnerHull("fallback", 0x141820, 0.88f, 0.25f);
                    break;
            }

            var oldRuntimeMaterials = new System.Collections.Generic.HashSet<Material>();
            foreach (var r in model.GetComponentsInChildren<Renderer>())
            {
                var mats = r.sharedMaterials;
                for (int i = 0; i < mats.Length; i++)
                {
                    Material current = mats[i];
                    string role = ResolveMaterialRole(r.name, i, mats.Length, current != null ? current.name : string.Empty);
                    if (role == "fire") continue;
                    if (current != null && current.name.StartsWith("JH_Skin_")) oldRuntimeMaterials.Add(current);
                    if (role == "nozzle") mats[i] = nozzle;
                    else if (role == "rocket_light") mats[i] = rocketLight;
                    else if (role == "rocket_base") mats[i] = rocketBase;
                    else if (role == "gray") mats[i] = gray;
                    else if (role == "white") mats[i] = white;
                    else mats[i] = fallback;
                }
                r.sharedMaterials = mats;
            }
            foreach (var oldMaterial in oldRuntimeMaterials)
            {
                if (oldMaterial == nozzle || oldMaterial == gray || oldMaterial == rocketLight
                    || oldMaterial == rocketBase || oldMaterial == white || oldMaterial == fallback
                    || oldMaterial == holographicMaterial) continue;
                if (UnityEngine.Application.isPlaying) Object.Destroy(oldMaterial);
                else Object.DestroyImmediate(oldMaterial);
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
                L("ShipKeyLight", LightType.Directional, Color.white, 1.8f, new Vector3(2f, 4f, -3f));
                L("ShipFillLight", LightType.Directional, TextureFactory.Hex(0x8899bb), 0.6f, new Vector3(-2f, 1f, 2f));
                L("ShipUnderlight", LightType.Point, TextureFactory.Hex(0xff6620), 0.48f, new Vector3(0f, -1.2f, 0f), 6f);
            }
        }

        static string ResolveMaterialRole(string rendererName, int slot, int slotCount, string materialName)
        {
            string n = materialName.ToLowerInvariant().Replace(' ', '_');
            if (n.Contains("fire")) return "fire";
            if (n.Contains("nozzle")) return "nozzle";
            if (n.Contains("rocket_light") || n.Contains("rocketlight") || n == "light") return "rocket_light";
            if (n.Contains("rocket_base") || n.Contains("rocketbase")) return "rocket_base";
            if (n.Contains("gray") || n.Contains("grey")) return "gray";
            if (n.Contains("white")) return "white";

            // glTFast keeps mesh names and primitive slot order even after the
            // first runtime skin replacement, so switching remains lossless.
            string mesh = rendererName.ToLowerInvariant();
            if (mesh.Contains("cube.008") || slotCount == 6)
            {
                string[] roles = { "rocket_base", "nozzle", "fire", "rocket_light", "white", "gray" };
                if (slot >= 0 && slot < roles.Length) return roles[slot];
            }
            if (mesh.Contains("fins 01")) return slot == 1 ? "rocket_light" : "rocket_base";
            if (mesh.Contains("cylinder.009")) return slot == 0 ? "nozzle" : "rocket_base";
            return "rocket_base";
        }
    }
}
