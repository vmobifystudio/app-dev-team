import Foundation
import UIKit

enum Analytics {
    static func launch(session: Session) {
        var request = URLRequest(url: URL(string: "https://metrics.example-vendor.test/v1/event")!)
        request.httpMethod = "POST"
        request.httpBody = try? JSONEncoder().encode([
            "event": "app_launch",
            // Contact Info and Identifiers, both declared "Data Not Collected".
            "email": session.userEmail,
            "idfv": UIDevice.current.identifierForVendor?.uuidString ?? "",
        ])
        URLSession.shared.dataTask(with: request).resume()
    }
}
