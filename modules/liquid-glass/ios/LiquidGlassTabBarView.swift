import ExpoModulesCore
import SwiftUI

class LiquidGlassTabBarView: ExpoView {
  let onTabPress = EventDispatcher()

  private let state = TabBarState()
  private var hostingController: UIHostingController<AnyView>?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    setupHostingController()
  }

  private func setupHostingController() {
    let content = LiquidGlassTabBarContent(
      state: state,
      onTabPress: { [weak self] index in
        self?.onTabPress(["index": index])
      }
    )
    let vc = UIHostingController(rootView: AnyView(content))
    vc.view.backgroundColor = .clear
    vc.view.clipsToBounds = false

    hostingController = vc
    addSubview(vc.view)

    vc.view.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      vc.view.topAnchor.constraint(equalTo: topAnchor),
      vc.view.bottomAnchor.constraint(equalTo: bottomAnchor),
      vc.view.leadingAnchor.constraint(equalTo: leadingAnchor),
      vc.view.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])

    backgroundColor = .clear
    clipsToBounds = false
  }

  // Called when we're inserted into a window; embed the hosting controller
  // into the nearest VC so SwiftUI gets the UIWindowScene connection that
  // glassEffect() needs for its rendering context.
  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard let vc = hostingController, vc.parent == nil,
          let parentVC = nearestViewController() else { return }
    parentVC.addChild(vc)
    vc.didMove(toParent: parentVC)
  }

  private func nearestViewController() -> UIViewController? {
    var responder: UIResponder? = next
    while let r = responder {
      if let vc = r as? UIViewController { return vc }
      responder = r.next
    }
    return nil
  }

  func updateTabs(_ rawTabs: [[String: Any]]) {
    state.tabs = rawTabs.enumerated().compactMap { (i, dict) in
      guard let sfSymbol = dict["sfSymbol"] as? String,
            let label = dict["label"] as? String else { return nil }
      return TabConfig(id: i, sfSymbol: sfSymbol, label: label)
    }
  }

  func updateSelectedIndex(_ index: Int) {
    state.selectedIndex = index
  }
}
