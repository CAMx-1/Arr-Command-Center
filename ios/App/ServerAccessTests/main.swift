// Unit tests for ios/App/App/ServerAccessCore.swift, compiled for macOS with swiftc.
// Run: swiftc -O ios/App/App/ServerAccessCore.swift ios/App/ServerAccessTests/main.swift -o /tmp/sa-tests && /tmp/sa-tests
import Foundation

var failures = 0
var passes = 0
func check(_ cond: @autoclosure () -> Bool, _ name: String, line: UInt = #line) {
    if cond() { passes += 1 } else { failures += 1; print("FAIL \(name) (line \(line))") }
}
let u = { (s: String) in URL(string: s)! }

check(ServerAccess.origin(of: "https://ArrCC.Example.com/path?x=1") == "https://arrcc.example.com", "lowercases host, drops path")
check(ServerAccess.origin(of: "https://arrcc.example.com:443") == "https://arrcc.example.com", "default https port dropped")
check(ServerAccess.origin(of: "http://192.168.1.10:7373/") == "http://192.168.1.10:7373", "keeps non-default port")
check(ServerAccess.origin(of: "ftp://x.example.com") == nil, "non-http rejected")
check(ServerAccess.origin(of: "https://user:pw@x.example.com") == nil, "credentials rejected")
check(ServerAccess.origin(of: "not a url") == nil, "garbage rejected")

let saved = "https://arrcc.example.com"
check(ServerAccess.allows(u("https://arrcc.example.com/?acc_native=1"), saved: saved), "same origin allowed")
check(ServerAccess.allows(u("https://ARRCC.example.com/login.html"), saved: saved), "case-insensitive host")
check(!ServerAccess.allows(u("http://arrcc.example.com/"), saved: saved), "scheme must match")
check(!ServerAccess.allows(u("https://arrcc.example.com:8443/"), saved: saved), "port must match")
check(!ServerAccess.allows(u("https://evil.example.com/"), saved: saved), "other host refused")
check(!ServerAccess.allows(u("https://arrcc.example.com.evil.net/"), saved: saved), "suffix trick refused")
check(!ServerAccess.allows(u("https://arrcc.example.com/"), saved: nil), "nothing saved: nothing allowed")

print("\(passes) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)
