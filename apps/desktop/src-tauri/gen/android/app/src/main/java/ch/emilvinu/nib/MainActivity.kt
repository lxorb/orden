package ch.emilvinu.nib

import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  // Back closes whatever is over the note rather than the app. Every layer the
  // page opens takes a history entry of its own (see backstack.svelte.ts), so a
  // back press the webview can answer is one it should: WryActivity does exactly
  // that when this is on, and finishes the activity once nothing is left to
  // close. Tauri turns it off by default.
  override val handleBackNavigation = true

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // The window draws under the system bars, so nothing shortens it when the
  // keyboard opens and the line being written can end up behind the keys.
  // Padding the webview by the keyboard's height ends the page where the keys
  // begin instead, which the layout and the visual viewport both read; see
  // viewport.svelte.ts. Below Android 11 there is no keyboard inset to read and
  // the manifest's adjustResize shortens the window itself, which leaves this
  // padding at zero.
  override fun onWebViewCreate(webView: WebView) {
    ViewCompat.setOnApplyWindowInsetsListener(webView) { view: View, insets: WindowInsetsCompat ->
      view.setPadding(0, 0, 0, insets.getInsets(WindowInsetsCompat.Type.ime()).bottom)
      insets
    }

    // The pen writes on the canvas rather than into a handwriting recogniser.
    //
    // Android turns stylus handwriting on for every text field by default from
    // 14, and Samsung's Direct Writing does the same from Android 11 on its own
    // devices. Both watch for a stylus over an editable area and then swallow
    // the touch stream to convert it to text - which over a note being written
    // in, or over a canvas card, means the pen never reaches the page at all.
    // Nib draws with the pen itself, so the recogniser is turned off here and
    // every stylus event arrives as a pointer event; see canvas/ink.ts.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      webView.isAutoHandwritingEnabled = false
    }
  }
}
