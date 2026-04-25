import SwiftUI

struct TabConfig: Identifiable {
  let id: Int
  let sfSymbol: String
  let label: String
}

class TabBarState: ObservableObject {
  @Published var tabs: [TabConfig] = []
  @Published var selectedIndex: Int = 0
}
