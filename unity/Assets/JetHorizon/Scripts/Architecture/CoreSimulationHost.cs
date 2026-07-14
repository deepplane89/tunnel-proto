using System;
using JetHorizon.Simulation;
using UnityEngine;

namespace JetHorizon.Architecture
{
    /// <summary>
    /// Opt-in Unity input/timing adapter for the engine-neutral core.
    /// It is deliberately not wired into the shipping scene yet.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class CoreSimulationHost : MonoBehaviour
    {
        [SerializeField] uint seed = 20260714u;
        [SerializeField] bool startOnEnable = true;
        [SerializeField] bool acceptKeyboardInput = true;

        float _accumulator;

        public JetHorizonSimulation Simulation { get; private set; }
        public SimulationSnapshot Snapshot => Simulation?.Snapshot;

        public event Action<SimulationSnapshot> SnapshotProduced;
        public event Action<SimulationEvent> EventProduced;

        void Awake()
        {
            Simulation = new JetHorizonSimulation(new SimulationConfig(), seed);
        }

        void OnEnable()
        {
            if (Simulation == null)
                Simulation = new JetHorizonSimulation(new SimulationConfig(), seed);
            if (startOnEnable) StartCoreRun();
        }

        void Update()
        {
            if (Simulation == null || Simulation.Phase != CoreGamePhase.Playing) return;

            _accumulator += Mathf.Min(Time.unscaledDeltaTime, 0.05f);
            int safety = 8;
            while (_accumulator >= Simulation.FixedDeltaSeconds && safety-- > 0)
            {
                Simulation.Step(ReadInput());
                PublishTick();
                _accumulator -= Simulation.FixedDeltaSeconds;
            }
        }

        public void StartCoreRun()
        {
            _accumulator = 0f;
            Simulation.StartRun();
            PublishTick();
        }

        public void SetPaused(bool paused)
        {
            Simulation.SetPaused(paused);
            SnapshotProduced?.Invoke(Simulation.Snapshot);
        }

        InputFrame ReadInput()
        {
            if (!acceptKeyboardInput) return default;
            bool left = Input.GetKey(KeyCode.LeftArrow) || Input.GetKey(KeyCode.A);
            bool right = Input.GetKey(KeyCode.RightArrow) || Input.GetKey(KeyCode.D);
            int roll = Input.GetKey(KeyCode.UpArrow) ? -1 : Input.GetKey(KeyCode.DownArrow) ? 1 : 0;
            return new InputFrame(left, right, roll);
        }

        void PublishTick()
        {
            var events = Simulation.Events;
            for (int i = 0; i < events.Count; i++) EventProduced?.Invoke(events[i]);
            SnapshotProduced?.Invoke(Simulation.Snapshot);
        }
    }
}
