// ═══════════════════════════════════════════════════════
//  HAPTIC FEEDBACK
// ═══════════════════════════════════════════════════════
function hapticTap()    { if (_settings.hapticsOn && navigator.vibrate) navigator.vibrate(10); }
function hapticMedium() { if (_settings.hapticsOn && navigator.vibrate) navigator.vibrate(25); }
function hapticHeavy()  { if (_settings.hapticsOn && navigator.vibrate) navigator.vibrate([40, 30, 40]); }

