import Foundation
import WebKit
import Capacitor

// Plugin side of ServerAccess (see ServerAccessCore.swift).
@objc(ServerAccessPlugin)
public class ServerAccessPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ServerAccessPlugin"
    public let jsName = "ServerAccess"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setServer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearServer", returnType: CAPPluginReturnPromise),
    ]

    @objc func setServer(_ call: CAPPluginCall) {
        guard let raw = call.getString("origin"), let origin = ServerAccess.origin(of: raw) else {
            call.reject("Enter an http:// or https:// server address without credentials")
            return
        }
        UserDefaults.standard.set(origin, forKey: ServerAccess.defaultsKey)
        call.resolve(["origin": origin])
    }

    @objc func clearServer(_ call: CAPPluginCall) {
        UserDefaults.standard.removeObject(forKey: ServerAccess.defaultsKey)
        call.resolve()
    }

    // true = cancel, false = allow, nil = let Capacitor decide.
    @objc override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        let mainFrame = navigationAction.targetFrame?.isMainFrame == true
        guard mainFrame, ServerAccess.allows(navigationAction.request.url) else { return nil }
        return NSNumber(value: false)
    }
}
