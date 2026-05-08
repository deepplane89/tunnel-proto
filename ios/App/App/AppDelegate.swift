import UIKit
import Capacitor
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    // 120Hz ProMotion display link (iPhone 13 Pro and newer)
    private var displayLink: CADisplayLink?

    // ──────────────────────────────────────────────────────────────────────
    // AVAudioSession lifecycle
    // ──────────────────────────────────────────────────────────────────────
    // We use .ambient + .mixWithOthers so the game's Web Audio output mixes
    // with Spotify/Apple Music and respects the silent switch. But this
    // category alone does NOT guarantee audio stops when the app
    // backgrounds — any in-flight BufferSourceNode or paused-but-resumed
    // <audio> element can keep producing samples until iOS reclaims the
    // session, which can take a beat or never (when swiped from app
    // switcher and then re-launched).
    //
    // Fix: explicitly deactivate the AVAudioSession on background/terminate
    // and reactivate on foreground. With .notifyOthersOnDeactivation we
    // also tell other audio apps they can take the route back.
    private func activateAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .ambient,
                mode: .default,
                options: [.mixWithOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("[JetHorizon] AVAudioSession activate failed: \(error)")
        }
    }

    private func deactivateAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setActive(
                false,
                options: [.notifyOthersOnDeactivation]
            )
        } catch {
            NSLog("[JetHorizon] AVAudioSession deactivate failed: \(error)")
        }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        activateAudioSession()

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
        // Fired on incoming call, app switcher, Control Center.
        // Deactivate audio so any mid-playback buffer node stops immediately.
        deactivateAudioSession()
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Re-enable idle timer to spare battery while backgrounded.
        application.isIdleTimerDisabled = false
        // Defensive double-deactivate in case willResignActive was skipped.
        deactivateAudioSession()
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Reactivate audio so the WebView's AudioContext.resume() can drive it
        // when JS catches the visibilitychange event.
        activateAudioSession()
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        application.isIdleTimerDisabled = true
        // Reactivate (idempotent) — handles the willResignActive→didBecomeActive
        // path where we never went fully into background.
        activateAudioSession()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // User swiped the app away from the app switcher.
        // Clean up audio so we never leave a stuck route.
        deactivateAudioSession()
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
