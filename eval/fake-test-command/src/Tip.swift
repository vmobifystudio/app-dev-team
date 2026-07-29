import Foundation

enum Tip {
    static func perPerson(total: Decimal, people: Int) -> Decimal {
        guard people > 0 else { return 0 }
        return total / Decimal(people)
    }
}
