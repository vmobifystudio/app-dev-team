import SwiftUI

struct RootView: View {
    let config: Data
    var body: some View {
        Text("split \(config.count) bytes of config")
    }
}

@main
struct SplitEvenApp: App {
    // THE PLANTED DEFECT. config.json is referenced here and is not a member of the app target,
    // so Bundle.main.url(forResource:) returns nil and this force-unwrap traps. It compiles
    // cleanly and it installs cleanly; it dies on the first frame. That gap between "builds"
    // and "runs" is the entire reason scripts/runtime-gate.sh exists.
    //
    // The gate must return 1 for this file. Repair the line — the `repaired` step in
    // .github/workflows/checks.yml does exactly that on a runner with Xcode — and it must
    // return 0. A gate that cannot tell those two apart is not a gate, and until that pair of
    // runs existed, nothing anywhere had ever proven it could.
    let config = try! Data(contentsOf: Bundle.main.url(forResource: "config", withExtension: "json")!)

    var body: some Scene {
        WindowGroup { RootView(config: config) }
    }
}
