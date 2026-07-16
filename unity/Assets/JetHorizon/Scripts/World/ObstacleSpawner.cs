using System.Collections.Generic;
using UnityEngine;
using JetHorizon.Simulation;

namespace JetHorizon
{
    /// <summary>
    /// Pooled cone + lethal-ring hazards: the random wave spawner (spec/02 §2),
    /// shared cone pool used by every corridor system, movement, fade-in,
    /// collision and near-miss. Everything is math collision — no PhysX.
    /// </summary>
    public sealed class ObstacleSpawner : MonoBehaviour, ISimSystem
    {
        public WaveDirector Waves;
        public ShipController Ship;
        public AngledWallSystem AngledWalls;
        public PickupSystem Pickups;
        public Material ConeMaterial;   // JH/NeonCone (set by bootstrap)
        public Material RingMaterial;

        public sealed class ConeObs
        {
            public Transform T;
            public MeshRenderer R;
            public MaterialPropertyBlock Mpb;
            public bool Active;
            public bool IsFatCone, SlalomScaled, IsCorridor;
            public bool IsLaserTarget;
            public Transform TargetRoot;
            public Transform TargetCore;
            public Transform TargetRingA;
            public Transform TargetRingB;
            public Transform TargetFinRoot;
            public MeshRenderer TargetBodyRenderer;
            public MeshRenderer TargetCoreRenderer;
            public MeshRenderer TargetRingARenderer;
            public MeshRenderer TargetRingBRenderer;
            public MeshRenderer[] TargetFinRenderers;
            public MaterialPropertyBlock TargetBodyProperties;
            public MaterialPropertyBlock TargetCoreProperties;
            public MaterialPropertyBlock TargetRingProperties;
            public int ColorType;
            public int CoreId;
        }

        sealed class RingObs
        {
            public Transform T; public MeshRenderer R; public MaterialPropertyBlock Mpb; public bool Active; public int CoreId;
        }

        // Lethal ring constants (spec/02 §1.4)
        const int RingPoolSize = 20;
        const float RingR = 5.25f, RingTube = 2.2f, RingY = 2f;
        const int RingSides = 8;

        readonly List<ConeObs> _cones = new List<ConeObs>(Tuning.ObstaclePoolSize);
        readonly List<RingObs> _rings = new List<RingObs>(RingPoolSize);
        readonly Dictionary<int, HazardSnapshot> _coreHazards = new Dictionary<int, HazardSnapshot>(Tuning.ObstaclePoolSize + RingPoolSize);
        Mesh _coneMesh, _ringMesh;
        Mesh _laserTargetCoreMesh, _laserTargetRingMesh;
        Material _laserTargetCoreMaterial, _laserTargetRingMaterial;

        RunSession S => GameManager.I.Session;

        static readonly int TintId = Shader.PropertyToID("_Tint");
        static readonly int FadeId = Shader.PropertyToID("_Fade");
        static readonly int BandAmountId = Shader.PropertyToID("_BandAmount");

        void Awake() => BuildPools();

        void BuildPools()
        {
            if (_cones.Count > 0) return;
            _coneMesh = MeshFactory.Cone(1.6f, 10.5f, 6);   // avg h ≈ 8+1.5 + 2 sink... scaled per-spawn
            _ringMesh = MeshFactory.PolygonTorus(RingR, RingTube, RingSides);
            _laserTargetCoreMesh = MeshFactory.Octahedron(1f);
            _laserTargetCoreMesh.name = "JH_LaserTargetCore";
            _laserTargetRingMesh = MeshFactory.PolygonTorus(1.62f, .12f, 8, 6);
            _laserTargetRingMesh.name = "JH_LaserTargetContainmentRing";
            Shader additive = Shader.Find("JH/Additive");
            if (additive != null)
            {
                _laserTargetCoreMaterial = new Material(additive) { name = "JH_LaserTargetCoreMat" };
                _laserTargetCoreMaterial.SetColor(TintId, new Color(1f, .28f, .015f, .95f));
                _laserTargetRingMaterial = new Material(additive) { name = "JH_LaserTargetRingMat" };
                _laserTargetRingMaterial.SetColor(TintId, new Color(1f, .06f, .005f, .82f));
            }

            var parent = new GameObject("ConePool").transform;
            parent.SetParent(transform, false);
            for (int i = 0; i < Tuning.ObstaclePoolSize; i++)
            {
                var go = new GameObject("cone");
                go.transform.SetParent(parent, false);
                var mf = go.AddComponent<MeshFilter>(); mf.sharedMesh = _coneMesh;
                var mr = go.AddComponent<MeshRenderer>(); mr.sharedMaterial = ConeMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                go.SetActive(false);
                _cones.Add(new ConeObs { T = go.transform, R = mr, Mpb = new MaterialPropertyBlock() });
            }
            var rparent = new GameObject("RingPool").transform;
            rparent.SetParent(transform, false);
            for (int i = 0; i < RingPoolSize; i++)
            {
                var go = new GameObject("ring");
                go.transform.SetParent(rparent, false);
                var mf = go.AddComponent<MeshFilter>(); mf.sharedMesh = _ringMesh;
                var mr = go.AddComponent<MeshRenderer>(); mr.sharedMaterial = RingMaterial;
                mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                go.SetActive(false);
                _rings.Add(new RingObs { T = go.transform, R = mr, Mpb = new MaterialPropertyBlock() });
            }
        }

        public void ResetSystem()
        {
            BuildPools();
            WipeAllHazards();
        }

        public void WipeAllHazards()
        {
            GameManager.I?.ClearRegisteredHazards();
            foreach (var c in _cones) if (c.Active) Return(c, removeFromCore: false);
            foreach (var r in _rings)
            {
                if (!r.Active) continue;
                r.Active = false;
                r.CoreId = 0;
                r.T.gameObject.SetActive(false);
            }
        }

        public int ActiveHazardCount
        {
            get
            {
                int n = 0;
                foreach (var c in _cones) if (c.Active) n++;
                foreach (var r in _rings) if (r.Active) n++;
                return n + (AngledWalls != null ? AngledWalls.ActiveCount : 0);
            }
        }

        // ── Public cone spawn (used by zipper/slalom/corridors too) ──────────
        public ConeObs SpawnCone(float x, float z, Color? tint = null, float scaleXZ = 1f,
                                 bool isFat = false, bool isCorridor = false)
        {
            foreach (var c in _cones)
            {
                if (c.Active) continue;
                float h = 8f + Random.value * 3f, sink = 2f, totalH = h + sink;
                float collisionWidth = Mathf.Max(0f, scaleXZ - 1f) * (isFat ? 0.9f : 1.2f);
                int colorType = Random.Range(0, 3);
                var spawn = HazardSpawn.Cone(
                    x,
                    z,
                    scaleXZ,
                    collisionWidth,
                    isFat ? HazardStyle.FatCone : isCorridor ? HazardStyle.CorridorCone : HazardStyle.StandardCone,
                    colorType);
                spawn.Y = -sink;
                spawn.CollisionHalfDepth = Tuning.ColDistZ + Mathf.Max(0f, scaleXZ - 1f) * 0.4f;
                int coreId = GameManager.I.RegisterHazard(spawn);
                if (coreId == 0) return null;

                c.Active = true;
                c.CoreId = coreId;
                PrepareStandardCone(c);
                c.IsFatCone = isFat; c.SlalomScaled = scaleXZ != 1f; c.IsCorridor = isCorridor;
                c.ColorType = colorType;
                c.T.position = new Vector3(x, -sink, z);
                c.T.localScale = new Vector3(scaleXZ, totalH / 10.5f, scaleXZ);
                Color col = tint ?? Vibes.ConeColors[c.ColorType];
                c.Mpb.SetColor(TintId, col);
                c.Mpb.SetFloat(FadeId, 0f);
                c.Mpb.SetFloat(BandAmountId, isCorridor ? 1f : 0f);
                c.R.SetPropertyBlock(c.Mpb);
                c.T.gameObject.SetActive(true);
                return c;
            }
            return null; // pool exhausted
        }

        void Return(ConeObs c, bool removeFromCore = true)
        {
            if (removeFromCore && c.CoreId != 0) GameManager.I?.RemoveHazard(c.CoreId);
            c.Active = false;
            c.CoreId = 0;
            c.T.localScale = Vector3.one;
            c.R.enabled = true;
            c.IsLaserTarget = false;
            if (c.TargetRoot != null) c.TargetRoot.gameObject.SetActive(false);
            c.IsFatCone = c.SlalomScaled = c.IsCorridor = false;
            c.T.gameObject.SetActive(false);
        }

        // ── Tick: project core snapshots onto pooled render objects ───────────
        public void SimTick(float dt)
        {
            var snapshot = GameManager.I.CoreSnapshot;
            _coreHazards.Clear();
            if (snapshot != null)
            {
                for (int i = 0; i < snapshot.HazardCount; i++)
                {
                    var hazard = snapshot.GetHazard(i);
                    _coreHazards[hazard.Id] = hazard;
                }
                EnsureCorePresenters(snapshot);
            }

            foreach (var c in _cones)
            {
                if (!c.Active) continue;
                if (!_coreHazards.TryGetValue(c.CoreId, out var hazard) || hazard.Kind != HazardKind.Cone)
                {
                    Return(c, removeFromCore: false);
                    continue;
                }
                var p = new Vector3(hazard.X, hazard.Y, hazard.Z);
                c.T.position = p;

                // fade-in −160 → −110
                float fade = Mathf.Clamp01((p.z - Tuning.SpawnZ) / (Tuning.FadeInEndZ - Tuning.SpawnZ));
                if (c.IsLaserTarget)
                    UpdateLaserTarget(c, fade);
                else
                {
                    c.Mpb.SetFloat(FadeId, fade * Vibes.ConeOpacity[c.ColorType]);
                    c.R.SetPropertyBlock(c.Mpb);
                }
            }

            foreach (var r in _rings)
            {
                if (!r.Active) continue;
                if (!_coreHazards.TryGetValue(r.CoreId, out var hazard) || hazard.Kind != HazardKind.Ring)
                {
                    r.Active = false;
                    r.CoreId = 0;
                    r.T.gameObject.SetActive(false);
                    continue;
                }
                var p = new Vector3(hazard.X, hazard.Y, hazard.Z);
                r.T.position = p;
                float fade = Mathf.Clamp01((p.z - Tuning.SpawnZ) / (Tuning.FadeInEndZ - Tuning.SpawnZ));
                r.Mpb.SetFloat(FadeId, fade * 0.92f);
                r.R.SetPropertyBlock(r.Mpb);
            }
        }

        void EnsureCorePresenters(SimulationSnapshot snapshot)
        {
            for (int i = 0; i < snapshot.HazardCount; i++)
            {
                var hazard = snapshot.GetHazard(i);
                if (hazard.Kind == HazardKind.Cone)
                {
                    bool found = false;
                    foreach (var c in _cones) if (c.Active && c.CoreId == hazard.Id) { found = true; break; }
                    if (!found) AcquireCoreCone(hazard);
                }
                else if (hazard.Kind == HazardKind.Ring)
                {
                    bool found = false;
                    foreach (var r in _rings) if (r.Active && r.CoreId == hazard.Id) { found = true; break; }
                    if (!found) AcquireCoreRing(hazard);
                }
            }
        }

        void AcquireCoreCone(HazardSnapshot hazard)
        {
            foreach (var c in _cones)
            {
                if (c.Active) continue;
                float scaleXZ = Mathf.Max(0.01f, hazard.VisualScale);
                float height = 8f + Random.value * 3f;
                const float sink = 2f;
                c.Active = true;
                c.CoreId = hazard.Id;
                c.IsLaserTarget = hazard.Role == HazardRole.LaserFormationTarget;
                c.IsFatCone = hazard.Style == HazardStyle.FatCone
                    || c.IsLaserTarget;
                c.IsCorridor = hazard.Style == HazardStyle.CorridorCone
                    || hazard.Style == HazardStyle.L4CorridorCone
                    || hazard.Style == HazardStyle.L5CorridorCone;
                c.SlalomScaled = scaleXZ != 1f;
                c.ColorType = Mathf.Abs(hazard.VisualVariant) % Vibes.ConeColors.Length;
                c.T.position = new Vector3(hazard.X, hazard.Y, hazard.Z);
                c.T.localScale = c.IsLaserTarget
                    ? Vector3.one
                    : new Vector3(scaleXZ, (height + sink) / 10.5f, scaleXZ);
                Color tint = hazard.Role == HazardRole.LaserFormationTarget
                    ? new Color(1f, .16f, .015f, 1f)
                    : hazard.Style == HazardStyle.L4CorridorCone
                    ? Vibes.L4Tint
                    : hazard.Style == HazardStyle.L5CorridorCone
                        ? Vibes.L5Tint
                        : Vibes.ConeColors[c.ColorType];
                c.Mpb.SetColor(TintId, tint);
                c.Mpb.SetFloat(FadeId, 0f);
                c.Mpb.SetFloat(BandAmountId, c.IsCorridor ? 1f : 0f);
                c.R.SetPropertyBlock(c.Mpb);
                if (c.IsLaserTarget)
                {
                    EnsureLaserTargetVisual(c);
                    c.R.enabled = false;
                    c.TargetRoot.gameObject.SetActive(true);
                    UpdateLaserTarget(c, 0f);
                }
                else
                {
                    PrepareStandardCone(c);
                }
                c.T.gameObject.SetActive(true);
                return;
            }
        }

        void PrepareStandardCone(ConeObs c)
        {
            c.IsLaserTarget = false;
            c.R.enabled = true;
            if (c.TargetRoot != null) c.TargetRoot.gameObject.SetActive(false);
        }

        void EnsureLaserTargetVisual(ConeObs c)
        {
            if (c.TargetRoot != null) return;

            var root = new GameObject("Overload Reactor").transform;
            root.SetParent(c.T, false);
            c.TargetRoot = root;

            c.TargetBodyRenderer = CreateTargetPart(
                "Obsidian Reactor Body",
                root,
                _laserTargetCoreMesh,
                ConeMaterial,
                new Vector3(0f, 3.1f, 0f),
                new Vector3(1.22f, 1.48f, 1.22f),
                Quaternion.identity,
                out _);
            c.TargetCoreRenderer = CreateTargetPart(
                "Hot Reactor Core",
                root,
                _laserTargetCoreMesh,
                _laserTargetCoreMaterial,
                new Vector3(0f, 3.1f, 0f),
                new Vector3(1.31f, 1.57f, 1.31f),
                Quaternion.identity,
                out c.TargetCore);
            c.TargetRingARenderer = CreateTargetPart(
                "Containment Ring A",
                root,
                _laserTargetRingMesh,
                _laserTargetRingMaterial,
                new Vector3(0f, 3.1f, 0f),
                Vector3.one,
                Quaternion.identity,
                out c.TargetRingA);
            c.TargetRingBRenderer = CreateTargetPart(
                "Containment Ring B",
                root,
                _laserTargetRingMesh,
                _laserTargetRingMaterial,
                new Vector3(0f, 3.1f, 0f),
                Vector3.one * .92f,
                Quaternion.Euler(62f, 24f, 0f),
                out c.TargetRingB);

            c.TargetFinRoot = new GameObject("Containment Fins").transform;
            c.TargetFinRoot.SetParent(root, false);
            c.TargetFinRenderers = new MeshRenderer[4];
            Vector3[] finPositions =
            {
                new Vector3(1.52f, 2.08f, 0f),
                new Vector3(-1.52f, 2.08f, 0f),
                new Vector3(0f, 2.08f, 1.52f),
                new Vector3(0f, 2.08f, -1.52f)
            };
            for (int i = 0; i < c.TargetFinRenderers.Length; i++)
            {
                c.TargetFinRenderers[i] = CreateTargetPart(
                    $"Containment Fin {i + 1}",
                    c.TargetFinRoot,
                    _laserTargetCoreMesh,
                    ConeMaterial,
                    finPositions[i],
                    new Vector3(.25f, .92f, .25f),
                    Quaternion.Euler(0f, i * 90f, i % 2 == 0 ? -18f : 18f),
                    out _);
            }

            c.TargetBodyProperties = new MaterialPropertyBlock();
            c.TargetCoreProperties = new MaterialPropertyBlock();
            c.TargetRingProperties = new MaterialPropertyBlock();
            root.gameObject.SetActive(false);
        }

        static MeshRenderer CreateTargetPart(
            string name,
            Transform parent,
            Mesh mesh,
            Material material,
            Vector3 position,
            Vector3 scale,
            Quaternion rotation,
            out Transform part)
        {
            var go = new GameObject(name);
            part = go.transform;
            part.SetParent(parent, false);
            part.localPosition = position;
            part.localRotation = rotation;
            part.localScale = scale;
            var filter = go.AddComponent<MeshFilter>();
            filter.sharedMesh = mesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = material;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
            return renderer;
        }

        void UpdateLaserTarget(ConeObs c, float fade)
        {
            if (c.TargetRoot == null) return;
            float time = Time.unscaledTime;
            float phase = time * 6.5f + c.CoreId * .37f;
            float pulse = 1f + Mathf.Sin(phase) * .085f;
            float rotation = Mathf.Repeat(time * 115f + c.CoreId * 13f, 360f);

            c.TargetCore.localScale = new Vector3(1.31f, 1.57f, 1.31f) * pulse;
            c.TargetRingA.localRotation = Quaternion.Euler(0f, 0f, rotation);
            c.TargetRingB.localRotation = Quaternion.Euler(62f, 24f, -rotation * 1.32f);
            c.TargetFinRoot.localRotation = Quaternion.Euler(0f, -rotation * .18f, 0f);

            float visible = fade * .96f;
            c.TargetBodyProperties.SetColor(TintId, new Color(1f, .12f, .008f, 1f));
            c.TargetBodyProperties.SetFloat(FadeId, visible);
            c.TargetBodyProperties.SetFloat(BandAmountId, 0f);
            c.TargetBodyRenderer.SetPropertyBlock(c.TargetBodyProperties);
            for (int i = 0; i < c.TargetFinRenderers.Length; i++)
                c.TargetFinRenderers[i].SetPropertyBlock(c.TargetBodyProperties);

            float heat = Mathf.Clamp01((pulse - .915f) / .17f);
            c.TargetCoreProperties.SetColor(
                TintId,
                new Color(1f, Mathf.Lerp(.24f, .82f, heat), .025f, visible));
            c.TargetCoreRenderer.SetPropertyBlock(c.TargetCoreProperties);
            c.TargetRingProperties.SetColor(
                TintId,
                new Color(1f, .07f + .08f * Mathf.Sin(phase + 1.2f), .006f, visible * .88f));
            c.TargetRingARenderer.SetPropertyBlock(c.TargetRingProperties);
            c.TargetRingBRenderer.SetPropertyBlock(c.TargetRingProperties);
        }

        void AcquireCoreRing(HazardSnapshot hazard)
        {
            foreach (var r in _rings)
            {
                if (r.Active) continue;
                r.Active = true;
                r.CoreId = hazard.Id;
                r.T.position = new Vector3(hazard.X, hazard.Y, hazard.Z);
                r.Mpb.SetColor(TintId, Vibes.RingRed);
                r.Mpb.SetFloat(FadeId, 0f);
                r.R.SetPropertyBlock(r.Mpb);
                r.T.gameObject.SetActive(true);
                return;
            }
        }

        void OnDestroy()
        {
            if (_laserTargetCoreMaterial != null) Destroy(_laserTargetCoreMaterial);
            if (_laserTargetRingMaterial != null) Destroy(_laserTargetRingMaterial);
            if (_laserTargetCoreMesh != null) Destroy(_laserTargetCoreMesh);
            if (_laserTargetRingMesh != null) Destroy(_laserTargetRingMesh);
        }
    }
}
