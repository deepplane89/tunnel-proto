using UnityEngine;
using UnityEngine.UI;

namespace JetHorizon
{
    /// <summary>
    /// Clean UI layer: one screen per game phase, driven ONLY by PhaseChanged events.
    /// Screens are built programmatically by the bootstrap (no prefab assets), styled
    /// minimal-synthwave. Swap any screen's visuals freely — the wiring stays.
    /// </summary>
    public sealed class UIManager : MonoBehaviour
    {
        [Header("Wired by bootstrap")]
        public CanvasGroup TitleScreen;
        public CanvasGroup HudScreen;
        public CanvasGroup PauseScreen;
        public CanvasGroup GameOverScreen;

        public Text ScoreText;
        public Text SpeedText;
        public Text StageText;
        public Text FinalScoreText;
        public Text KlaxonText;

        public ShipInput Input;

        float _hudTimer;
        float _klaxonTimer;
        bool _gameOverShown;

        void OnEnable()
        {
            GameEvents.PhaseChanged += OnPhase;
            GameEvents.KlaxonCountdown += OnKlaxon;
        }
        void OnDisable()
        {
            GameEvents.PhaseChanged -= OnPhase;
            GameEvents.KlaxonCountdown -= OnKlaxon;
        }

        void Start() => Show(GamePhase.Title);

        void OnPhase(GamePhase from, GamePhase to)
        {
            _gameOverShown = false;
            Show(to);
        }

        void OnKlaxon() => _klaxonTimer = 1.5f;

        void Show(GamePhase phase)
        {
            Set(TitleScreen, phase == GamePhase.Title);
            Set(HudScreen, phase == GamePhase.Playing || phase == GamePhase.Tutorial);
            Set(PauseScreen, phase == GamePhase.Paused);
            Set(GameOverScreen, false);   // game-over waits for the 2.8 s explosion beat
        }

        static void Set(CanvasGroup g, bool on)
        {
            if (g == null) return;
            g.alpha = on ? 1f : 0f;
            g.interactable = on;
            g.blocksRaycasts = on;
        }

        void Update()
        {
            var gm = GameManager.I;
            if (gm == null) return;
            var s = gm.Session;

            switch (gm.Phase)
            {
                case GamePhase.Title:
                    if (Input != null && Input.TapThisFrame) gm.StartRun();
                    break;

                case GamePhase.Playing:
                    _hudTimer -= Time.deltaTime;
                    if (_hudTimer <= 0f)
                    {
                        _hudTimer = 0.4f;   // HUD readout cadence matches JS
                        if (ScoreText != null) ScoreText.text = Mathf.FloorToInt(s.PlayerScore).ToString("N0");
                        if (SpeedText != null) SpeedText.text = (s.EffectiveSpeed / Tuning.BaseSpeed).ToString("0.0") + "x";
                        if (StageText != null && gm.Waves != null) StageText.text = gm.Waves.StageName;
                    }
                    if (KlaxonText != null)
                    {
                        _klaxonTimer -= Time.deltaTime;
                        bool klaxonOn = _klaxonTimer > 0f && Mathf.FloorToInt(_klaxonTimer * 4f) % 2 == 0;
                        KlaxonText.enabled = klaxonOn;
                    }
                    break;

                case GamePhase.Dead:
                    if (!_gameOverShown && gm.DeathTimer >= Tuning.GameOverDelay)
                    {
                        _gameOverShown = true;
                        if (FinalScoreText != null)
                            FinalScoreText.text = $"SCORE {Mathf.FloorToInt(s.PlayerScore):N0}\nDIST {Mathf.FloorToInt(s.Distance):N0}m";
                        Set(GameOverScreen, true);
                    }
                    // tap cooldown 700 ms after overlay
                    if (_gameOverShown && gm.DeathTimer >= Tuning.GameOverDelay + 0.7f
                        && Input != null && Input.TapThisFrame)
                        gm.RetryRun();
                    break;

                case GamePhase.Paused:
                    if (Input != null && Input.TapThisFrame) gm.TogglePause();
                    break;
            }
        }
    }
}
