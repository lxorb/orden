package ch.emilvinu.nib

import android.Manifest
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.hardware.biometrics.BiometricManager
import android.hardware.biometrics.BiometricPrompt
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
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
import java.security.MessageDigest
import java.util.UUID
import org.json.JSONObject

class MainActivity : TauriActivity() {
  companion object {
    const val EXTRA_COMMAND = "ch.emilvinu.nib.command"

    const val EXTRA_OPEN = "ch.emilvinu.nib.open"

    const val EXTRA_TICK = "ch.emilvinu.nib.tick"
    const val EXTRA_TICK_SPACE = "ch.emilvinu.nib.tick.space"

    private const val EXTRA_READ = "ch.emilvinu.nib.read"

    private const val EXTRA_SEAL = "ch.emilvinu.nib.seal"
    private const val SEALS = "nib-seal"

    @Synchronized
    private fun seal(context: Context): String {
      val prefs = context.getSharedPreferences(SEALS, Context.MODE_PRIVATE)
      prefs.getString(SEALS, null)?.let { return it }
      val made = UUID.randomUUID().toString()
      prefs.edit().putString(SEALS, made).commit()
      return made
    }

    fun sealed(context: Context, intent: Intent): Intent =
      intent.putExtra(EXTRA_SEAL, seal(context))

    private fun sealedBy(context: Context, intent: Intent): Boolean {
      val said = intent.getStringExtra(EXTRA_SEAL) ?: return false
      return MessageDigest.isEqual(said.toByteArray(), seal(context).toByteArray())
    }

    private const val MICROPHONE = 0x6d69

    @Volatile private var live: java.lang.ref.WeakReference<MainActivity>? = null

    fun reminded() {
      live?.get()?.tell("window.__nibReminders?.()")
    }
  }

  override val handleBackNavigation = true

  @Volatile private var edges = "{\"top\":0,\"right\":0,\"bottom\":0,\"left\":0}"

  @Volatile private var command = ""
  @Volatile private var opening = ""
  @Volatile private var ticking = ""
  @Volatile private var tickingIn = ""

  private var page: WebView? = null

  private val frame: String = UUID.randomUUID().toString()

  private val dictation by lazy { Dictation(this) }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)
    live = java.lang.ref.WeakReference(this)

    val fresh = savedInstanceState == null &&
      ((intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0
    if (fresh) read(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (read(intent)) tell("window.__nibHanded?.()")
  }

  override fun onDestroy() {
    if (live?.get() === this) live = null
    super.onDestroy()
  }

  private fun read(intent: Intent?): Boolean {
    if (intent == null || intent.getBooleanExtra(EXTRA_READ, false)) return false
    intent.putExtra(EXTRA_READ, true)

    val ours = sealedBy(this, intent)
    val asked = if (ours) intent.getStringExtra(EXTRA_COMMAND) ?: "" else ""
    val note = if (ours) intent.getStringExtra(EXTRA_OPEN) ?: "" else ""
    val tick = if (ours) intent.getStringExtra(EXTRA_TICK) ?: "" else ""
    if (asked.isNotEmpty()) command = asked
    if (note.isNotEmpty()) opening = note
    if (tick.isNotEmpty()) {
      ticking = tick
      tickingIn = intent.getStringExtra(EXTRA_TICK_SPACE) ?: ""
    }

    if (ours) {
      Reminders.carried(intent)?.let {
        Reminders.pressed(this, "open", it)
        reminded()
      }
    }

    val shared = Shared.take(this, intent)
    return shared || asked.isNotEmpty() || note.isNotEmpty() || tick.isNotEmpty()
  }

  override fun onWebViewCreate(webView: WebView) {
    page = webView
    webView.addJavascriptInterface(Bridge(), "__ORDEN_SYSTEM__")

    ViewCompat.setOnApplyWindowInsetsListener(webView) { _: View, insets: WindowInsetsCompat ->
      val keys = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      webView.setPadding(0, 0, 0, keys)

      val bars =
        insets.getInsets(
          WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
        )
      val density = webView.resources.displayMetrics.density
      fun css(pixels: Int) = (pixels / density).toInt()

      edges =
        "{\"top\":${css(bars.top)},\"right\":${css(bars.right)}," +
          "\"bottom\":${css(maxOf(0, bars.bottom - keys))},\"left\":${css(bars.left)}}"
      webView.evaluateJavascript("window.__nibInsets?.()", null)
      insets
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      webView.isAutoHandwritingEnabled = false
    }
  }

  private val secrets: SharedPreferences by lazy {
    EncryptedSharedPreferences.create(
      this,
      "nib-secrets",
      MasterKey.Builder(this).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
  }

  private fun tell(script: String) {
    val webView = page ?: return
    webView.post { webView.evaluateJavascript(script, null) }
  }

  fun heard(json: String) {
    tell("window.__nibHeard?.(${JSONObject.quote(json)})")
  }

  private fun ownerAsks(): Boolean =
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
      getSystemService(KeyguardManager::class.java)?.isDeviceSecure == true

  private fun owned(yes: Boolean) {
    tell("window.__nibOwner?.('${if (yes) "yes" else "no"}')")
  }

  @Suppress("DEPRECATION")
  private fun askOwner(reason: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !ownerAsks()) return owned(false)
    val prompt = BiometricPrompt.Builder(this).setTitle(reason)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      prompt.setAllowedAuthenticators(
        BiometricManager.Authenticators.BIOMETRIC_WEAK or
          BiometricManager.Authenticators.DEVICE_CREDENTIAL
      )
    } else {
      prompt.setDeviceCredentialAllowed(true)
    }
    prompt
      .build()
      .authenticate(
        CancellationSignal(),
        mainExecutor,
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            owned(true)
          }

          override fun onAuthenticationError(code: Int, message: CharSequence) {
            owned(false)
          }
        },
      )
  }

  fun askForTheMicrophone() {
    runOnUiThread { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), MICROPHONE) }
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode != MICROPHONE) return

    val granted =
      grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
    dictation.allowedNow(granted)
  }

  private inner class Bridge {
    @JavascriptInterface fun insets(): String = edges

    @JavascriptInterface
    fun askForTheFrame() {
      tell("window.__nibFrame?.(${JSONObject.quote(frame)})")
    }

    @JavascriptInterface
    fun secretRead(said: String, name: String): String? =
      if (said == frame) secrets.getString(name, null) else null

    @JavascriptInterface
    fun secretWrite(said: String, name: String, secret: String) {
      if (said != frame) return
      secrets.edit().putString(name, secret).apply()
    }

    @JavascriptInterface
    fun secretForget(said: String, name: String) {
      if (said != frame) return
      secrets.edit().remove(name).apply()
    }

    @JavascriptInterface
    fun bars(dark: Boolean) {
      val window = this@MainActivity.window
      window.decorView.post {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
      }
    }

    @JavascriptInterface
    fun handed(said: String): String {
      if (said != frame) return ""
      val json = JSONObject()
      json.put("command", command)
      json.put("open", opening)
      json.put("tick", ticking)
      json.put("tickSpace", tickingIn)
      command = ""
      opening = ""
      ticking = ""
      tickingIn = ""
      return json.toString()
    }

    @JavascriptInterface
    fun shared(said: String): String =
      if (said == frame && Shared.waiting) Shared.json() else ""

    @JavascriptInterface
    fun sharedBytes(said: String, at: Int, offset: Int, length: Int): String =
      if (said == frame) Shared.bytes(at, offset, length) else ""

    @JavascriptInterface
    fun sharedDone(said: String) {
      if (said == frame) Shared.clear(this@MainActivity)
    }

    @JavascriptInterface
    fun widgets(said: String, json: String) {
      if (said == frame) WidgetNotes.write(this@MainActivity, json)
    }

    @JavascriptInterface fun dictates(): Boolean = dictation.available()

    @JavascriptInterface
    fun listen(said: String, on: Boolean): Boolean = said == frame && dictation.listen(on)

    @JavascriptInterface
    fun reminders(said: String, json: String) {
      if (said == frame) Reminders.set(this@MainActivity, json)
    }

    @JavascriptInterface
    fun remindersTaken(said: String): String =
      if (said == frame) Reminders.taken(this@MainActivity) else "[]"

    @JavascriptInterface
    fun ownerCan(said: String): Boolean = said == frame && ownerAsks()

    @JavascriptInterface
    fun ownerCheck(said: String, reason: String) {
      if (said == frame) runOnUiThread { askOwner(reason.take(200)) } else owned(false)
    }

    @JavascriptInterface fun exactAlarms(): Boolean = Reminders.exact(this@MainActivity)

    @JavascriptInterface
    fun askExactAlarms() {
      Reminders.openExactSwitch(this@MainActivity)
    }
  }
}
