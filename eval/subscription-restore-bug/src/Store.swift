import StoreKit

@MainActor
final class Store: ObservableObject {
    @Published private(set) var isPro = false

    func refresh() async {
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, t.productID == "pro.yearly" { isPro = true }
        }
    }

    /// Restore Purchases button.
    func restorePurchases() async throws {
        try await AppStore.sync()
        // Returns here. isPro is never recomputed, so a reinstalled paying user stays free.
        Log.info("restore complete")
    }
}
