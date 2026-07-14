using System.Collections.Generic;
using JetHorizon.Simulation;
using UnityEngine;

namespace JetHorizon.Architecture
{
    /// <summary>
    /// Minimal presentation adapter proving that Unity visuals can consume snapshots
    /// without the simulation knowing about Transforms, prefabs, or rendering.
    /// </summary>
    public sealed class CoreTransformPresenter : MonoBehaviour
    {
        public CoreSimulationHost Host;
        public Transform ShipVisual;
        public GameObject StandardHazardPrefab;
        [Min(1)] public int HazardPoolSize = 32;

        readonly List<Transform> _hazards = new List<Transform>();

        void Awake()
        {
            if (StandardHazardPrefab == null) return;
            for (int i = 0; i < HazardPoolSize; i++)
            {
                var instance = Instantiate(StandardHazardPrefab, transform);
                instance.name = $"CoreHazard_{i:00}";
                instance.SetActive(false);
                _hazards.Add(instance.transform);
            }
        }

        void LateUpdate()
        {
            SimulationSnapshot snapshot = Host != null ? Host.Snapshot : null;
            if (snapshot == null) return;

            if (ShipVisual != null)
            {
                ShipVisual.position = new Vector3(snapshot.ShipX, snapshot.ShipY, snapshot.ShipZ);
                float visualRoll = Mathf.Abs(snapshot.ShipRollRadians) > 0.0001f
                    ? snapshot.ShipRollRadians
                    : snapshot.ShipBankRadians;
                ShipVisual.rotation = Quaternion.Euler(
                    0f,
                    0f,
                    visualRoll * Mathf.Rad2Deg);
            }

            for (int i = 0; i < _hazards.Count; i++)
            {
                bool active = i < snapshot.HazardCount;
                var hazard = _hazards[i];
                if (hazard.gameObject.activeSelf != active) hazard.gameObject.SetActive(active);
                if (!active) continue;
                HazardSnapshot state = snapshot.GetHazard(i);
                hazard.position = new Vector3(state.X, 0f, state.Z);
            }
        }
    }
}
