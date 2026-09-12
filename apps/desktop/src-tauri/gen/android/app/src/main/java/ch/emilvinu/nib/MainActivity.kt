package ch.emilvinu.nib

import android.content.SharedPreferences
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class MainActivity : TauriActivity() {
  // Back closes whatever is over the note rather than the app. Every layer the
  // page opens takes a history entry of its own (see backstack.svelte.ts), so a
  // back press the webview can answer is one it should: WryActivity does exactly
  // that when this is on, and finishes the activity once nothing is left to
  // close. Tauri turns it off by default.
  override val handleBackNavigation = true

  // What the system bars leave for the page, in CSS pixels, as the page reads
  // it. Written on the UI thread by the inset listener and read on the
  // webview's own thread through the bridge, so it is published between them.
  @Volatile private var edges = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0}"

  override fun onCreate(savedInstanceState: Bundle?) {
    // Android 15 draws every app under the system bars whether it asks or not,
    // so Nib asks, and paints those areas itself: transparent bars over the
    // page's own background, with the page's chrome padded by the insets. A
    // scrim behind the clock would be a band of somebody else's colour across
    // the top of a themed app.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(Bridge(), "__NIB_SYSTEM__")

    // Two different edges, handled two different ways.
    //
    // The keyboard pads the webview: nothing shortens the window when the page
    // is drawn edge to edge, so the line being written can end up behind the
    // keys. Padding the view ends the page where the keys begin instead, which
    // the layout and the visual viewport both read; see viewport.svelte.ts.
    // Below Android 11 there is no keyboard inset to read and the manifest's
    // adjustResize shortens the window itself, leaving this at zero.
    //
    // The system bars do not pad it. Padding there would letterbox the app in
    // whatever colour the window happens to be, and the drawer, the scrim and
    // the sheets would stop short of the edge - which is exactly what a native
    // app does not look like. They are handed to the page as numbers instead,
    // so it draws the whole screen and each bar of its own clears them; see
    // insets.ts and the --inset-* tokens.
    // The listener is on the webview, so the webview itself is what every line
    // below speaks to: only a View arrives in the callback, and running a
    // script is a WebView's own trick and not a View's.
    ViewCompat.setOnApplyWindowInsetsListener(webView) { _: View, insets: WindowInsetsCompat ->
      val keys = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      webView.setPadding(0, 0, 0, keys)

      val bars =
        insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
      val density = webView.resources.displayMetrics.density
      fun css(pixels: Int) = (pixels / density).toInt()

      // The gesture bar sits behind the keyboard while it is up, and the page
      // already ends above the keys, so its inset has been paid for once.
      edges =
        "{\"top\":${css(bars.top)},\"right\":${css(bars.right)}," +
          "\"bottom\":${css(maxOf(0, bars.bottom - keys))},\"left\":${css(bars.left)}}"
      webView.evaluateJavascript("window.__nibInsets?.()", null)
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

  /** Where an AI provider's key lives on a phone.
   *
   *  `EncryptedSharedPreferences` is Android's own answer to the keychain a desktop
   *  has: the file is encrypted with a key held in the hardware-backed Keystore,
   *  which never leaves the device and which no other app can reach. Built lazily
   *  and kept, because building it derives the master key, and somebody who never
   *  sets a key up should not pay for that on the way in.
   *
   *  See secrets.rs for the desktop's side of the same three calls, and keys.ts in
   *  the app, which is what chooses between them. */
  private val secrets: SharedPreferences by lazy {
    EncryptedSharedPreferences.create(
      this,
      "nib-secrets",
      MasterKey.Builder(this).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  /** The two things the page cannot see for itself; see insets.ts. */
  private inner class Bridge {
    @JavascriptInterface fun insets(): String = edges

    /** The key kept under `name`, or null where there is none. */
    @JavascriptInterface fun secretRead(name: String): String? = secrets.getString(name, null)

    /** Writes one, replacing whatever was there. */
    @JavascriptInterface
    fun secretWrite(name: String, secret: String) {
      secrets.edit().putString(name, secret).apply()
    }

    /** Takes one away. */
    @JavascriptInterface
    fun secretForget(name: String) {
      secrets.edit().remove(name).apply()
    }

    /** The clock, the battery and the gesture bar are the system's own icons
     *  drawn over our page: light on a dark theme, dark on a light one. Called
     *  on the webview's thread, so the window is touched on the UI one. */
    @JavascriptInterface
    fun bars(dark: Boolean) {
      val window = this@MainActivity.window
      window.decorView.post {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
      }
    }
  }
}
