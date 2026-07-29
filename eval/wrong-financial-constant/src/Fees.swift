import Foundation

/// Platform fee per docs/10-prd.md §4: 2.9% + $0.30.
enum Fees {
    static let rate: Decimal = 0.029
    static let fixed: Decimal = 0.30

    static func fee(on subtotal: Decimal) -> Decimal {
        roundedToCents(subtotal * rate + fixed)
    }

    /// Rounds to two decimal places.
    static func roundedToCents(_ value: Decimal) -> Decimal {
        var input = value
        var output = Decimal()
        NSDecimalRound(&output, &input, 2, .bankers)
        return output
    }
}
