import Foundation

enum Fees {
    /// Half-up to the cent, per docs/10-prd.md.
    static func roundedToCents(_ value: Decimal) -> Decimal {
        var input = value
        var output = Decimal()
        NSDecimalRound(&output, &input, 2, .plain)
        return output
    }
}
