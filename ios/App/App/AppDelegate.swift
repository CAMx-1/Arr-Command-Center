import UIKit
import WebKit
import Capacitor

// Server mode navigates this WebView away from the bundled shell to the saved
// Arr Command Center URL. WKWebView can retain an old HTML/module graph across
// app rebuilds, so clear only cached responses on each cold launch. Cookies,
// localStorage, favorites, connection settings, and push registration remain
// intact because their website-data types are deliberately not removed.
@objc(AppBridgeViewController)
final class AppBridgeViewController: CAPBridgeViewController {
    private var startupCachePurgeStarted = false

    override func viewDidLoad() {
        super.viewDidLoad()
        guard !startupCachePurgeStarted else { return }
        startupCachePurgeStarted = true

        URLCache.shared.removeAllCachedResponses()
        let cacheTypes: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache,
            WKWebsiteDataTypeOfflineWebApplicationCache,
        ]
        WKWebsiteDataStore.default().removeData(
            ofTypes: cacheTypes,
            modifiedSince: .distantPast
        ) { [weak self] in
            DispatchQueue.main.async {
                guard let self,
                      let bridge = self.bridge,
                      let webView = self.webView else { return }
                let request = URLRequest(
                    url: bridge.config.appStartServerURL,
                    cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
                    timeoutInterval: 60
                )
                webView.load(request)
            }
        }
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
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

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
