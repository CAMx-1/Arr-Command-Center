import Foundation

// Keeps the user's own server inside the app.
//
// Capacitor only keeps navigations in the app's WebView for hosts listed in
// capacitor.config.json (allowNavigation); anything else is handed to Safari.
// That list can't know each user's server, so this plugin allows main-frame
// navigation to exactly the origin (scheme + host + port) the user entered on
// the connect screen. Nothing else is widened: other hosts still go through
// Capacitor's normal rules.
enum ServerAccess {
    static let defaultsKey = "acc.serverOrigin"
    // Older builds saved the server only through @capacitor/preferences.
    static let legacyPreferencesKey = "CapacitorStorage.acc:server-base"

    /// Normalised "scheme://host[:port]" for http(s) URLs without credentials.
    static func origin(of url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host?.lowercased(), !host.isEmpty,
              url.user == nil, url.password == nil else { return nil }
        let defaultPort = scheme == "https" ? 443 : 80
        if let port = url.port, port != defaultPort { return "\(scheme)://\(host):\(port)" }
        return "\(scheme)://\(host)"
    }

    static func origin(of string: String) -> String? {
        guard let url = URL(string: string.trimmingCharacters(in: .whitespacesAndNewlines)) else { return nil }
        return origin(of: url)
    }

    static var savedOrigin: String? {
        let defaults = UserDefaults.standard
        if let value = defaults.string(forKey: defaultsKey), let o = origin(of: value) { return o }
        if let value = defaults.string(forKey: legacyPreferencesKey), let o = origin(of: value) { return o }
        return nil
    }

    static func allows(_ url: URL?, saved: String? = savedOrigin) -> Bool {
        guard let url = url, let saved = saved, let o = origin(of: url) else { return false }
        return o == saved
    }
}
