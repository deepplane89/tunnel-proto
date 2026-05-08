import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // 120Hz ProMotion display link (iPhone 13 Pro and newer)
    private var displayLink: CADisplayLink?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // ── AUDIO ─────────────────────────────────────────────────────────────
        // .ambient = mixes with Spotify/Apple Music + respects silent switch
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

        // ── PREVENT IDLE/THROTTLE ─────────────────────────────────────────────
        // Stops iOS from dimming, sleeping, or down-clocking the GPU mid-play.
        application.isIdleTimerDisabled = true

        // ── 120Hz PROMOTION ───────────────────────────────────────────────────
        // Request the highest available refresh rate on ProMotion devices
        // (iPhone 13 Pro, 14 Pro, 15 Pro, 16 Pro). On non-ProMotion devices
        // this is a no-op — they stay at 60Hz.
        if #available(iOS 15.0, *) {
            let link = CADisplayLink(target: self, selector: #selector(displayTick))
            link.preferredFrameRateRange = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)
            link.add(to: .main, forMode: .common)
            self.displayLink = link
        }

        return true
    }

    @objc private func displayTick() {
        // No-op: just by existing this CADisplayLink tells the system the app
        // wants 120Hz, which lifts the WebView/CAMetalLayer cap.
    }

    func applicationWillResignActive(_ application: UIApplication) {}

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Re-enable idle timer when backgrounded so we don't drain battery
        application.isIdleTimerDisabled = false
    }

    func applicationWillEnterForeground(_ application: UIApplication) {}

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Re-disable idle timer when returning to play
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
