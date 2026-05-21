import ExpoModulesCore
import PDFKit
import Foundation

public class ExpoPdfTextModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoPdfText")

    AsyncFunction("extractText") { (uri: String) -> String in
      let url = Self.resolveURL(uri)
      guard let document = PDFDocument(url: url) else {
        throw Exception(name: "PdfReadError", description: "Could not open PDF at \(uri)")
      }
      var pages: [String] = []
      for index in 0..<document.pageCount {
        if let page = document.page(at: index), let text = page.string {
          pages.append(text)
        }
      }
      return pages.joined(separator: "\n\n")
    }

    // Returns per-line geometric text data so callers (the school-menu
    // parser, primarily) can reconstruct a column-oriented table when the
    // PDF's reading order flattens cells across rows. Each entry is one
    // selection-by-line from PDFKit with its bounding rect on the page.
    AsyncFunction("extractTextLines") { (uri: String) -> [[String: Any]] in
      let url = Self.resolveURL(uri)
      guard let document = PDFDocument(url: url) else {
        throw Exception(name: "PdfReadError", description: "Could not open PDF at \(uri)")
      }
      var out: [[String: Any]] = []
      for index in 0..<document.pageCount {
        guard let page = document.page(at: index) else { continue }
        let pageBounds = page.bounds(for: .mediaBox)
        guard let allSelection = page.selection(for: pageBounds) else { continue }
        for sel in allSelection.selectionsByLine() {
          let rect = sel.bounds(for: page)
          let text = sel.string ?? ""
          if text.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines).isEmpty { continue }
          out.append([
            "page": index,
            "text": text,
            "x": Double(rect.minX),
            "y": Double(rect.maxY),
            "w": Double(rect.width),
            "h": Double(rect.height)
          ])
        }
      }
      return out
    }
  }

  private static func resolveURL(_ uri: String) -> URL {
    if let parsed = URL(string: uri), parsed.scheme != nil {
      return parsed
    }
    return URL(fileURLWithPath: uri)
  }
}
