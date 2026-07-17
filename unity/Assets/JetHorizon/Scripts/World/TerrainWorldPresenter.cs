using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Builds the complete world as two continuous landmasses. Shoreline topology
    /// comes from the engine-neutral snapshot; Unity owns only mesh and material work.
    /// No terrain piece is spawned, pooled or revealed at an encounter boundary.
    /// </summary>
    public sealed class TerrainWorldPresenter : MonoBehaviour, ISimSystem
    {
        readonly List<Mesh> _meshes = new List<Mesh>(4);
        Transform _world;
        Material _material;
        Texture2D _surface;
        string _worldId;

        public string BuiltWorldId => _worldId ?? string.Empty;
        public int BuiltMeshCount => _meshes.Count;

        public void ResetSystem()
        {
            ClearWorld();
            _worldId = null;
        }

        public void SimTick(float dt)
        {
            SimulationSnapshot snapshot = GameManager.I != null ? GameManager.I.CoreSnapshot : null;
            if (snapshot == null || !snapshot.TerrainWorldMode)
            {
                if (_world != null) _world.gameObject.SetActive(false);
                return;
            }
            if (_world == null || _worldId != snapshot.TerrainWorldId)
                BuildWorld(snapshot);
            if (_world == null) return;
            _world.gameObject.SetActive(true);
            _world.position = new Vector3(
                0f,
                0f,
                snapshot.ShipZ + snapshot.Distance - snapshot.TerrainWorldStartDistance);
        }

        void BuildWorld(SimulationSnapshot snapshot)
        {
            ClearWorld();
            EnsureMaterial();
            _worldId = snapshot.TerrainWorldId;
            _world = new GameObject("Persistent Terrain World " + _worldId).transform;
            _world.SetParent(transform, false);

            var rightShore = new List<FacetMassStation>(snapshot.TerrainWorldSectionCount);
            var leftShoreMirrored = new List<FacetMassStation>(snapshot.TerrainWorldSectionCount);
            for (int i = snapshot.TerrainWorldSectionCount - 1; i >= 0; i--)
            {
                TerrainWorldSectionSnapshot section = snapshot.GetTerrainWorldSection(i);
                float localZ = -section.Distance;
                rightShore.Add(new FacetMassStation(
                    localZ,
                    section.RightShoreX,
                    section.RightHeight,
                    section.RightDepth,
                    1f));
                leftShoreMirrored.Add(new FacetMassStation(
                    localZ,
                    -section.LeftShoreX,
                    section.LeftHeight,
                    section.LeftDepth,
                    1f));
            }
            if (rightShore.Count < 2) return;

            Mesh rightMesh = FacetTerrainMeshFactory.BuildMass(
                rightShore,
                FacetSurfaceStyle.ThreeJsSource,
                911,
                "JH_CompleteWorldRightShore");
            Mesh leftMesh = FacetTerrainMeshFactory.BuildMass(
                leftShoreMirrored,
                FacetSurfaceStyle.ThreeJsSource,
                977,
                "JH_CompleteWorldLeftShore");
            AddMesh(
                _world,
                "Right continuous terrain",
                rightMesh,
                new Vector3(0f, -5f, 0f),
                Quaternion.identity,
                Vector3.one);
            AddMesh(
                _world,
                "Left continuous terrain",
                leftMesh,
                new Vector3(0f, -5f, 0f),
                Quaternion.identity,
                new Vector3(-1f, 1f, 1f));

            for (int i = 0; i < snapshot.TerrainWorldFeatureCount; i++)
            {
                TerrainWorldFeatureSnapshot feature = snapshot.GetTerrainWorldFeature(i);
                if (feature.Kind == TerrainWorldFeatureKind.NaturalArch)
                    BuildNaturalArch(feature);
            }
        }

        void BuildNaturalArch(TerrainWorldFeatureSnapshot feature)
        {
            // The supporting cliffs are the continuous shore meshes. This is only
            // their connecting crown, so the arch reads as one geological structure
            // instead of two pillars and a prop placed between them.
            Mesh crown = FacetTerrainMeshFactory.BuildThreeJsParitySlab(
                FacetSurfaceStyle.ThreeJsSource,
                feature.Seed);
            float span = feature.HalfWidth * 2f + 9f;
            AddMesh(
                _world,
                "Natural arch crown",
                crown,
                new Vector3(
                    feature.CenterX - span * .5f,
                    feature.Height * .70f - 5f,
                    -feature.Distance),
                Quaternion.Euler(0f, 90f, 0f),
                new Vector3(.48f, .38f, span / FacetSurfaceStyle.ThreeJsSource.Length));
        }

        void EnsureMaterial()
        {
            if (_material != null) return;
            Shader shader = Shader.Find("JH/FacetTerrain");
            if (shader == null) return;
            _material = new Material(shader) { name = "JH_ContinuousTerrainWorld" };
            _surface = TextureFactory.CyanSlab();
            _surface.name = "JH_ContinuousTerrainSurface";
            _surface.wrapMode = TextureWrapMode.Repeat;
            _material.SetTexture("_Surface", _surface);
            _material.SetColor("_Body", new Color(.045f, .24f, .30f, 1f));
            _material.SetFloat("_Brightness", .80f);
            _material.SetFloat("_Emission", .14f);
        }

        void AddMesh(
            Transform parent,
            string name,
            Mesh mesh,
            Vector3 position,
            Quaternion rotation,
            Vector3 scale)
        {
            _meshes.Add(mesh);
            var child = new GameObject(name);
            child.transform.SetParent(parent, false);
            child.transform.localPosition = position;
            child.transform.localRotation = rotation;
            child.transform.localScale = scale;
            child.AddComponent<MeshFilter>().sharedMesh = mesh;
            MeshRenderer renderer = child.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = _material;
            renderer.shadowCastingMode = ShadowCastingMode.On;
            renderer.receiveShadows = true;
        }

        void ClearWorld()
        {
            if (_world != null)
            {
                if (UnityEngine.Application.isPlaying) Destroy(_world.gameObject);
                else DestroyImmediate(_world.gameObject);
                _world = null;
            }
            for (int i = 0; i < _meshes.Count; i++)
            {
                if (_meshes[i] == null) continue;
                if (UnityEngine.Application.isPlaying) Destroy(_meshes[i]);
                else DestroyImmediate(_meshes[i]);
            }
            _meshes.Clear();
        }

        void OnDestroy()
        {
            ClearWorld();
            if (_material != null) Destroy(_material);
            if (_surface != null) Destroy(_surface);
        }
    }
}
