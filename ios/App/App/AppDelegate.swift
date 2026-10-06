import UIKit
import Capacitor
import AVFoundation
import WebKit
import os

/// Diagnostyka: JS woła window.webkit.messageHandlers.diag.postMessage("...")
/// (src/diag.ts) i trafia to do logu systemowego iPhone'a z prefiksem DENISDIAG.
/// Bez Maca nie ma Web Inspectora, a log systemowy da się czytać z Windowsa (go-ios).
class DiagHandler: NSObject, WKScriptMessageHandler {
    private let log = Logger(subsystem: "pl.impulsywni.denis", category: "diag")
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let text = String(describing: message.body)
        log.notice("DENISDIAG \(text, privacy: .public)")
    }
}

/// Podpięty w Main.storyboard zamiast gołego CAPBridgeViewController.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        webView?.configuration.userContentController.add(DiagHandler(), name: "diag")
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Gra muzyczna: kategoria .playback, żeby dźwięk z Web Audio (WKWebView)
        // nie był uciszany przełącznikiem/trybem wyciszenia (domyślnie
        // soloAmbient → gra bez dźwięku). Patrz też setPlaybackAudioSession() w src/audio.ts.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        try? AVAudioSession.sharedInstance().setActive(true)
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
