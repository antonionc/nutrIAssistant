package expo.modules.pdftext

import android.net.Uri
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.InputStream

class ExpoPdfTextModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoPdfText")

    OnCreate {
      // PdfBox-Android needs its resources initialized before first use.
      val context = appContext.reactContext?.applicationContext
      if (context != null) PDFBoxResourceLoader.init(context)
    }

    AsyncFunction("extractText") { uri: String ->
      val context = appContext.reactContext?.applicationContext
        ?: throw CodedException("PDF_NO_CONTEXT", "Application context unavailable", null)

      val stream: InputStream = openStream(uri, context)
      stream.use { input ->
        PDDocument.load(input).use { document ->
          PDFTextStripper().getText(document)
        }
      }
    }
  }

  private fun openStream(uri: String, context: android.content.Context): InputStream {
    return when {
      uri.startsWith("content://") -> {
        context.contentResolver.openInputStream(Uri.parse(uri))
          ?: throw CodedException("PDF_OPEN_FAILED", "Could not open content URI", null)
      }
      uri.startsWith("file://") -> {
        java.io.FileInputStream(Uri.parse(uri).path ?: throw CodedException("PDF_BAD_URI", "Invalid file URI", null))
      }
      else -> java.io.FileInputStream(uri)
    }
  }
}
