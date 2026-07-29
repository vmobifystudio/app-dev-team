import SwiftUI

struct PaywallView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack {
            HStack {
                Spacer()
                Button(action: { dismiss() }) {
                    Image(systemName: "xmark")
                        .frame(width: 28, height: 28)
                }
            }
            Text("Go Pro").font(.largeTitle)
        }
    }
}
