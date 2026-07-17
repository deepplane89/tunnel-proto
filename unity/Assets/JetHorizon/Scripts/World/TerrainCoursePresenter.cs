using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;
using UnityEngine.Rendering;

namespace JetHorizon
{
    /// <summary>
    /// Builds one complete terrain sector from core snapshots and translates it as a
    /// single persistent world object. No formation is spawned at the horizon.
    /// </summary>
    public sealed class TerrainCoursePresenter : MonoBehaviour, ISimSystem
    {
        readonly List<Mesh> _meshes = new List<Mesh>(32);
        Transform _world;
        Material _material;
        Texture2D _surface;
        string _courseId;

        public string BuiltCourseId => _courseId ?? string.Empty;
        public int BuiltMeshCount => _meshes.Count;

        public void ResetSystem()
        {
            ClearWorld();
            _courseId = null;
        }

        public void SimTick(float dt)
        {
            SimulationSnapshot snapshot = GameManager.I != null ? GameManager.I.CoreSnapshot : null;
            if (snapshot == null || !snapshot.TerrainRunMode)
            {
                if (_world != null) _world.gameObject.SetActive(false);
                return;
            }
            if (_world == null || _courseId != snapshot.TerrainCourseId)
                BuildCourse(snapshot);
            if (_world == null) return;
            _world.gameObject.SetActive(true);
            _world.position = new Vector3(
                0f,
                0f,
                snapshot.ShipZ + snapshot.Distance - snapshot.TerrainCourseStartDistance);
        }

        void BuildCourse(SimulationSnapshot snapshot)
        {
            ClearWorld();
            EnsureMaterial();
            _courseId = snapshot.TerrainCourseId;
            _world = new GameObject("Persistent Terrain Course " + _courseId).transform;
            _world.SetParent(transform, false);

            for (int i = 0; i < snapshot.TerrainFormationCount; i++)
            {
                TerrainFormationSnapshot formation = snapshot.GetTerrainFormation(i);
                switch (formation.Kind)
                {
                    case TerrainFormationKind.BoulderGate:
                        BuildBoulderGate(formation);
                        break;
                    case TerrainFormationKind.LowBankPair:
                    case TerrainFormationKind.CanyonPair:
                        BuildBankPair(snapshot, formation);
                        break;
                    case TerrainFormationKind.NaturalArch:
                        BuildNaturalArch(formation);
                        break;
                }
            }
        }

        void BuildBoulderGate(TerrainFormationSnapshot formation)
        {
            Transform root = Child(
                _world,
                $"{formation.Id:000} Boulder Formation",
                new Vector3(0f, -3f, -formation.Distance));
            float radius = formation.Radius;
            float leftX = formation.CenterX - formation.HalfWidth - radius;
            float rightX = formation.CenterX + formation.HalfWidth + radius;
            AddBoulder(root, "Left primary", leftX, -5f, radius, formation.Height, formation.Seed);
            AddBoulder(root, "Right primary", rightX, 7f, radius * 1.04f, formation.Height * 1.08f, formation.Seed + 3);

            // Overlapping satellites extend each obstacle into a broad island mass.
            // The only authored empty space is the traversal aperture; everything
            // outside it reads as geology continuing through and beneath the water.
            AddBoulder(root, "Left shoulder", leftX - radius * 1.28f, 13f,
                radius * .90f, formation.Height * .86f, formation.Seed + 7);
            AddBoulder(root, "Left outer mass", leftX - radius * 2.42f, -10f,
                radius * 1.10f, formation.Height * .72f, formation.Seed + 11);
            AddBoulder(root, "Left submerged shelf", leftX - radius * 1.68f, -25f,
                radius * 1.18f, formation.Height * .48f, formation.Seed + 17);
            AddBoulder(root, "Right shoulder", rightX + radius * 1.32f, -12f,
                radius * .94f, formation.Height * .90f, formation.Seed + 13);
            AddBoulder(root, "Right outer mass", rightX + radius * 2.52f, 11f,
                radius * 1.12f, formation.Height * .76f, formation.Seed + 19);
            AddBoulder(root, "Right submerged shelf", rightX + radius * 1.76f, 27f,
                radius * 1.22f, formation.Height * .46f, formation.Seed + 23);
        }

        void AddBoulder(
            Transform parent,
            string name,
            float x,
            float z,
            float radius,
            float height,
            int seed)
        {
            Mesh mesh = FacetTerrainMeshFactory.BuildBoulder(
                FacetSurfaceStyle.ThreeJsSource,
                seed,
                radius,
                height,
                6,
                height * .17f,
                .36f,
                "JH_RuntimeBoulder");
            AddMesh(parent, name, mesh, new Vector3(x, 0f, z), Quaternion.identity, Vector3.one);
        }

        void BuildBankPair(
            SimulationSnapshot snapshot,
            TerrainFormationSnapshot formation)
        {
            var right = new List<FacetMassStation>(24);
            var leftMirrored = new List<FacetMassStation>(24);
            float end = formation.Distance + formation.Length;
            for (int i = snapshot.TerrainTraversalCount - 1; i >= 0; i--)
            {
                TerrainTraversalSnapshot sample = snapshot.GetTerrainTraversal(i);
                if (sample.Beat != formation.Beat
                    || sample.Mode != TerrainTraversalMode.Continuous
                    || sample.Distance < formation.Distance - .01f
                    || sample.Distance > end + .01f)
                    continue;
                float t = formation.Length <= .01f
                    ? 0f
                    : (sample.Distance - formation.Distance) / formation.Length;
                float localZ = -(sample.Distance - formation.Distance);
                float height = formation.Height * (.90f + Mathf.Sin(t * Mathf.PI * 2.1f + .35f) * .10f);
                float depth = formation.Depth * (.94f + Mathf.Sin(t * Mathf.PI * 1.7f) * .06f);
                right.Add(new FacetMassStation(
                    localZ,
                    sample.CenterX + sample.HalfWidth,
                    height,
                    depth,
                    1f));
                leftMirrored.Add(new FacetMassStation(
                    localZ,
                    -sample.CenterX + sample.HalfWidth,
                    height * .97f,
                    depth,
                    1f));
            }
            if (right.Count < 2) return;

            Transform root = Child(
                _world,
                $"{formation.Id:000} {formation.Kind}",
                new Vector3(0f, -4f, -formation.Distance));
            Mesh rightMesh = FacetTerrainMeshFactory.BuildMass(
                right,
                FacetSurfaceStyle.ThreeJsSource,
                formation.Seed,
                "JH_RuntimeRightBank");
            Mesh leftMesh = FacetTerrainMeshFactory.BuildMass(
                leftMirrored,
                FacetSurfaceStyle.ThreeJsSource,
                formation.Seed + 17,
                "JH_RuntimeLeftBank");
            AddMesh(root, "Right continuous bank", rightMesh, Vector3.zero, Quaternion.identity, Vector3.one);
            AddMesh(root, "Left continuous bank", leftMesh, Vector3.zero, Quaternion.identity, new Vector3(-1f, 1f, 1f));
        }

        void BuildNaturalArch(TerrainFormationSnapshot formation)
        {
            Transform root = Child(
                _world,
                $"{formation.Id:000} Natural Arch",
                new Vector3(0f, -3f, -formation.Distance));
            float radius = formation.Radius;
            float leftX = formation.CenterX - formation.HalfWidth - radius * .90f;
            float rightX = formation.CenterX + formation.HalfWidth + radius * .90f;
            AddBoulder(root, "Left arch mass", leftX, -formation.Length * .35f,
                radius, formation.Height, formation.Seed);
            AddBoulder(root, "Right arch mass", rightX, -formation.Length * .35f,
                radius * 1.05f, formation.Height * .97f, formation.Seed + 5);

            Mesh bridge = FacetTerrainMeshFactory.BuildThreeJsParitySlab(
                FacetSurfaceStyle.ThreeJsSource,
                formation.Seed + 11);
            float span = formation.HalfWidth * 2f + radius * 1.8f;
            AddMesh(
                root,
                "Faceted overhead bridge",
                bridge,
                new Vector3(formation.CenterX - span * .5f, formation.Height * .70f, -formation.Length * .62f),
                Quaternion.Euler(0f, 90f, 0f),
                new Vector3(.42f, .34f, span / FacetSurfaceStyle.ThreeJsSource.Length));
        }

        void EnsureMaterial()
        {
            if (_material != null) return;
            Shader shader = Shader.Find("JH/FacetTerrain");
            if (shader == null) return;
            _material = new Material(shader) { name = "JH_RuntimeFacetTerrain" };
            _surface = TextureFactory.CyanSlab();
            _surface.name = "JH_RuntimeFacetSurface";
            _surface.wrapMode = TextureWrapMode.Repeat;
            _material.SetTexture("_Surface", _surface);
            _material.SetColor("_Body", new Color(.045f, .24f, .30f, 1f));
            _material.SetFloat("_Brightness", .88f);
            _material.SetFloat("_Emission", .20f);
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

        static Transform Child(Transform parent, string name, Vector3 position)
        {
            var child = new GameObject(name).transform;
            child.SetParent(parent, false);
            child.localPosition = position;
            return child;
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
