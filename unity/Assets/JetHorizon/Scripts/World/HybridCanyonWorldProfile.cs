using System;
using UnityEngine;

namespace JetHorizon
{
    [Serializable]
    public sealed class HybridCanyonWorldSettings
    {
        [Header("Terrain world mass")]
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
        [Min(40f)] public float MeshChunkLength = 110f;
        [Range(12, 96)] public int MeshCrossSegments = 56;
        [Range(4, 40)] public int MeshSegmentsPerChunk = 18;
        public int Seed = 41073;

        [Header("Authored mesh landmarks")]
        [Min(8f)] public float ArchDepth = 18f;
        [Min(3f)] public float ArchPillarWidth = 13f;
        [Min(10f)] public float EntryClearance = 24f;
        [Min(2f)] public float ArchCrownThickness = 12f;
        [Range(0, 10)] public int SideMonolithCount = 6;

        [Header("Continuous canyon face")]
        [Min(4f)] public float WallFacetLength = 10f;
        [Range(3, 14)] public int WallVerticalSegments = 7;
        public float WallBaseY = -4f;
        [Min(20f)] public float WallHeight = 58f;
        [Range(0f, 10f)] public float WallFacetDepth = 3.5f;
        [Min(.25f)] public float WallFacetSnap = 1.5f;

        public bool CastMeshShadows = true;
        public bool ReceiveMeshShadows = true;
    }

    /// <summary>
    /// Unity-facing authoring profile. Gameplay never reads this asset: it only controls
    /// how the core-owned crystalline route is projected into Terrain and hero meshes.
    /// </summary>
    [CreateAssetMenu(fileName = "HybridCanyonWorld", menuName = "Jet Horizon/Hybrid Canyon World")]
    public sealed class HybridCanyonWorldProfile : ScriptableObject
    {
        public HybridCanyonWorldSettings Settings = new HybridCanyonWorldSettings();
        public Material CanyonMaterial;
        [Tooltip("Editor-baked mobile runtime world. When absent, gameplay creates the same optimized chunks in memory as a safe fallback.")]
        public GameObject BakedWorldPrefab;
    }
}
