using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using JetHorizon.Simulation;
using System.Collections.Generic;

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
        Button _skinButton;
        Text _skinLabel;
        readonly Dictionary<PowerupType, PowerupHudRow> _powerupRows = new Dictionary<PowerupType, PowerupHudRow>();

        sealed class PowerupHudRow
        {
            public GameObject Root;
            public Image Fill;
            public Text Label;
        }

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
            BuildSkinButton();
            BuildPowerupHud();
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

        void BuildSkinButton()
        {
            if (TitleScreen == null || _skinButton != null) return;
            var go = new GameObject("ShipSkinButton", typeof(RectTransform), typeof(Image), typeof(Button));
            go.transform.SetParent(TitleScreen.transform, false);
            var rt = (RectTransform)go.transform;
            rt.anchorMin = rt.anchorMax = new Vector2(0.5f, 0.16f);
            rt.sizeDelta = new Vector2(360f, 64f);
            var background = go.GetComponent<Image>();
            background.color = new Color(0.025f, 0.04f, 0.07f, 0.88f);
            _skinButton = go.GetComponent<Button>();
            _skinButton.targetGraphic = background;
            _skinButton.navigation = new Navigation { mode = Navigation.Mode.None };
            _skinButton.onClick.AddListener(() =>
            {
                GameManager.I?.ShipSkins?.Cycle();
                RefreshSkinButton();
            });

            var labelObject = new GameObject("Label", typeof(RectTransform), typeof(Text));
            labelObject.transform.SetParent(go.transform, false);
            var labelRect = (RectTransform)labelObject.transform;
            labelRect.anchorMin = Vector2.zero;
            labelRect.anchorMax = Vector2.one;
            labelRect.offsetMin = labelRect.offsetMax = Vector2.zero;
            _skinLabel = labelObject.GetComponent<Text>();
            _skinLabel.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            _skinLabel.fontSize = 22;
            _skinLabel.fontStyle = FontStyle.Bold;
            _skinLabel.alignment = TextAnchor.MiddleCenter;
            _skinLabel.color = new Color(0f, 0.93f, 1f);
            _skinLabel.raycastTarget = false;
            RefreshSkinButton();
        }

        void RefreshSkinButton()
        {
            if (_skinLabel == null) return;
            string skin = GameManager.I != null && GameManager.I.ShipSkins != null
                ? GameManager.I.ShipSkins.DisplayName
                : "RUNNER";
            _skinLabel.text = $"SHIP  ◀  {skin}  ▶";
        }

        void BuildPowerupHud()
        {
            if (HudScreen == null || _powerupRows.Count > 0) return;
            PowerupType[] types = { PowerupType.Shield, PowerupType.Laser, PowerupType.Overdrive, PowerupType.Magnet };
            for (int i = 0; i < types.Length; i++)
            {
                PowerupType type = types[i];
                var root = new GameObject($"{type}Hud", typeof(RectTransform), typeof(Image));
                root.transform.SetParent(HudScreen.transform, false);
                var rt = (RectTransform)root.transform;
                rt.anchorMin = rt.anchorMax = new Vector2(0.5f, 0.075f);
                rt.anchoredPosition = new Vector2(0f, i * 40f);
                rt.sizeDelta = new Vector2(330f, 30f);
                root.GetComponent<Image>().color = new Color(0.01f, 0.02f, 0.04f, 0.82f);

                var fillObject = new GameObject("Fill", typeof(RectTransform), typeof(Image));
                fillObject.transform.SetParent(root.transform, false);
                var fillRect = (RectTransform)fillObject.transform;
                fillRect.anchorMin = new Vector2(0f, 0f);
                fillRect.anchorMax = new Vector2(1f, 1f);
                fillRect.offsetMin = new Vector2(2f, 2f);
                fillRect.offsetMax = new Vector2(-2f, -2f);
                var fill = fillObject.GetComponent<Image>();
                fill.type = Image.Type.Filled;
                fill.fillMethod = Image.FillMethod.Horizontal;
                fill.fillOrigin = 0;
                fill.color = TextureFactory.Hex(PowerupCatalog.Get(type).ColorRgb);

                var labelObject = new GameObject("Label", typeof(RectTransform), typeof(Text));
                labelObject.transform.SetParent(root.transform, false);
                var labelRect = (RectTransform)labelObject.transform;
                labelRect.anchorMin = Vector2.zero;
                labelRect.anchorMax = Vector2.one;
                labelRect.offsetMin = new Vector2(8f, 0f);
                labelRect.offsetMax = new Vector2(-8f, 0f);
                var label = labelObject.GetComponent<Text>();
                label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
                label.fontSize = 17;
                label.fontStyle = FontStyle.Bold;
                label.alignment = TextAnchor.MiddleLeft;
                label.color = Color.white;
                label.raycastTarget = false;
                root.SetActive(false);
                _powerupRows[type] = new PowerupHudRow { Root = root, Fill = fill, Label = label };
            }
        }

        void UpdatePowerupHud(RunSession session)
        {
            UpdatePowerupRow(PowerupType.Shield, session.ShieldTimer, PowerupCatalog.Shield.DurationSeconds,
                session.ShieldHits > 0 ? $"SHIELD  ◆  {session.ShieldTimer:0.0}" : $"SHIELD  {session.ShieldTimer:0.0}");
            UpdatePowerupRow(PowerupType.Laser, session.LaserTimer, PowerupCatalog.Laser.DurationSeconds, $"LASER  {session.LaserTimer:0.0}");
            UpdatePowerupRow(PowerupType.Overdrive, session.OverdriveTimer, PowerupCatalog.Overdrive.DurationSeconds, $"OVERDRIVE  {session.OverdriveTimer:0.0}");
            UpdatePowerupRow(PowerupType.Magnet, session.MagnetTimer, PowerupCatalog.Magnet.DurationSeconds, $"MAGNET  {session.MagnetTimer:0.0}");
        }

        void UpdatePowerupRow(PowerupType type, float remaining, float duration, string label)
        {
            if (!_powerupRows.TryGetValue(type, out var row)) return;
            bool active = remaining > 0f;
            row.Root.SetActive(active);
            if (!active) return;
            row.Fill.fillAmount = Mathf.Clamp01(remaining / duration);
            row.Label.text = label;
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
                    RefreshSkinButton();
                    if (Input != null && Input.TapThisFrame
                        && (EventSystem.current == null || !EventSystem.current.IsPointerOverGameObject())) gm.StartRun();
                    break;

                case GamePhase.Playing:
                    UpdatePowerupHud(s);
                    _hudTimer -= Time.deltaTime;
                    if (_hudTimer <= 0f)
                    {
                        _hudTimer = 0.4f;   // HUD readout cadence matches JS
                        if (ScoreText != null) ScoreText.text = Mathf.FloorToInt(s.Score).ToString("N0");
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
                        {
                            string record = string.Empty;
                            var completion = gm.LastCompletion;
                            if (completion.HasValue)
                                record = completion.Value.IsNewBest
                                    ? $"\nNEW BEST {completion.Value.HighScore:N0}"
                                    : $"\nBEST {completion.Value.HighScore:N0}";
                            FinalScoreText.text = $"SCORE {Mathf.FloorToInt(s.Score):N0}\nDIST {Mathf.FloorToInt(s.Distance):N0}m{record}";
                        }
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
