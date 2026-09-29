import UIKit
import Security
import Capacitor

// MARK: - Keychain persistence ------------------------------------------------
// The passcode record lives in the Keychain (ThisDeviceOnly: never synced to
// iCloud or restored to another device). The passcode itself never leaves
// native code — JavaScript only toggles the feature and reads its status.
enum AppLockStore {
    private static let service = "app.arrcommandcenter.mobile.applock"
    private static let account = "passcode"
    private static let installMarker = "acc.applock.installed"

    static func load() -> PasscodeRecord? {
        clearIfReinstalled()
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return try? JSONDecoder().decode(PasscodeRecord.self, from: data)
    }

    @discardableResult
    static func save(_ record: PasscodeRecord) -> Bool {
        guard let data = try? JSONEncoder().encode(record) else { return false }
        let update: [String: Any] = [kSecValueData as String: data]
        var status = SecItemUpdate(baseQuery() as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            var add = baseQuery()
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        if status != errSecSuccess { NSLog("[AppLock] keychain save failed: %d", status) }
        UserDefaults.standard.set(true, forKey: installMarker)
        return status == errSecSuccess
    }

    static func clear() { SecItemDelete(baseQuery() as CFDictionary) }

    // Keychain items survive app deletion; UserDefaults don't. A fresh install
    // must not inherit a passcode the user can no longer remember setting.
    private static func clearIfReinstalled() {
        if !UserDefaults.standard.bool(forKey: installMarker) { clear() }
    }

    private static func baseQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }
}

// MARK: - Controller -----------------------------------------------------------
/// Owns the lock state and the covering window. A dedicated UIWindow above the
/// app window means the WebView (and whatever page it's showing) is never
/// visible or interactive while locked, on any origin.
final class AppLockManager {
    static let shared = AppLockManager()

    private var coverWindow: UIWindow?
    private var backgroundedAt: TimeInterval?
    private(set) var isLocked = false
    var onUnlock: (() -> Void)?

    var record: PasscodeRecord? { AppLockStore.load() }
    var isEnabled: Bool { record != nil }

    // Cold launch: lock immediately if enabled (before any content is shown).
    func appDidLaunch() {
        if isEnabled { lock() }
    }

    func appWillResignActive() {
        // Always cover in the app switcher when the lock is on.
        guard isEnabled else { return }
        showCover(mode: isLocked ? .passcode : .privacy)
    }

    func appDidEnterBackground() {
        guard isEnabled else { return }
        if !isLocked { backgroundedAt = ProcessInfo.processInfo.systemUptime }
    }

    func appDidBecomeActive() {
        guard let rec = record else { hideCover(); return }
        if isLocked { showCover(mode: .passcode); return }
        let lockNow = backgroundedAt != nil && LockPolicy.shouldLock(
            enabled: true, backgroundedAtUptime: backgroundedAt,
            nowUptime: ProcessInfo.processInfo.systemUptime, timeoutMinutes: rec.timeoutMinutes)
        backgroundedAt = nil
        if lockNow { lock() } else { hideCover() }
    }

    func lock() {
        isLocked = true
        showCover(mode: .passcode)
    }

    // MARK: configuration (called from the plugin)
    @discardableResult
    func enable(passcode: String, timeoutMinutes: Int) -> Bool {
        AppLockStore.save(PasscodeHasher.makeRecord(passcode: passcode, timeoutMinutes: timeoutMinutes))
    }

    func setTimeout(_ minutes: Int) -> Bool {
        guard var rec = record else { return false }
        rec.timeoutMinutes = AppLockConfig.normalizedTimeout(minutes)
        return AppLockStore.save(rec)
    }

    func disable() {
        AppLockStore.clear()
        isLocked = false
        backgroundedAt = nil
        hideCover()
    }

    /// Verify for unlock or for confirming a settings change. Applies throttling.
    enum VerifyResult { case ok, wrong(remainingFree: Int), throttled(TimeInterval), notEnabled }
    func verify(_ passcode: String) -> VerifyResult {
        guard let rec = record else { return .notEnabled }
        let now = Date()
        let wait = AttemptLimiter.remainingLockout(rec, now: now)
        if wait > 0 { return .throttled(wait) }
        if PasscodeHasher.verify(passcode, against: rec) {
            AppLockStore.save(AttemptLimiter.registerSuccess(rec))
            return .ok
        }
        let next = AttemptLimiter.registerFailure(rec, now: now)
        AppLockStore.save(next)
        let after = AttemptLimiter.remainingLockout(next, now: now)
        if after > 0 { return .throttled(after) }
        return .wrong(remainingFree: max(0, AttemptLimiter.freeAttempts - next.failedAttempts))
    }

    // MARK: cover window
    private func showCover(mode: LockViewController.Mode) {
        if coverWindow == nil {
            let w = UIWindow(frame: UIScreen.main.bounds)
            w.windowLevel = .alert + 1
            w.rootViewController = LockViewController()
            coverWindow = w
        }
        (coverWindow?.rootViewController as? LockViewController)?.configure(mode: mode) { [weak self] in
            self?.isLocked = false
            self?.hideCover()
            self?.onUnlock?()
        }
        coverWindow?.isHidden = false
        coverWindow?.makeKeyAndVisible()
    }

    private func hideCover() {
        guard let w = coverWindow else { return }
        w.isHidden = true
        coverWindow = nil
        // Hand key status back to the app window so the keyboard/WebView work.
        UIApplication.shared.windows.first { $0 !== w && !$0.isHidden }?.makeKeyAndVisible()
    }
}

// MARK: - Lock screen UI -------------------------------------------------------
final class LockViewController: UIViewController {
    enum Mode { case privacy, passcode }

    private var mode: Mode = .privacy
    private var onUnlock: (() -> Void)?
    private var entered = ""
    private var throttleTimer: Timer?

    private let logo = UIImageView()
    private let titleLabel = UILabel()
    private let messageLabel = UILabel()
    private let dots = UIStackView()
    private let pad = UIStackView()
    private var digitButtons: [UIButton] = []

    private let bg = UIColor(red: 0x0f / 255, green: 0x11 / 255, blue: 0x17 / 255, alpha: 1)
    private let accent = UIColor(red: 0x8b / 255, green: 0x5c / 255, blue: 0xf6 / 255, alpha: 1)

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bg
        view.accessibilityViewIsModal = true

        // The bundled web icon (public/ is copied into the app by `cap copy`).
        if let path = Bundle.main.path(forResource: "icon-192", ofType: "png", inDirectory: "public/icons") {
            logo.image = UIImage(contentsOfFile: path)
        }
        logo.contentMode = .scaleAspectFit
        logo.layer.cornerRadius = 18
        logo.clipsToBounds = true
        logo.isAccessibilityElement = false

        titleLabel.text = "Enter Passcode"
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 20, weight: .semibold)
        titleLabel.textAlignment = .center
        titleLabel.accessibilityTraits = .header

        messageLabel.textColor = UIColor(white: 0.72, alpha: 1)
        messageLabel.font = .systemFont(ofSize: 14)
        messageLabel.textAlignment = .center
        messageLabel.numberOfLines = 0

        dots.axis = .horizontal
        dots.spacing = 18
        for _ in 0..<AppLockConfig.passcodeLength {
            let d = UIView()
            d.layer.cornerRadius = 7
            d.layer.borderWidth = 1.5
            d.layer.borderColor = UIColor.white.cgColor
            d.translatesAutoresizingMaskIntoConstraints = false
            d.widthAnchor.constraint(equalToConstant: 14).isActive = true
            d.heightAnchor.constraint(equalToConstant: 14).isActive = true
            dots.addArrangedSubview(d)
        }
        dots.isAccessibilityElement = true

        pad.axis = .vertical
        pad.spacing = 16
        let rows: [[String]] = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["", "0", "⌫"]]
        for row in rows {
            let r = UIStackView()
            r.axis = .horizontal
            r.spacing = 24
            r.distribution = .fillEqually
            for key in row { r.addArrangedSubview(makeKey(key)) }
            pad.addArrangedSubview(r)
        }

        let stack = UIStackView(arrangedSubviews: [logo, titleLabel, dots, messageLabel, pad])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 18
        stack.setCustomSpacing(34, after: messageLabel)
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            logo.widthAnchor.constraint(equalToConstant: 72),
            logo.heightAnchor.constraint(equalToConstant: 72),
            messageLabel.widthAnchor.constraint(lessThanOrEqualToConstant: 300),
            messageLabel.heightAnchor.constraint(greaterThanOrEqualToConstant: 20),
            stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
        ])
        apply()
    }

    func configure(mode: Mode, onUnlock: @escaping () -> Void) {
        self.onUnlock = onUnlock
        if self.mode != mode { entered = "" }
        self.mode = mode
        if isViewLoaded { apply() }
    }

    private func makeKey(_ key: String) -> UIView {
        guard !key.isEmpty else { return UIView() }
        let b = UIButton(type: .system)
        b.setTitle(key, for: .normal)
        b.setTitleColor(.white, for: .normal)
        b.titleLabel?.font = key == "⌫" ? .systemFont(ofSize: 24) : .systemFont(ofSize: 32, weight: .regular)
        b.backgroundColor = key == "⌫" ? .clear : UIColor(white: 1, alpha: 0.12)
        b.layer.cornerRadius = 38
        b.translatesAutoresizingMaskIntoConstraints = false
        b.widthAnchor.constraint(equalToConstant: 76).isActive = true
        b.heightAnchor.constraint(equalToConstant: 76).isActive = true
        b.accessibilityLabel = key == "⌫" ? "Delete" : key
        b.addAction(for: key == "⌫" ? { [weak self] in self?.backspace() } : { [weak self] in self?.digit(key) })
        if key != "⌫" { digitButtons.append(b) }
        return b
    }

    private func apply() {
        let locked = mode == .passcode
        titleLabel.isHidden = !locked
        dots.isHidden = !locked
        pad.isHidden = !locked
        messageLabel.isHidden = !locked
        if locked { refreshThrottle() }
        renderDots()
    }

    private func digit(_ d: String) {
        guard entered.count < AppLockConfig.passcodeLength, !isThrottled else { return }
        entered += d
        renderDots()
        if entered.count == AppLockConfig.passcodeLength {
            let code = entered
            // Let the last dot render before the ~100 ms hash.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in self?.submit(code) }
        }
    }

    private func backspace() {
        guard !entered.isEmpty else { return }
        entered.removeLast()
        renderDots()
    }

    private func submit(_ code: String) {
        switch AppLockManager.shared.verify(code) {
        case .ok, .notEnabled:
            entered = ""
            messageLabel.text = ""
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onUnlock?()
        case .wrong(let remaining):
            fail(remaining > 0 && remaining <= 2 ? "Wrong passcode · \(remaining) attempt\(remaining == 1 ? "" : "s") before a delay" : "Wrong passcode")
        case .throttled:
            fail(nil)
            refreshThrottle()
        }
    }

    private func fail(_ message: String?) {
        entered = ""
        renderDots()
        if let message { messageLabel.text = message }
        UINotificationFeedbackGenerator().notificationOccurred(.error)
        let shake = CAKeyframeAnimation(keyPath: "transform.translation.x")
        shake.values = [-14, 14, -10, 10, -5, 5, 0]
        shake.duration = 0.4
        dots.layer.add(shake, forKey: "shake")
        UIAccessibility.post(notification: .announcement, argument: messageLabel.text ?? "Wrong passcode")
    }

    private var isThrottled: Bool {
        guard let rec = AppLockManager.shared.record else { return false }
        return AttemptLimiter.remainingLockout(rec, now: Date()) > 0
    }

    private func refreshThrottle() {
        throttleTimer?.invalidate()
        guard let rec = AppLockManager.shared.record else { return }
        let wait = AttemptLimiter.remainingLockout(rec, now: Date())
        digitButtons.forEach { $0.isEnabled = wait == 0; $0.alpha = wait == 0 ? 1 : 0.35 }
        if wait > 0 {
            messageLabel.text = lockoutMessage(wait)
            throttleTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: false) { [weak self] _ in self?.refreshThrottle() }
        } else if messageLabel.text?.hasPrefix("Try again") == true {
            messageLabel.text = ""
        }
    }

    private func renderDots() {
        for (i, v) in dots.arrangedSubviews.enumerated() {
            v.backgroundColor = i < entered.count ? .white : .clear
        }
        dots.accessibilityLabel = "\(entered.count) of \(AppLockConfig.passcodeLength) digits entered"
    }
}

private extension UIButton {
    func addAction(for handler: @escaping () -> Void) {
        let target = ClosureTarget(handler)
        addTarget(target, action: #selector(ClosureTarget.fire), for: .touchUpInside)
        objc_setAssociatedObject(self, "acc.closure", target, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }
}
private final class ClosureTarget: NSObject {
    let handler: () -> Void
    init(_ h: @escaping () -> Void) { handler = h }
    @objc func fire() { handler() }
}

// MARK: - Capacitor plugin (window.Capacitor.Plugins.AppLock) -----------------
// Settings collects the digits in its form and sends them once over the
// in-process bridge; native hashes and stores them. JS never gets the hash
// back, and disabling/changing requires the current passcode.
@objc(AppLockPlugin)
public class AppLockPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppLockPlugin"
    public let jsName = "AppLock"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setTimeout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "changePasscode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lockNow", returnType: CAPPluginReturnPromise),
    ]

    private var manager: AppLockManager { .shared }

    @objc func getStatus(_ call: CAPPluginCall) {
        let rec = manager.record
        call.resolve([
            "enabled": rec != nil,
            "timeoutMinutes": rec?.timeoutMinutes ?? AppLockConfig.defaultTimeoutMinutes,
            "timeoutOptions": AppLockConfig.timeoutOptions,
            "passcodeLength": AppLockConfig.passcodeLength,
        ])
    }

    @objc func enable(_ call: CAPPluginCall) {
        guard let code = call.getString("passcode"), AppLockConfig.isValidPasscode(code) else {
            return call.reject("Passcode must be \(AppLockConfig.passcodeLength) digits", "INVALID_PASSCODE")
        }
        if manager.isEnabled { return call.reject("Passcode is already set; use changePasscode", "ALREADY_ENABLED") }
        let minutes = AppLockConfig.normalizedTimeout(call.getInt("timeoutMinutes"))
        DispatchQueue.global(qos: .userInitiated).async {
            guard self.manager.enable(passcode: code, timeoutMinutes: minutes) else {
                return call.reject("Could not save the passcode to the Keychain", "STORAGE_FAILED")
            }
            call.resolve(["enabled": true, "timeoutMinutes": minutes])
        }
    }

    // Turning the lock off or changing it requires the current passcode, so
    // someone holding an unlocked phone can't silently remove it.
    @objc func disable(_ call: CAPPluginCall) {
        withVerifiedPasscode(call) { self.manager.disable(); call.resolve(["enabled": false]) }
    }

    @objc func changePasscode(_ call: CAPPluginCall) {
        guard let next = call.getString("newPasscode"), AppLockConfig.isValidPasscode(next) else {
            return call.reject("New passcode must be \(AppLockConfig.passcodeLength) digits", "INVALID_PASSCODE")
        }
        withVerifiedPasscode(call) {
            let minutes = self.manager.record?.timeoutMinutes ?? AppLockConfig.defaultTimeoutMinutes
            guard self.manager.enable(passcode: next, timeoutMinutes: minutes) else {
                return call.reject("Could not save the passcode to the Keychain", "STORAGE_FAILED")
            }
            call.resolve(["enabled": true])
        }
    }

    @objc func setTimeout(_ call: CAPPluginCall) {
        guard let minutes = call.getInt("timeoutMinutes"), AppLockConfig.timeoutOptions.contains(minutes) else {
            return call.reject("timeoutMinutes must be one of \(AppLockConfig.timeoutOptions)", "INVALID_TIMEOUT")
        }
        manager.setTimeout(minutes) ? call.resolve(["timeoutMinutes": minutes]) : call.reject("Passcode lock is off", "NOT_ENABLED")
    }

    @objc func lockNow(_ call: CAPPluginCall) {
        guard manager.isEnabled else { return call.reject("Passcode lock is off", "NOT_ENABLED") }
        DispatchQueue.main.async { self.manager.lock(); call.resolve() }
    }

    private func withVerifiedPasscode(_ call: CAPPluginCall, then: @escaping () -> Void) {
        guard let code = call.getString("passcode"), AppLockConfig.isValidPasscode(code) else {
            return call.reject("Enter your current \(AppLockConfig.passcodeLength)-digit passcode", "INVALID_PASSCODE")
        }
        DispatchQueue.global(qos: .userInitiated).async {
            switch self.manager.verify(code) {
            case .ok: then()
            case .notEnabled: call.reject("Passcode lock is off", "NOT_ENABLED")
            case .wrong: call.reject("Current passcode is incorrect", "WRONG_PASSCODE")
            case .throttled(let s): call.reject("Too many attempts. \(lockoutMessage(s)).", "THROTTLED")
            }
        }
    }
}
