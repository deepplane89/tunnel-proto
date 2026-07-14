using UnityEngine;

namespace JetHorizon
{
    /// <summary>Persistent runtime selector for the four production GLB material skins.</summary>
    public sealed class ShipSkinController : MonoBehaviour
    {
        const string PreferenceKey = "jh_ship_skin";
        GameObject _model;

        public ShipFactory.Skin Current { get; private set; } = ShipFactory.Skin.Runner;
        public string DisplayName => Current == ShipFactory.Skin.BlackMamba
            ? "BLACK MAMBA"
            : Current.ToString().ToUpperInvariant();

        public void Initialize(Transform shipRoot)
        {
            if (shipRoot == null) return;
            _model = shipRoot.Find("ShipModel")?.gameObject;
            int saved = Mathf.Clamp(PlayerPrefs.GetInt(PreferenceKey, 0), 0, 3);
            SetSkin((ShipFactory.Skin)saved, persist: false);
        }

        public void Cycle()
        {
            SetSkin((ShipFactory.Skin)(((int)Current + 1) % 4), persist: true);
        }

        public void SetSkin(ShipFactory.Skin skin, bool persist = true)
        {
            if (_model == null) return;
            Current = skin;
            ShipFactory.ApplySkin(_model, Current, null);
            if (!persist) return;
            PlayerPrefs.SetInt(PreferenceKey, (int)Current);
            PlayerPrefs.Save();
        }
    }
}
