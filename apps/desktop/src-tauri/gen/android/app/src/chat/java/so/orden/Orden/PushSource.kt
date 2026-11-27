package so.orden.Orden

import android.content.Context
import android.util.Log
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

object PushSource {
  fun start(context: Context) {
    val app = context.applicationContext
    val set =
      listOf(
        BuildConfig.ORDEN_FIREBASE_APP_ID,
        BuildConfig.ORDEN_FIREBASE_API_KEY,
        BuildConfig.ORDEN_FIREBASE_PROJECT_ID,
        BuildConfig.ORDEN_FIREBASE_SENDER_ID,
      )
    if (set.any { it.isEmpty() }) return
    try {
      if (FirebaseApp.getApps(app).isEmpty()) {
        FirebaseApp.initializeApp(
          app,
          FirebaseOptions.Builder()
            .setApplicationId(BuildConfig.ORDEN_FIREBASE_APP_ID)
            .setApiKey(BuildConfig.ORDEN_FIREBASE_API_KEY)
            .setProjectId(BuildConfig.ORDEN_FIREBASE_PROJECT_ID)
            .setGcmSenderId(BuildConfig.ORDEN_FIREBASE_SENDER_ID)
            .build(),
        )
      }
      FirebaseMessaging.getInstance().token.addOnCompleteListener { asked ->
        if (asked.isSuccessful) asked.result?.let { ChatNotes.tokenIs(app, it) }
      }
    } catch (error: Exception) {
      Log.w("orden", "push could not start: ${error.message}")
    }
  }
}

class ChatMessages : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    ChatNotes.show(this, message.data)
  }

  override fun onNewToken(token: String) {
    ChatNotes.tokenIs(this, token)
  }
}
