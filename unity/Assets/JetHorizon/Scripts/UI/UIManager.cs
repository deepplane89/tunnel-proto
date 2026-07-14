using UnityEngine;
using UnityEngine.EventSystems;
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
        Button _godModeButton;
        Image _godModeBackground;
        Text _godModeLabel;

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

        void Start()
        {
            EnsureEventSystem();
            BuildGodModeButton();
            Show(GamePhase.Title);
            RefreshGodModeButton();
        }

        void OnPhase(GamePhase from, GamePhase to)
        {
            _gameOverShown = false;
            Show(to);
            RefreshGodModeButton();
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

        static void EnsureEventSystem()
        {
            if (EventSystem.current != null) return;
            var go = new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
            Object.DontDestroyOnLoad(go);
        }

        void BuildGodModeButton()
        {
            if (HudScreen == null || _godModeButton != null) return;

            var go = new GameObject("GodModeButton", typeof(RectTransform), typeof(Image), typeof(Button));
            go.transform.SetParent(HudScreen.transform, false);
            var rt = (RectTransform)go.transform;
            rt.anchorMin = rt.anchorMax = new Vector2(0.92f, 0.075f);
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.anchoredPosition = Vector2.zero;
            rt.sizeDelta = new Vector2(240f, 68f);

            _godModeBackground = go.GetComponent<Image>();
            _godModeBackground.color = new Color(0.025f, 0.04f, 0.07f, 0.88f);

            _godModeButton = go.GetComponent<Button>();
            _godModeButton.targetGraphic = _godModeBackground;
            _godModeButton.navigation = new Navigation { mode = Navigation.Mode.None };
            _godModeButton.onClick.AddListener(OnGodModeClicked);

            var labelGo = new GameObject("Label", typeof(RectTransform), typeof(Text));
            labelGo.transform.SetParent(go.transform, false);
            var labelRt = (RectTransform)labelGo.transform;
            labelRt.anchorMin = Vector2.zero;
            labelRt.anchorMax = Vector2.one;
            labelRt.offsetMin = labelRt.offsetMax = Vector2.zero;
            _godModeLabel = labelGo.GetComponent<Text>();
            _godModeLabel.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            _godModeLabel.fontSize = 24;
            _godModeLabel.fontStyle = FontStyle.Bold;
            _godModeLabel.alignment = TextAnchor.MiddleCenter;
            _godModeLabel.raycastTarget = false;
        }

        void OnGodModeClicked()
        {
            var gm = GameManager.I;
            if (gm == null) return;
            gm.ToggleGodMode();
            RefreshGodModeButton();
        }

        void RefreshGodModeButton()
        {
            if (_godModeLabel == null || _godModeBackground == null) return;
            bool enabled = GameManager.I != null && GameManager.I.GodMode;
            _godModeLabel.text = enabled ? "GOD MODE  ON" : "GOD MODE  OFF";
            _godModeLabel.color = enabled ? new Color(0.01f, 0.06f, 0.08f, 1f) : Color.white;
            _godModeBackground.color = enabled
                ? new Color(0f, 0.93f, 1f, 0.94f)
                : new Color(0.025f, 0.04f, 0.07f, 0.88f);
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
