using UnityEngine;

namespace JetHorizon
{
    public enum GamePhase { Boot, Title, Tutorial, Playing, Paused, Dead }

    /// <summary>
    /// Rock-solid phase machine. Every transition is validated and every state's
    /// enter/exit is a single place — the JS version scattered ~90 reset fields
    /// across startGame/returnToTitle; here a run reset happens in exactly one spot.
    /// </summary>
    public sealed class GameStateMachine
    {
        public GamePhase Phase { get; private set; } = GamePhase.Boot;
        public float TimeInPhase { get; private set; }

        // Legal transitions only. Anything else is a programming error and logs loudly.
        static readonly (GamePhase from, GamePhase to)[] Legal =
        {
            (GamePhase.Boot,     GamePhase.Title),
            (GamePhase.Title,    GamePhase.Playing),
            (GamePhase.Title,    GamePhase.Tutorial),
            (GamePhase.Tutorial, GamePhase.Playing),
            (GamePhase.Tutorial, GamePhase.Title),
            (GamePhase.Playing,  GamePhase.Paused),
            (GamePhase.Paused,   GamePhase.Playing),
            (GamePhase.Paused,   GamePhase.Title),
            (GamePhase.Playing,  GamePhase.Dead),
            (GamePhase.Dead,     GamePhase.Playing),   // retry / repair
            (GamePhase.Dead,     GamePhase.Title),
        };

        public bool CanTransition(GamePhase to)
        {
            foreach (var t in Legal)
                if (t.from == Phase && t.to == to) return true;
            return false;
        }

        public bool TransitionTo(GamePhase to)
        {
            if (Phase == to) return false;
            if (!CanTransition(to))
            {
                Debug.LogError($"[GameStateMachine] Illegal transition {Phase} → {to} — ignored.");
                return false;
            }
            var from = Phase;
            Phase = to;
            TimeInPhase = 0f;
            GameEvents.RaisePhaseChanged(from, to);
            return true;
        }

        public void Tick(float dt) => TimeInPhase += dt;

        public bool IsSimulating => Phase == GamePhase.Playing || Phase == GamePhase.Tutorial;
    }
}
