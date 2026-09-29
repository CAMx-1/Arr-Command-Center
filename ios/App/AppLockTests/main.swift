// Unit tests for ios/App/App/AppLockCore.swift, compiled for macOS with swiftc.
// Run: node test/appLockCore.test.js  (or directly:
//   swiftc -O ios/App/App/AppLockCore.swift ios/App/AppLockTests/main.swift -o /tmp/applock-tests && /tmp/applock-tests)
import Foundation

var failures = 0
var passes = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, file: StaticString = #file, line: UInt = #line) {
    if cond() { passes += 1 } else { failures += 1; print("FAIL \(name) (line \(line))") }
}

// Config / validation
check(AppLockConfig.isValidPasscode("123456"), "6 digits valid")
check(!AppLockConfig.isValidPasscode("12345"), "5 digits invalid")
check(!AppLockConfig.isValidPasscode("1234567"), "7 digits invalid")
check(!AppLockConfig.isValidPasscode("12345a"), "letters invalid")
check(!AppLockConfig.isValidPasscode("١٢٣٤٥٦"), "non-ASCII digits invalid")
check(AppLockConfig.normalizedTimeout(5) == 5, "5 min kept")
check(AppLockConfig.normalizedTimeout(10) == 10, "10 min kept")
check(AppLockConfig.normalizedTimeout(3) == 1, "unsupported → default 1")
check(AppLockConfig.normalizedTimeout(nil) == 1, "nil → default 1")

// Hashing (low rounds keep the test fast; production uses 210k)
let rec = PasscodeHasher.makeRecord(passcode: "482913", timeoutMinutes: 5, rounds: 1000)
check(rec.salt.count == 16 && rec.hash.count == 32, "salt/hash sizes")
check(rec.timeoutMinutes == 5, "timeout stored")
check(PasscodeHasher.verify("482913", against: rec), "correct passcode verifies")
check(!PasscodeHasher.verify("482914", against: rec), "wrong passcode rejected")
let rec2 = PasscodeHasher.makeRecord(passcode: "482913", timeoutMinutes: 5, rounds: 1000)
check(rec.salt != rec2.salt && rec.hash != rec2.hash, "random salt per record")
// RFC-style known vector: PBKDF2-HMAC-SHA256("password","salt",1) prefix 120fb6cf
let kv = PasscodeHasher.derive("password", salt: Data("salt".utf8), rounds: 1)
check(kv.prefix(4) == Data([0x12, 0x0f, 0xb6, 0xcf]), "PBKDF2-SHA256 known vector")
check(PasscodeHasher.constantTimeEqual(Data([1, 2]), Data([1, 2])), "ct equal")
check(!PasscodeHasher.constantTimeEqual(Data([1, 2]), Data([1, 3])), "ct differ")
check(!PasscodeHasher.constantTimeEqual(Data([1]), Data([1, 2])), "ct length")

// Codable round-trip (what goes into the Keychain)
let encoded = try! JSONEncoder().encode(rec)
check(try! JSONDecoder().decode(PasscodeRecord.self, from: encoded) == rec, "record round-trips")

// Attempt limiter
let t0 = Date(timeIntervalSince1970: 1_000_000)
var r = rec
for _ in 0..<4 { r = AttemptLimiter.registerFailure(r, now: t0) }
check(r.failedAttempts == 4 && r.lockedUntil == nil, "first 4 failures free")
r = AttemptLimiter.registerFailure(r, now: t0)
check(AttemptLimiter.remainingLockout(r, now: t0) == 60, "5th failure → 1 min")
check(AttemptLimiter.remainingLockout(r, now: t0.addingTimeInterval(61)) == 0, "lockout expires")
r = AttemptLimiter.registerFailure(r, now: t0)
check(AttemptLimiter.remainingLockout(r, now: t0) == 300, "6th → 5 min")
r = AttemptLimiter.registerFailure(r, now: t0)
check(AttemptLimiter.remainingLockout(r, now: t0) == 900, "7th → 15 min")
r = AttemptLimiter.registerFailure(r, now: t0)
check(AttemptLimiter.remainingLockout(r, now: t0) == 3600, "8th → 60 min")
r = AttemptLimiter.registerFailure(r, now: t0)
check(AttemptLimiter.remainingLockout(r, now: t0) == 3600, "9th+ stays 60 min")
r = AttemptLimiter.registerSuccess(r)
check(r.failedAttempts == 0 && r.lockedUntil == nil, "success resets")

// Lock policy (monotonic uptime seconds)
check(!LockPolicy.shouldLock(enabled: false, backgroundedAtUptime: nil, nowUptime: 0, timeoutMinutes: 1), "disabled never locks")
check(LockPolicy.shouldLock(enabled: true, backgroundedAtUptime: nil, nowUptime: 50, timeoutMinutes: 10), "cold launch locks")
check(!LockPolicy.shouldLock(enabled: true, backgroundedAtUptime: 100, nowUptime: 159, timeoutMinutes: 1), "59s < 1 min stays unlocked")
check(LockPolicy.shouldLock(enabled: true, backgroundedAtUptime: 100, nowUptime: 160, timeoutMinutes: 1), "60s locks at 1 min")
check(!LockPolicy.shouldLock(enabled: true, backgroundedAtUptime: 100, nowUptime: 399, timeoutMinutes: 5), "<5 min unlocked")
check(LockPolicy.shouldLock(enabled: true, backgroundedAtUptime: 100, nowUptime: 400, timeoutMinutes: 5), "5 min locks")
check(!LockPolicy.shouldLock(enabled: true, backgroundedAtUptime: 100, nowUptime: 699, timeoutMinutes: 10), "<10 min unlocked")
check(LockPolicy.shouldLock(enabled: true, backgroundedAtUptime: 100, nowUptime: 700, timeoutMinutes: 10), "10 min locks")
check(LockPolicy.shouldLock(enabled: true, backgroundedAtUptime: 500, nowUptime: 10, timeoutMinutes: 10), "uptime went backwards (reboot) → lock")

check(lockoutMessage(30) == "Try again in 30 sec", "sec message")
check(lockoutMessage(61) == "Try again in 2 min", "min message rounds up")

print("\(passes) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)
