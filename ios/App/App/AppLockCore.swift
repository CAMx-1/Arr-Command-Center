import Foundation
import CommonCrypto
import Security

// Pure, UIKit-free logic for the app passcode lock so it can be compiled and
// unit-tested on macOS (see ios/App/AppLockTests/main.swift, run by npm test).

enum AppLockConfig {
    /// Passcode length (digits only), like the iOS device passcode.
    static let passcodeLength = 6
    /// The only "lock after" choices offered, in minutes.
    static let timeoutOptions = [1, 5, 10]
    static let defaultTimeoutMinutes = 1
    /// PBKDF2-SHA256 work factor. ~100 ms on a recent iPhone.
    static let pbkdf2Rounds: UInt32 = 210_000
    static let saltBytes = 16
    static let hashBytes = 32

    static func normalizedTimeout(_ minutes: Int?) -> Int {
        guard let minutes, timeoutOptions.contains(minutes) else { return defaultTimeoutMinutes }
        return minutes
    }

    static func isValidPasscode(_ code: String) -> Bool {
        code.count == passcodeLength && code.allSatisfy { $0.isASCII && $0.isNumber }
    }
}

/// What's persisted (in the Keychain) while the lock is enabled.
struct PasscodeRecord: Codable, Equatable {
    var salt: Data
    var hash: Data
    var rounds: UInt32
    var timeoutMinutes: Int
    /// Consecutive wrong entries; reset on success.
    var failedAttempts: Int = 0
    /// Wall-clock time until which entry is refused (nil = not throttled).
    var lockedUntil: Date?
}

enum PasscodeHasher {
    static func randomSalt(count: Int = AppLockConfig.saltBytes) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
        return Data(bytes)
    }

    static func derive(_ passcode: String, salt: Data, rounds: UInt32) -> Data {
        let password = Array(passcode.utf8)
        var out = [UInt8](repeating: 0, count: AppLockConfig.hashBytes)
        let status = salt.withUnsafeBytes { saltPtr -> Int32 in
            CCKeyDerivationPBKDF(
                CCPBKDFAlgorithm(kCCPBKDF2),
                password.map { Int8(bitPattern: $0) }, password.count,
                saltPtr.bindMemory(to: UInt8.self).baseAddress, salt.count,
                CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), rounds,
                &out, out.count)
        }
        precondition(status == kCCSuccess, "PBKDF2 failed")
        return Data(out)
    }

    static func makeRecord(passcode: String, timeoutMinutes: Int, rounds: UInt32 = AppLockConfig.pbkdf2Rounds) -> PasscodeRecord {
        let salt = randomSalt()
        return PasscodeRecord(salt: salt, hash: derive(passcode, salt: salt, rounds: rounds), rounds: rounds,
                              timeoutMinutes: AppLockConfig.normalizedTimeout(timeoutMinutes))
    }

    static func verify(_ passcode: String, against record: PasscodeRecord) -> Bool {
        constantTimeEqual(derive(passcode, salt: record.salt, rounds: record.rounds), record.hash)
    }

    static func constantTimeEqual(_ a: Data, _ b: Data) -> Bool {
        guard a.count == b.count else { return false }
        var diff: UInt8 = 0
        for i in 0..<a.count { diff |= a[a.startIndex + i] ^ b[b.startIndex + i] }
        return diff == 0
    }
}

/// Escalating delays after repeated wrong passcodes (mirrors iOS: the first
/// few mistakes are free, then 1 → 5 → 15 → 60 minute waits).
enum AttemptLimiter {
    static let freeAttempts = 5

    static func lockoutDuration(afterFailures failures: Int) -> TimeInterval {
        switch failures {
        case ..<freeAttempts: return 0
        case freeAttempts: return 60
        case freeAttempts + 1: return 5 * 60
        case freeAttempts + 2: return 15 * 60
        default: return 60 * 60
        }
    }

    /// Record a wrong entry and return the updated record.
    static func registerFailure(_ record: PasscodeRecord, now: Date) -> PasscodeRecord {
        var next = record
        next.failedAttempts += 1
        let wait = lockoutDuration(afterFailures: next.failedAttempts)
        next.lockedUntil = wait > 0 ? now.addingTimeInterval(wait) : nil
        return next
    }

    static func registerSuccess(_ record: PasscodeRecord) -> PasscodeRecord {
        var next = record
        next.failedAttempts = 0
        next.lockedUntil = nil
        return next
    }

    /// Seconds until entry is allowed again (0 = allowed now).
    static func remainingLockout(_ record: PasscodeRecord, now: Date) -> TimeInterval {
        guard let until = record.lockedUntil else { return 0 }
        return max(0, until.timeIntervalSince(now))
    }
}

/// Decides whether returning to the foreground requires the passcode.
/// Uses the system uptime (monotonic, unaffected by changing the clock); a
/// reboot or missing timestamp always locks.
enum LockPolicy {
    static func shouldLock(enabled: Bool, backgroundedAtUptime: TimeInterval?, nowUptime: TimeInterval, timeoutMinutes: Int) -> Bool {
        guard enabled else { return false }
        guard let start = backgroundedAtUptime, nowUptime >= start else { return true }
        return nowUptime - start >= TimeInterval(AppLockConfig.normalizedTimeout(timeoutMinutes) * 60)
    }
}

/// Text for the throttling message, e.g. "Try again in 4 min" / "in 30 sec".
func lockoutMessage(_ seconds: TimeInterval) -> String {
    let s = Int(seconds.rounded(.up))
    if s >= 60 { return "Try again in \(Int((Double(s) / 60).rounded(.up))) min" }
    return "Try again in \(s) sec"
}
