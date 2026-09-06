import AppKit
import CoreGraphics

let keys: [String: CGKeyCode] = ["z": 6, "x": 7, "c": 8, "v": 9, "w": 13, "s": 1, "a": 0, "d": 2, "up": 126, "down": 125, "left": 123, "right": 124, "return": 36, "plus": 24, "minus": 27, "e": 14, "q": 12, "u": 32, "o": 31]
let arguments = Array(CommandLine.arguments.dropFirst())
guard !arguments.isEmpty else { print("Usage: astris-input key[:holdSeconds[:waitSeconds]] ..."); exit(2) }
var steps: [(String, CGKeyCode, Double, Double)] = []
for argument in arguments {
    let fields = argument.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
    guard fields.count <= 3, let key = keys[fields[0]] else { exit(2) }
    guard let hold = fields.count > 1 ? Double(fields[1]) : 0.15,
          let wait = fields.count > 2 ? Double(fields[2]) : 0.6,
          hold.isFinite, wait.isFinite, hold >= 0.05, hold <= 2, wait >= 0, wait <= 30 else { exit(2) }
    steps.append((fields[0], key, hold, wait))
}
guard CGPreflightPostEventAccess() else { print("Event posting permission unavailable"); exit(2) }
guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: "V380-Ori.Astris").first else { exit(2) }
app.activate(options: [])
Thread.sleep(forTimeInterval: 0.3)
let source = CGEventSource(stateID: .hidSystemState)
for (index, step) in steps.enumerated() {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier, !app.isTerminated else {
        print("STOP: Astris lost focus at step \(index + 1)"); exit(3)
    }
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: step.1, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: step.1, keyDown: false) else { exit(2) }
    down.flags = []
    up.flags = []
    down.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: step.2)
    up.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: step.3)
    print("\(index + 1)/\(steps.count): \(step.0)")
}
