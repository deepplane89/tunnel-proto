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

    // ── WEB INSPECTOR GATING ──────────────────────────────────────────────────
    // iOS 16.4+: WKWebView is only inspectable from Safari Web Inspector when
    // isInspectable=true. Default in CapacitorBridge is true in DEBUG builds,
    // but we want to be explicit: never inspectable in RELEASE so end users
    // cannot peek at the bundle from a tethered Mac. Hooks into Capacitor's
    // bridge after didFinishLaunching via applicationDidBecomeActive (the
    // earliest point where the bridge VC + webView are guaranteed to exist).
    private var _inspectorGated = false
    private func gateWebInspector() {
        if _inspectorGated { return }
        guard let bridgeVC = window?.rootViewController as? CAPBridgeViewController,
              let webView = bridgeVC.webView else { return }
        if #available(iOS 16.4, *) {
            #if DEBUG
            webView.isInspectable = true
            #else
            webView.isInspectable = false
            #endif
            _inspectorGated = true
        }
    }

    // ── WEBVIEW BACKGROUND / SAFE-AREA STRIP FIX ──────────────────────────────
    // Capacitor's `ios.backgroundColor` config is ignored because the WKWebView
    // is opaque by default (https://github.com/ionic-team/capacitor/issues/5335).
    // The opaque WebView paints its own system background (black) into the
    // safe-area gap below the home indicator, producing the visible black strip.
    //
    // Fix: make the WebView transparent so the underlying view's
    // backgroundColor (set from capacitor.config.json `backgroundColor`) shows
    // through, AND set the WebView's own backgroundColor to the page bg
    // (#050614) as belt-and-suspenders for the moments before WebKit paints
    // anything. This is the native equivalent of what mobile Safari does
    // automatically for PWAs — that's why the web build never shows the strip.
    //
    // Page bg = --color-bg in style.css = #050614 (deep dark blue).
    private var _webViewStyled = false
    private func styleWebViewForSafeArea() {
        if _webViewStyled { return }
        guard let bridgeVC = window?.rootViewController as? CAPBridgeViewController,
              let webView = bridgeVC.webView else { return }
        let pageBg = UIColor(red: 0x05/255.0, green: 0x06/255.0, blue: 0x14/255.0, alpha: 1.0)
        webView.isOpaque = false
        webView.backgroundColor = pageBg
        webView.scrollView.backgroundColor = pageBg
        bridgeVC.view.backgroundColor = pageBg
        if let win = window {
            win.backgroundColor = pageBg
        }
        _webViewStyled = true
    }

    @objc private func displayTick() {
        // No-op: just by existing this CADisplayLink tells the system the app
        // wants 120Hz, which lifts the WebView/CAMetalLayer cap.
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
        // Re-enable idle timer when backgrounded so we don't drain battery
        application.isIdleTimerDisabled = false
    }

    func applicationWillEnterForeground(_ application: UIApplication) {}

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Re-disable idle timer when returning to play
        application.isIdleTimerDisabled = true
        // Apply inspector policy once webView exists
        gateWebInspector()
        // Paint the WebView container in the page bg so the home-indicator
        // safe-area gap doesn't show through as a black strip.
        styleWebViewForSafeArea()
    }

    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
