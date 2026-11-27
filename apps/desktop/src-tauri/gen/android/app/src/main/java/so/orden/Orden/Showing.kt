package so.orden.Orden

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationManagerCompat

object Showing {
  private const val STORE = "orden.showing"
  private const val ASKED = "asked"
  private const val CODE = 0x7368

  fun allowed(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED

  fun askOnce(activity: Activity) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || allowed(activity)) return
    val prefs = activity.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    if (prefs.getBoolean(ASKED, false)) return
    prefs.edit().putBoolean(ASKED, true).apply()
    activity.runOnUiThread {
      activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), CODE)
    }
  }

  fun channel(context: Context, id: String, name: String, importance: Int) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(id) != null) return
    manager.createNotificationChannel(NotificationChannel(id, name, importance))
  }

  fun show(context: Context, tag: String, id: Int, notification: Notification): Boolean {
    if (!allowed(context)) return false
    return try {
      NotificationManagerCompat.from(context).notify(tag, id, notification)
      true
    } catch (error: SecurityException) {
      Log.w("orden", "a notification could not be shown: ${error.message}")
      false
    }
  }
}
