import SwiftUI

@main
struct SplitEvenApp: App {
    // config.json is referenced here and is not a member of the app target.
    let config = try! Data(contentsOf: Bundle.main.url(forResource: "config", withExtension: "json")!)

    var body: some Scene {
        WindowGroup { RootView(config: config) }
    }
}
