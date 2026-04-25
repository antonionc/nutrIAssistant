import ExpoModulesCore

public class LiquidGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiquidGlass")

    View(LiquidGlassTabBarView.self) {
      Prop("tabs") { (view: LiquidGlassTabBarView, tabs: [[String: Any]]) in
        view.updateTabs(tabs)
      }

      Prop("selectedIndex") { (view: LiquidGlassTabBarView, index: Int) in
        view.updateSelectedIndex(index)
      }

      Events("onTabPress")
    }
  }
}
