import SwiftUI

// SwiftUI body of the iOS-26 Liquid Glass tab bar. Outer pill is a
// .regular UIGlassEffect capsule (refractive, mildly frosted); the
// active tab carries an inner glass-on-glass capsule with a neutral
// grey tint. Icon and label use `Color.primary` so they adapt to the
// host's user-interface style — light mode renders them near-black,
// dark mode near-white. Hosted by LiquidGlassTabBarView via a
// UIHostingController whose overrideUserInterfaceStyle is set from the
// React-side theme.
struct LiquidGlassTabBarContent: View {
  @ObservedObject var state: TabBarState
  let onTabPress: (Int) -> Void

  @Environment(\.colorScheme) private var colorScheme

  // Active-tab chip tint, slightly heavier in light mode for visibility
  // against the lighter glass material.
  private var activeChipTint: Color {
    colorScheme == .dark ? Color.gray.opacity(0.35) : Color.gray.opacity(0.55)
  }

  var body: some View {
    HStack(spacing: 4) {
      ForEach(0..<state.tabs.count, id: \.self) { i in
        tabButton(for: state.tabs[i], at: i)
      }
    }
    .padding(4)
    .glassEffect(.regular, in: .capsule)
    .padding(.horizontal, 16)
  }

  @ViewBuilder
  private func tabButton(for tab: TabConfig, at index: Int) -> some View {
    let isActive = state.selectedIndex == index
    Button {
      onTabPress(index)
    } label: {
      VStack(spacing: 4) {
        Image(systemName: tab.sfSymbol)
          .font(.system(size: 22, weight: .semibold))
          .symbolVariant(isActive ? .fill : .none)
          .foregroundStyle(.primary)
        Text(tab.label)
          .font(.system(size: 11, weight: isActive ? .semibold : .medium))
          .foregroundStyle(Color.primary.opacity(isActive ? 1.0 : 0.85))
      }
      .frame(maxWidth: .infinity)
      .padding(4)
      .background {
        if isActive {
          Color.clear.glassEffect(.regular.tint(activeChipTint), in: .capsule)
        }
      }
    }
    .buttonStyle(.plain)
  }
}
