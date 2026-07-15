using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using JetHorizon.Simulation;
using JetHorizon.Meta;
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
        CanvasGroup _garageScreen;
        Text _garageSummary;
        Text _garageStatus;
        Button _extractButton;
        Text _extractLabel;
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
            BuildGarageEntryButton();
            BuildGarageScreen();
            BuildExtractButton();
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
            Set(_garageScreen, phase == GamePhase.Garage);
            if (phase == GamePhase.Garage) RefreshGarage();
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

        void BuildGarageEntryButton()
        {
            if (TitleScreen == null) return;
            MakeButton(TitleScreen.transform, "GarageButton", "GARAGE", new Vector2(.5f, .085f), new Vector2(300f, 58f),
                () => GameManager.I?.OpenGarage());
            if (GameOverScreen != null)
                MakeButton(GameOverScreen.transform, "GarageButton", "GARAGE / REPAIR", new Vector2(.5f, .17f), new Vector2(330f, 58f),
                    () => GameManager.I?.OpenGarage());
        }

        void BuildGarageScreen()
        {
            if (_garageScreen != null) return;
            var root = new GameObject("GarageScreen", typeof(RectTransform), typeof(CanvasGroup), typeof(Image));
            root.transform.SetParent(transform, false);
            var rt = (RectTransform)root.transform;
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
            rt.offsetMin = rt.offsetMax = Vector2.zero;
            root.GetComponent<Image>().color = new Color(.01f, .015f, .035f, .96f);
            _garageScreen = root.GetComponent<CanvasGroup>();

            MakeLabel(root.transform, "GarageTitle", "JET HORIZON // GARAGE", 52, new Vector2(.5f, .88f), new Vector2(1000f, 80f), new Color(0f, .93f, 1f));
            _garageSummary = MakeLabel(root.transform, "GarageSummary", string.Empty, 25, new Vector2(.5f, .61f), new Vector2(1050f, 360f), Color.white);
            _garageStatus = MakeLabel(root.transform, "GarageStatus", string.Empty, 20, new Vector2(.5f, .36f), new Vector2(1000f, 64f), new Color(1f, .45f, .75f));

            MakeButton(root.transform, "Fly", "LAUNCH", new Vector2(.72f, .16f), new Vector2(300f, 70f), () => GameManager.I?.StartRun());
            MakeButton(root.transform, "Back", "TITLE", new Vector2(.28f, .16f), new Vector2(240f, 70f), () => GameManager.I?.ReturnToTitle());
            MakeButton(root.transform, "Handling", "CHANGE HANDLING", new Vector2(.30f, .29f), new Vector2(330f, 58f), CycleHandling);
            MakeButton(root.transform, "Thruster", "CHANGE THRUSTER", new Vector2(.70f, .29f), new Vector2(330f, 58f), CycleThruster);
            MakeButton(root.transform, "Repair", "REPAIR DAMAGED", new Vector2(.30f, .22f), new Vector2(330f, 58f), RepairFirstDamaged);
            MakeButton(root.transform, "Powerup", "BUY SHIELD CHARGE", new Vector2(.70f, .22f), new Vector2(330f, 58f), BuyShieldCharge);
            MakeButton(root.transform, "BuyThruster", "BUY NEXT THRUSTER", new Vector2(.30f, .43f), new Vector2(330f, 58f), BuyNextThruster);
            MakeButton(root.transform, "BuyAddOn", "BUY / EQUIP MOD", new Vector2(.70f, .43f), new Vector2(330f, 58f), BuyOrEquipNextAddOn);
        }

        void BuildExtractButton()
        {
            if (HudScreen == null || _extractButton != null) return;
            _extractButton = MakeButton(HudScreen.transform, "ExtractButton", "EXTRACT", new Vector2(.5f, .88f), new Vector2(330f, 64f),
                () => GameManager.I?.RequestExtraction());
            _extractLabel = _extractButton.GetComponentInChildren<Text>();
            _extractButton.gameObject.SetActive(false);
        }

        Button MakeButton(Transform parent, string name, string text, Vector2 anchor, Vector2 size, UnityEngine.Events.UnityAction action)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button));
            go.transform.SetParent(parent, false);
            var rt = (RectTransform)go.transform;
            rt.anchorMin = rt.anchorMax = anchor;
            rt.sizeDelta = size;
            var image = go.GetComponent<Image>();
            image.color = new Color(.025f, .04f, .07f, .94f);
            var button = go.GetComponent<Button>();
            button.targetGraphic = image;
            button.navigation = new Navigation { mode = Navigation.Mode.None };
            button.onClick.AddListener(action);
            var label = MakeLabel(go.transform, "Label", text, 22, new Vector2(.5f, .5f), size, Color.white);
            var labelRt = (RectTransform)label.transform;
            labelRt.anchorMin = Vector2.zero; labelRt.anchorMax = Vector2.one;
            labelRt.offsetMin = labelRt.offsetMax = Vector2.zero;
            label.raycastTarget = false;
            return button;
        }

        Text MakeLabel(Transform parent, string name, string text, int size, Vector2 anchor, Vector2 dimensions, Color color)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Text));
            go.transform.SetParent(parent, false);
            var rt = (RectTransform)go.transform;
            rt.anchorMin = rt.anchorMax = anchor;
            rt.sizeDelta = dimensions;
            var label = go.GetComponent<Text>();
            label.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            label.fontSize = size;
            label.alignment = TextAnchor.MiddleCenter;
            label.color = color;
            label.text = text;
            return label;
        }

        void RefreshGarage(string status = "")
        {
            var garage = GameManager.I?.Garage;
            if (garage == null || _garageSummary == null) return;
            garage.RefreshRepairs();
            GarageState g = garage.Current;
            ShipLaunchProfile p = GarageDomainService.CreateLaunchProfile(g);
            _garageSummary.text =
                $"EXTRACTIONS  {g.SuccessfulExtractions}     CREDITS  {g.Credits:N0}\n" +
                $"SALVAGE  {g.Salvage}     ALLOY  {g.Alloy}     PRISM  {g.Prism}\n\n" +
                $"THRUSTER  {g.SelectedThrusterId.ToUpperInvariant()}     HANDLING  {g.SelectedHandlingId.ToUpperInvariant()}\n" +
                $"SPEED  {p.SpeedMultiplier:0.00}     CARGO  {p.CargoCapacity}     HULL HITS  {p.CollisionHitCapacity}\n" +
                $"REPAIR BAYS  {g.RepairBayLevel}     MECHANIC BOTS  {g.MechanicBotLevel}";
            if (_garageStatus != null) _garageStatus.text = status;
        }

        void CycleHandling()
        {
            string[] ids = { "default", "glide", "wipeout", "rail", "jet" };
            GarageState state = GameManager.I.Garage.Current;
            int current = System.Array.IndexOf(ids, state.SelectedHandlingId);
            for (int offset = 1; offset <= ids.Length; offset++)
            {
                string id = ids[(current + offset + ids.Length) % ids.Length];
                GarageCommandResult result = GameManager.I.Garage.EquipHandling(id);
                if (!result.Succeeded) continue;
                RefreshGarage("HANDLING EQUIPPED: " + id.ToUpperInvariant());
                return;
            }
            RefreshGarage("NO ADDITIONAL HANDLING MODEL UNLOCKED");
        }

        void CycleThruster()
        {
            string[] ids = { "wreck", "light", "blink", "short", "pylon", "fat-ion", "flourish", "plasma", "distort" };
            GarageState state = GameManager.I.Garage.Current;
            int current = System.Array.IndexOf(ids, state.SelectedThrusterId);
            for (int offset = 1; offset <= ids.Length; offset++)
            {
                string id = ids[(current + offset + ids.Length) % ids.Length];
                if (!state.Owns("thruster:" + id)) continue;
                GarageCommandResult result = GameManager.I.Garage.EquipThruster("thruster:" + id);
                if (result.Succeeded) { RefreshGarage("THRUSTER EQUIPPED: " + id.ToUpperInvariant()); return; }
            }
            RefreshGarage("NO ADDITIONAL THRUSTER OWNED");
        }

        void RepairFirstDamaged()
        {
            GarageState state = GameManager.I.Garage.Current;
            foreach (SubsystemState subsystem in state.Subsystems)
            {
                if (subsystem.Integrity >= .999f) continue;
                GarageCommandResult result = GameManager.I.Garage.QueueRepair(subsystem.Subsystem);
                RefreshGarage(result.Succeeded ? "REPAIR STARTED: " + subsystem.Subsystem : "REPAIR NEEDS SALVAGE OR A FREE BAY");
                return;
            }
            RefreshGarage("ALL SYSTEMS NOMINAL");
        }

        void BuyShieldCharge()
        {
            GarageCommandResult result = GameManager.I.Garage.BuyPowerupCharge("shield");
            RefreshGarage(result.Succeeded ? "SHIELD CHARGE ADDED" : "NOT ENOUGH CREDITS");
        }

        void BuyNextThruster()
        {
            string[] ids = { "thruster:blink", "thruster:short", "thruster:pylon", "thruster:fat-ion", "thruster:flourish", "thruster:plasma", "thruster:distort" };
            foreach (string id in ids)
            {
                if (GameManager.I.Garage.Current.Owns(id)) continue;
                GarageCommandResult result = GameManager.I.Garage.Purchase(id);
                RefreshGarage(result.Succeeded ? "PURCHASED " + id.Substring(9).ToUpperInvariant() : "NEXT THRUSTER IS LOCKED OR TOO EXPENSIVE");
                return;
            }
            RefreshGarage("ALL THRUSTERS OWNED");
        }

        void BuyOrEquipNextAddOn()
        {
            string[] ids = { "addon:fins-01", "addon:fins-02", "addon:turrets-001", "addon:turrets-002", "addon:rings-001", "addon:turrets-003" };
            foreach (string id in ids)
            {
                GarageState current = GameManager.I.Garage.Current;
                if (!current.Owns(id))
                {
                    GarageCommandResult bought = GameManager.I.Garage.Purchase(id);
                    RefreshGarage(bought.Succeeded ? "MOD PURCHASED: " + id.Substring(6).ToUpperInvariant() : "NEXT MOD IS LOCKED OR TOO EXPENSIVE");
                    return;
                }
                if (!current.EquippedAddOnIds.Contains(id))
                {
                    GarageCommandResult equipped = GameManager.I.Garage.SetAddOnEquipped(id, true);
                    RefreshGarage(equipped.Succeeded ? "MOD EQUIPPED: " + id.Substring(6).ToUpperInvariant() : "MOD COULD NOT BE EQUIPPED");
                    return;
                }
            }
            RefreshGarage("ALL OWNED MODS EQUIPPED");
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
                    if (_extractButton != null)
                    {
                        SimulationSnapshot snapshot = gm.CoreSnapshot;
                        bool available = snapshot != null && snapshot.ExtractionAvailable;
                        _extractButton.gameObject.SetActive(available);
                        if (available && _extractLabel != null)
                            _extractLabel.text = $"EXTRACT  {snapshot.CargoUnits}/{snapshot.CargoCapacity}";
                    }
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

                case GamePhase.Garage:
                    if (_extractButton != null) _extractButton.gameObject.SetActive(false);
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
