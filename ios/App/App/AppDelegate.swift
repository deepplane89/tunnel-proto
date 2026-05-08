import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // 120Hz ProMotion display link (iPhone 13 Pro and newer)
    private var displayLink: CADisplayLink?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // ── AUDIO SESSION ─────────────────────────────────────────────────────
        // .ambient + .mixWithOthers = mixes with Spotify/Apple Music + respects
        // the silent switch. iOS automatically pauses .ambient audio when the
        // app backgrounds and resumes it when foregrounded — we don't manually
        // deactivate/reactivate the session because doing so would interfere
        // with the JS-side _markAudioInterrupted / audioCtx.suspend snapshot
        // logic in 30-audio.js + 72-main-late-mid.js, which carefully tracks
        // which tracks were playing so it can re-issue play() on resume.
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .ambient,
                mode: .default,
                options: [.mixWithOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("[JetHorizon] AVAudioSession setup failed: \(error)")
        }

        // Stops iOS from dimming, sleeping, or down-clocking the GPU mid-play.
        application.isIdleTimerDisabled = true

        // Request the highest available refresh rate on ProMotion devices
        // (iPhone 13 Pro, 14 Pro, 15 Pro, 16 Pro). No-op on 60Hz devices.
        if #available(iOS 15.0, *) {
            let link = CADisplayLink(target: self, selector: #selector(displayTick))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)
            link.add(to: .main, forMode: .common)
            self.displayLink = link
        }

        return true
    }

    @objc private func displayTick() {
        // No-op: existence of this CADisplayLink hints the system to lift the cap.
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Pause every <audio> element synchronously the moment the user begins
        // swiping the app away (or any other resign-active gesture). Capacitor's
        // App.pause / appStateChange:inactive event fires noticeably later —
        // by the time JS receives it, the WKWebView's JS thread has already
        // been throttled for ~100-300ms, producing an audible audio stutter
        // during the swipe-up animation. Hooking this here lets us pause via
        // a direct evaluateJavaScript call before throttling kicks in.
        //
        // We only pause <audio> tags; we do NOT touch the AudioContext or
        // call _markAudioInterrupted here — the existing visibilitychange
        // path in 72-main-late-mid.js handles the suspend + snapshot once
        // Capacitor delivers the app-state event a moment later. Pausing
        // <audio> here twice (here + JS) is harmless: the second .pause()
        // is a no-op since the element is already paused.
        guard let bridgeVC = window?.rootViewController as? CAPBridgeViewController,
              let webView = bridgeVC.webView else { return }
        webView.evaluateJavaScript(
            "document.querySelectorAll('audio').forEach(function(a){ try { if (!a.paused) a.pause(); } catch(_){} });",
            completionHandler: nil
        )
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Re-enable idle timer to spare battery while backgrounded.
        application.isIdleTimerDisabled = false
    }

    func applicationWillEnterForeground(_ application: UIApplication) {}

    func applicationDidBecomeActive(_ application: UIApplication) {
        application.isIdleTimerDisabled = true
    }

    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
