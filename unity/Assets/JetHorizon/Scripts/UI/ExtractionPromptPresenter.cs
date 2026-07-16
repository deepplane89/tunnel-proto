using UnityEngine;
using UnityEngine.UI;

namespace JetHorizon
{
    /// <summary>
    /// Minimal replaceable presentation for the core-owned sector breather choice.
    /// It contains no extraction rules and forwards only the player's YES/NO intent.
    /// </summary>
    public sealed class ExtractionPromptPresenter : MonoBehaviour
    {
        CanvasGroup _root;

        public void Initialize(CanvasGroup hudScreen)
        {
            if (_root != null || hudScreen == null) return;
            var rootObject = new GameObject(
                "ExtractionPrompt",
                typeof(RectTransform),
                typeof(CanvasGroup),
                typeof(Image));
            rootObject.transform.SetParent(hudScreen.transform, false);
            var rect = (RectTransform)rootObject.transform;
            rect.anchorMin = rect.anchorMax = new Vector2(.5f, .56f);
            rect.sizeDelta = new Vector2(520f, 230f);
            rootObject.GetComponent<Image>().color = new Color(.015f, .025f, .055f, .94f);
            _root = rootObject.GetComponent<CanvasGroup>();

            MakeLabel(
                rootObject.transform,
                "Question",
                "EXTRACT?",
                38,
                new Vector2(.5f, .72f),
                new Vector2(440f, 74f));
            MakeButton(
                rootObject.transform,
                "Yes",
                "YES",
                new Vector2(.31f, .27f),
                () => GameManager.I?.RequestExtraction());
            MakeButton(
                rootObject.transform,
                "No",
                "NO",
                new Vector2(.69f, .27f),
                () => GameManager.I?.DeclineExtraction());
            SetVisible(false);
        }

        void Update()
        {
            GameManager manager = GameManager.I;
            bool visible = manager != null
                && manager.Phase == GamePhase.Playing
                && manager.CoreSnapshot != null
                && manager.CoreSnapshot.ExtractionDecisionOpen;
            SetVisible(visible);
        }

        void SetVisible(bool visible)
        {
            if (_root == null) return;
            _root.alpha = visible ? 1f : 0f;
            _root.interactable = visible;
            _root.blocksRaycasts = visible;
        }

        static void MakeButton(
            Transform parent,
            string name,
            string label,
            Vector2 anchor,
            UnityEngine.Events.UnityAction action)
        {
            var buttonObject = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button));
            buttonObject.transform.SetParent(parent, false);
            var rect = (RectTransform)buttonObject.transform;
            rect.anchorMin = rect.anchorMax = anchor;
            rect.sizeDelta = new Vector2(170f, 70f);
            var image = buttonObject.GetComponent<Image>();
            image.color = new Color(.025f, .04f, .07f, .94f);
            var button = buttonObject.GetComponent<Button>();
            button.targetGraphic = image;
            button.navigation = new Navigation { mode = Navigation.Mode.None };
            button.onClick.AddListener(action);

            Text text = MakeLabel(
                buttonObject.transform,
                "Label",
                label,
                22,
                new Vector2(.5f, .5f),
                rect.sizeDelta);
            var textRect = (RectTransform)text.transform;
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.offsetMin = textRect.offsetMax = Vector2.zero;
            text.raycastTarget = false;
        }

        static Text MakeLabel(
            Transform parent,
            string name,
            string value,
            int size,
            Vector2 anchor,
            Vector2 dimensions)
        {
            var labelObject = new GameObject(name, typeof(RectTransform), typeof(Text));
            labelObject.transform.SetParent(parent, false);
            var rect = (RectTransform)labelObject.transform;
            rect.anchorMin = rect.anchorMax = anchor;
            rect.sizeDelta = dimensions;
            var text = labelObject.GetComponent<Text>();
            text.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.fontSize = size;
            text.fontStyle = FontStyle.Bold;
            text.alignment = TextAnchor.MiddleCenter;
            text.color = Color.white;
            text.text = value;
            return text;
        }
    }
}
