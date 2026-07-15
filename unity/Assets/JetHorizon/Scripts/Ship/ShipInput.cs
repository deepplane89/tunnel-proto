using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

namespace JetHorizon
{
    /// <summary>
    /// Digital steering identical to the web build: hold left/right (keys or screen
    /// halves), swipe up in a zone = knife-edge roll toggle, swipe down cancels.
    /// Works with either Unity input backend.
    /// </summary>
    public sealed class ShipInput : MonoBehaviour
    {
        public bool SteerLeft  { get; private set; }
        public bool SteerRight { get; private set; }
        public bool RollHeld   { get; private set; }
        public int  RollDir    { get; private set; }   // -1 rollUp(left zone) / +1 rollDown(right zone)
        public bool TapThisFrame { get; private set; }

        const float SwipeThresholdPx = 14f;

        Vector2 _touchStart;
        bool _touchActive;
        bool _touchRollLatched;   // swipe-up roll persists after finger lift; swipe-down cancels

        void Update()
        {
            SteerLeft = SteerRight = false;
            bool keyRoll = false; int keyRollDir = 0;
            TapThisFrame = false;

#if ENABLE_INPUT_SYSTEM
            var kb = Keyboard.current;
            if (kb != null)
            {
                if (kb.leftArrowKey.isPressed  || kb.aKey.isPressed) SteerLeft = true;
                if (kb.rightArrowKey.isPressed || kb.dKey.isPressed) SteerRight = true;
                if (kb.upArrowKey.isPressed)   { keyRoll = true; keyRollDir = -1; }
                if (kb.downArrowKey.isPressed) { keyRoll = true; keyRollDir = +1; }
                if (kb.spaceKey.wasPressedThisFrame) TapThisFrame = true;
                if (kb.escapeKey.wasPressedThisFrame && GameManager.I != null) GameManager.I.TogglePause();
#if UNITY_EDITOR || DEVELOPMENT_BUILD
                if (kb.pKey.wasPressedThisFrame && GameManager.I != null) GameManager.I.DebugJumpToPrismaticEncounter();
#endif
            }
            var mouse = Mouse.current;
            if (mouse != null && mouse.leftButton.wasPressedThisFrame) TapThisFrame = true;
            HandleTouchNewInput();
#else
            if (Input.GetKey(KeyCode.LeftArrow)  || Input.GetKey(KeyCode.A)) SteerLeft = true;
            if (Input.GetKey(KeyCode.RightArrow) || Input.GetKey(KeyCode.D)) SteerRight = true;
            if (Input.GetKey(KeyCode.UpArrow))   { keyRoll = true; keyRollDir = -1; }
            if (Input.GetKey(KeyCode.DownArrow)) { keyRoll = true; keyRollDir = +1; }
            if (Input.GetKeyDown(KeyCode.Space) || Input.GetMouseButtonDown(0)) TapThisFrame = true;
            if (Input.GetKeyDown(KeyCode.Escape) && GameManager.I != null) GameManager.I.TogglePause();
#if UNITY_EDITOR || DEVELOPMENT_BUILD
            if (Input.GetKeyDown(KeyCode.P) && GameManager.I != null) GameManager.I.DebugJumpToPrismaticEncounter();
#endif
            HandleTouchLegacy();
#endif
            if (keyRoll) { RollHeld = true; RollDir = keyRollDir; }
            else if (!_touchRollLatched && !_touchActive) RollHeld = false;
        }

#if ENABLE_INPUT_SYSTEM
        void HandleTouchNewInput()
        {
            var ts = Touchscreen.current;
            if (ts == null) return;
            var touch = ts.primaryTouch;
            if (touch.press.isPressed)
            {
                Vector2 pos = touch.position.ReadValue();
                if (!_touchActive) { _touchActive = true; _touchStart = pos; TapThisFrame = true; }
                bool leftZone = pos.x < Screen.width * 0.5f;
                if (leftZone) SteerLeft = true; else SteerRight = true;

                float dy = pos.y - _touchStart.y;
                if (dy > SwipeThresholdPx)       { _touchRollLatched = true; RollHeld = true; RollDir = leftZone ? -1 : +1; }
                else if (dy < -SwipeThresholdPx) { _touchRollLatched = false; RollHeld = false; }
            }
            else if (_touchActive)
            {
                _touchActive = false;
                if (!_touchRollLatched) RollHeld = false;   // latched roll persists after lift
            }
        }
#else
        void HandleTouchLegacy()
        {
            if (Input.touchCount == 0)
            {
                if (_touchActive) { _touchActive = false; if (!_touchRollLatched) RollHeld = false; }
                return;
            }
            Touch t = Input.GetTouch(0);
            if (t.phase == TouchPhase.Began) { _touchActive = true; _touchStart = t.position; TapThisFrame = true; }
            bool leftZone = t.position.x < Screen.width * 0.5f;
            if (leftZone) SteerLeft = true; else SteerRight = true;

            float dy = t.position.y - _touchStart.y;
            if (dy > SwipeThresholdPx)       { _touchRollLatched = true; RollHeld = true; RollDir = leftZone ? -1 : +1; }
            else if (dy < -SwipeThresholdPx) { _touchRollLatched = false; RollHeld = false; }
        }
#endif
    }
}
