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
  }

  private static func resolveURL(_ uri: String) -> URL {
    if let parsed = URL(string: uri), parsed.scheme != nil {
      return parsed
    }
    return URL(fileURLWithPath: uri)
  }
}
