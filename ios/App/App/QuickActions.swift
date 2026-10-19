import UIKit
import Capacitor

// Home-screen quick actions (long-press the app icon) and arrcc:// deep links.
//
// The web app decides which actions to show (it knows your services) and calls
// QuickActions.setItems. Each item carries an arrcc:// URL. Choosing one is
// delivered to JavaScript exactly like a tapped arrcc:// link, through the
// Capacitor App plugin's `appUrlOpen` event. On a cold launch the URL is held
// here until the web app asks for it (getPending), because the WebView isn't
// listening yet.
enum DeepLinkCenter {
    static let scheme = "arrcc"
    static let urlKey = "url"
    static var pendingURL: URL?

    static func url(for item: UIApplicationShortcutItem) -> URL? {
        guard let s = item.userInfo?[urlKey] as? String, let url = URL(string: s), url.scheme == scheme else { return nil }
        return url
    }

    /// Warm app: hand the URL to Capacitor so `appUrlOpen` fires in JS.
    static func deliver(_ url: URL) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }
}

@objc(QuickActionsPlugin)
public class QuickActionsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "QuickActionsPlugin"
    public let jsName = "QuickActions"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setItems", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPending", returnType: CAPPluginReturnPromise),
    ]

    /// items: [{ type, title, subtitle?, icon? (SF Symbol), url (arrcc://…) }], at most 4.
    @objc func setItems(_ call: CAPPluginCall) {
        let raw = call.getArray("items", JSObject.self) ?? []
        var items: [UIApplicationShortcutItem] = []
        for obj in raw.prefix(4) {
            guard let type = obj["type"] as? String, let title = obj["title"] as? String,
                  let url = obj["url"] as? String, URL(string: url)?.scheme == DeepLinkCenter.scheme else { continue }
            let icon = (obj["icon"] as? String).flatMap { UIApplicationShortcutIcon(systemImageName: $0) }
            items.append(UIApplicationShortcutItem(
                type: "app.arrcommandcenter.mobile.\(type)",
                localizedTitle: String(title.prefix(40)),
                localizedSubtitle: (obj["subtitle"] as? String).map { String($0.prefix(60)) },
                icon: icon,
                userInfo: [DeepLinkCenter.urlKey: url as NSString]))
        }
        DispatchQueue.main.async {
            UIApplication.shared.shortcutItems = items
            call.resolve(["count": items.count])
        }
    }

    /// The quick action / link that cold-launched the app, once.
    @objc func getPending(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let url = DeepLinkCenter.pendingURL
            DeepLinkCenter.pendingURL = nil
            call.resolve(url.map { ["url": $0.absoluteString] } ?? [:])
        }
    }
}
