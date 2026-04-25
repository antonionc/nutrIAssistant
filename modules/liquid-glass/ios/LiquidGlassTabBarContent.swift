import SwiftUI

private extension Color {
  init(hex: String) {
    let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    var int: UInt64 = 0
    Scanner(string: hex).scanHexInt64(&int)
    let r, g, b: UInt64
    switch hex.count {
    case 6:
      (r, g, b) = (int >> 16, int >> 8 & 0xFF, int & 0xFF)
    default:
      (r, g, b) = (0, 0, 0)
    }
    self.init(.sRGB,
              red: Double(r) / 255,
              green: Double(g) / 255,
              blue: Double(b) / 255)
  }
}

struct LiquidGlassTabBarContent: View {
  @ObservedObject var state: TabBarState
  let onTabPress: (Int) -> Void

  private let activeColor = Color(hex: "0F6E56")
  private let inactiveColor = Color(hex: "2C2C2A")

  var body: some View {
    HStack(spacing: 0) {
      ForEach(0..<min(2, state.tabs.count), id: \.self) { i in
        tabButton(for: state.tabs[i], at: i)
      }

      Color.clear.frame(width: 80)

      ForEach(min(2, state.tabs.count)..<min(4, state.tabs.count), id: \.self) { i in
        tabButton(for: state.tabs[i], at: i)
      }
    }
    .frame(height: 56)
    .background(.ultraThinMaterial)
    .glassEffect()
  }

  @ViewBuilder
  private func tabButton(for tab: TabConfig, at index: Int) -> some View {
    let isActive = state.selectedIndex == index
    Button {
      onTabPress(index)
    } label: {
      VStack(spacing: 2) {
        Image(systemName: tab.sfSymbol)
          .font(.system(size: 22, weight: .medium))
          .symbolVariant(isActive ? .fill : .none)
          .foregroundStyle(isActive ? activeColor : inactiveColor.opacity(0.45))
        Text(tab.label)
          .font(.system(size: 10, weight: isActive ? .medium : .regular))
          .foregroundStyle(isActive ? activeColor : inactiveColor.opacity(0.45))
      }
      .frame(maxWidth: .infinity)
      .frame(height: 56)
    }
    .buttonStyle(.plain)
  }
}
