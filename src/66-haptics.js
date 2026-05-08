// ═══════════════════════════════════════════════════════
//  HAPTIC FEEDBACK
// ═══════════════════════════════════════════════════════
//
// Three intensity levels mapped to:
//   - iOS Capacitor app:  AVFoundation Taptic Engine (precise)
//   - Web/Android Chrome: navigator.vibrate (rumble motor)
//   - iOS Safari:         no-op (Safari doesn't support vibrate)
//
// Plugin resolved lazily on first call so Capacitor has time to init.

let _Haptics = undefined;  // undefined = not yet resolved, null = unavailable
function _getHaptics() {
  if (_Haptics !== undefined) return _Haptics;
  _Haptics = (typeof nativePlugin === 'function') ? nativePlugin('Haptics') : null;
  return _Haptics;
}

function hapticTap() {
  if (!_settings.hapticsOn) return;
  const H = _getHaptics();
  if (H) {
    H.impact({ style: 'LIGHT' }).catch(() => {});
  } else if (navigator.vibrate) {
    navigator.vibrate(10);
  }
}

function hapticMedium() {
  if (!_settings.hapticsOn) return;
  const H = _getHaptics();
  if (H) {
    H.impact({ style: 'MEDIUM' }).catch(() => {});
  } else if (navigator.vibrate) {
    navigator.vibrate(25);
  }
}

function hapticHeavy() {
  if (!_settings.hapticsOn) return;
  const H = _getHaptics();
  if (H) {
    H.impact({ style: 'HEAVY' }).catch(() => {});
  } else if (navigator.vibrate) {
    navigator.vibrate([40, 30, 40]);
  }
}
