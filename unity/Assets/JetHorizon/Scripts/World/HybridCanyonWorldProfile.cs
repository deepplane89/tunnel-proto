using System;
using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;

namespace JetHorizon
{
    [Serializable]
    public sealed class HybridCanyonWorldSettings
    {
        [Header("Optional Terrain world mass")]
        [Tooltip("Adds broad Unity Terrain behind the faceted corridor. Keep this off while judging the corridor itself.")]
        public bool BuildTerrainBacking;
        [Range(65, 513)] public int HeightmapResolution = 257;
        [Min(160f)] public float TerrainWidth = 440f;
        [Min(100f)] public float ApproachLength = 150f;
        [Min(40f)] public float RearLength = 100f;
        public float TerrainBaseY = -22f;
        [Min(20f)] public float TerrainHeight = 82f;
        [Min(5f)] public float BankHeight = 61f;
        [Min(2f)] public float BankRiseWidth = 34f;
        [Range(0f, 20f)] public float SurfaceNoise = 8f;
        [Min(5f)] public float NoiseScale = 38f;
        [Range(1f, 30f)] public float HeightmapPixelError = 8f;
        [Min(50f)] public float BasemapDistance = 260f;
        [Range(50f, 100f)] public float MeshChunkLength = 90f;
        [Range(12, 96)] public int MeshCrossSegments = 56;
        [Range(4, 40)] public int MeshSegmentsPerChunk = 18;
        public int Seed = 41073;

        [Header("Authored mesh landmarks")]
        [Tooltip("Adds outcrops, threshold arch, bridge, knife-edge gates and monoliths. Keep this off while judging the continuous corridor shell.")]
        public bool BuildAuthoredStructures;
        [Min(8f)] public float ArchDepth = 18f;
        [Min(3f)] public float ArchPillarWidth = 13f;
        [Min(10f)] public float EntryClearance = 24f;
        [Min(2f)] public float ArchCrownThickness = 12f;
        [Range(0, 10)] public int SideMonolithCount = 6;

        [Header("Faithful Three.js canyon slab")]
        [Min(4f)] public float SlabLength = 20f;
        [Min(20f)] public float SlabHeight = 55f;
        [Min(10f)] public float SlabThickness = 60f;
        [Range(2, 12)] public int SlabColumns = 5;
        [Range(2, 12)] public int SlabRows = 6;
        [Range(0f, 10f)] public float SlabDisplacement = 4f;
        [Min(.1f)] public float SlabSnap = .7f;
        public float SlabFootX = 9f;
        public float SlabSweepX = 4f;
        public float SlabMidX = 17f;
        public float SlabCrestX = 20f;
        public float SlabBaseY = -4f;

        [Header("Curved patch extrusion")]
        [Range(0f, 1f)] public float PathTension = .35f;
        [Tooltip("Build each complete canyon side as one renderer so Unity cannot reveal 80m groups through renderer-level frustum culling.")]
        public bool ContinuousWallRenderer = true;
        [Min(40f)] public float WallChunkLength = 80f;
        [Min(0f)] public float TerrainLipEmbedDepth = 10f;
        [Min(0f)] public float BottomSkirtDepth = 8f;
        public AnimationCurve WallHeightByProgress = AnimationCurve.Linear(0f, 1f, 1f, 1f);
        public AnimationCurve BankDegreesByProgress = AnimationCurve.Linear(0f, 0f, 1f, 0f);
        public AnimationCurve TerrainShoulderByProgress = AnimationCurve.Linear(0f, 1f, 1f, 1f);
        public bool ShowSafeRouteGizmo = true;

        public bool CastMeshShadows = true;
        public bool ReceiveMeshShadows = true;
    }

    [Serializable]
    public sealed class CanyonPathAuthoringPoint
    {
        [Min(0f)] public float Distance;
        public float CenterX;
        [Min(2f)] public float HalfWidth = 21.5f;
        public CargoRouteTier CargoTier;
        public CanyonEnvironmentPhase EnvironmentPhase;
        public bool CorridorBoundaryActive = true;
        public TraversalRequirement TraversalRequirement;

        public CanyonPathAuthoringPoint() { }

        public CanyonPathAuthoringPoint(EncounterOpening opening)
        {
            Distance = opening.Distance;
            CenterX = opening.CenterX;
            HalfWidth = opening.HalfWidth;
            CargoTier = opening.CargoTier;
            EnvironmentPhase = opening.EnvironmentPhase;
            CorridorBoundaryActive = opening.CorridorBoundaryActive;
            TraversalRequirement = opening.TraversalRequirement;
        }

        public CanyonPathKnot ToCore() => new CanyonPathKnot(
            Distance,
            CenterX,
            HalfWidth,
            CargoTier,
            EnvironmentPhase,
            CorridorBoundaryActive,
            TraversalRequirement);
    }

    /// <summary>
    /// Unity-facing authoring profile. The editable knots are converted once into an
    /// immutable engine-neutral definition; rendering-only terrain and wall settings
    /// never enter the simulation core.
    /// </summary>
    [CreateAssetMenu(fileName = "HybridCanyonWorld", menuName = "Jet Horizon/Hybrid Canyon World")]
    public sealed class HybridCanyonWorldProfile : ScriptableObject
    {
        public HybridCanyonWorldSettings Settings = new HybridCanyonWorldSettings();
        [Header("Engine-neutral canyon path")]
        public bool UseAuthoredPath;
        [Min(1f)] public float AuthoredPathLength = 799f;
        public List<CanyonPathAuthoringPoint> PathPoints = new List<CanyonPathAuthoringPoint>();
        public Material CanyonMaterial;
        [Tooltip("Editor-baked mobile runtime world. When absent, gameplay creates the same optimized chunks in memory as a safe fallback.")]
        public GameObject BakedWorldPrefab;

        public CanyonPathDefinition BuildCorePathDefinition()
        {
            if (!UseAuthoredPath || PathPoints == null || PathPoints.Count < 4) return null;
            try
            {
                var knots = new CanyonPathKnot[PathPoints.Count];
                for (int i = 0; i < knots.Length; i++) knots[i] = PathPoints[i].ToCore();
                return new CanyonPathDefinition(AuthoredPathLength, knots);
            }
            catch (Exception exception)
            {
                Debug.LogError($"[JetHorizon] Authored canyon path is invalid; using the validated default route. {exception.Message}", this);
                return null;
            }
        }

        public void CaptureDefaultCorePath()
        {
            EncounterPlan plan = EncounterPlanCatalog.CreateProofSequence()[1];
            PathPoints = PathPoints ?? new List<CanyonPathAuthoringPoint>();
            PathPoints.Clear();
            for (int i = 0; i < plan.OpeningCount; i++)
                PathPoints.Add(new CanyonPathAuthoringPoint(plan.GetOpening(i)));
            AuthoredPathLength = plan.Length;
            UseAuthoredPath = true;
        }
    }
}
