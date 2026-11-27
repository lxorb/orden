package so.orden.Orden

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import java.util.Calendar
import org.json.JSONArray
import org.json.JSONObject

object ChatNotes {
  private const val STORE = "orden.chat.push"
  private const val QUIET = "quiet"
  private const val TOKEN = "token"
  private const val TAKEN = "taken"
  private const val LINES = "lines:"

  const val CHANNEL = "messages"
  const val ACTION_READ = "so.orden.Orden.chat.READ"
  const val EXTRA_CHAT = "so.orden.Orden.chat"
  const val EXTRA_MESSAGE = "so.orden.Orden.chat.message"
  const val EXTRA_SEQ = "so.orden.Orden.chat.seq"
  const val REPLY = "so.orden.Orden.chat.reply"
  const val HEARD = "window.__ordenPushToken?.()"

  private const val TAG = "orden.chat"
  private const val SPACES = "orden.chat.space"

  private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

  fun token(context: Context): String = prefs(context).getString(TOKEN, "") ?: ""

  fun tokenIs(context: Context, token: String) {
    if (token == token(context)) return
    prefs(context).edit().putString(TOKEN, token).apply()
    MainActivity.told(HEARD)
  }

  fun quiet(context: Context, json: String) {
    if (ChatPushes.quietOf(json) == null) return
    prefs(context).edit().putString(QUIET, json).apply()
  }

  private fun quiet(context: Context): PushQuiet =
    ChatPushes.quietOf(prefs(context).getString(QUIET, "") ?: "") ?: ChatPushes.LOUD

  @Synchronized
  fun taken(context: Context): String {
    val prefs = prefs(context)
    val held = prefs.getString(TAKEN, "[]") ?: "[]"
    prefs.edit().remove(TAKEN).apply()
    return held
  }

  @Synchronized
  fun read(context: Context, chat: String, message: String, seq: Long) {
    val prefs = prefs(context)
    val held = prefs.getString(TAKEN, "[]") ?: "[]"
    prefs.edit().putString(TAKEN, ChatPushes.taken(held, chat, message, seq)).apply()
    clear(context, chat)
  }

  fun clear(context: Context, chat: String) {
    if (chat.isEmpty()) return
    prefs(context).edit().remove(LINES + chat).apply()
    val shown = NotificationManagerCompat.from(context)
    shown.cancel(TAG, ChatPushes.noteId(chat))
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    val left = manager.activeNotifications.filter { it.tag == TAG && it.id != ChatPushes.noteId(chat) }
    for (one in manager.activeNotifications.filter { it.tag == SPACES }) {
      if (left.none { it.notification.group == one.notification.group }) shown.cancel(SPACES, one.id)
    }
  }

  fun show(context: Context, data: Map<String, String>) {
    val push = ChatPushes.of(data) ?: return
    val quiet = quiet(context)
    val now = Calendar.getInstance()
    val day = now.get(Calendar.DAY_OF_WEEK) - 1
    val minute = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
    if (!ChatPushes.shows(quiet, now.timeInMillis, day, minute)) return

    val words =
      ChatPushes.words(
        push,
        quiet.previews,
        context.getString(R.string.chat_new_message),
        context.getString(R.string.chat_attachment),
      )
    val lines = ChatPushes.kept(lines(context, push.chat), PushLine(push.id, push.title, words, push.at))
    prefs(context).edit().putString(LINES + push.chat, toJson(lines)).apply()

    Showing.channel(
      context,
      CHANNEL,
      context.getString(R.string.chat_channel),
      NotificationManager.IMPORTANCE_HIGH,
    )
    val id = ChatPushes.noteId(push.chat)
    val link = ChatPushes.link(push.chat, push.message)
    val style = NotificationCompat.MessagingStyle(Person.Builder().setName(context.getString(R.string.chat_you)).build())
    for (one in lines) {
      style.addMessage(one.words, one.at, Person.Builder().setName(one.title).build())
    }
    val hidden =
      NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_chat)
        .setContentTitle(context.getString(R.string.chat_new_message))
        .build()
    val answer =
      NotificationCompat.Action.Builder(0, context.getString(R.string.chat_reply), opens(context, link, id, true))
        .addRemoteInput(RemoteInput.Builder(REPLY).setLabel(context.getString(R.string.chat_reply)).build())
        .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
        .build()
    val seen =
      PendingIntent.getBroadcast(
        context,
        id,
        Intent(context, ChatActionReceiver::class.java)
          .setAction(ACTION_READ)
          .setData(Uri.parse("orden-chat-read://${push.chat}"))
          .putExtra(EXTRA_CHAT, push.chat)
          .putExtra(EXTRA_MESSAGE, push.message)
          .putExtra(EXTRA_SEQ, push.seq),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    val notification =
      NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_chat)
        .setStyle(style)
        .setWhen(push.at)
        .setCategory(NotificationCompat.CATEGORY_MESSAGE)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPublicVersion(hidden)
        .setSilent(!quiet.sound)
        .setAutoCancel(true)
        .setGroup(push.space)
        .setContentIntent(opens(context, link, id, false))
        .addAction(answer)
        .addAction(0, context.getString(R.string.chat_mark_read), seen)
        .build()
    if (!Showing.show(context, TAG, id, notification)) return
    val summary =
      NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_chat)
        .setStyle(NotificationCompat.InboxStyle())
        .setGroup(push.space)
        .setGroupSummary(true)
        .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setAutoCancel(true)
        .build()
    Showing.show(context, SPACES, push.space.hashCode(), summary)
  }

  private fun opens(context: Context, link: String, code: Int, answers: Boolean): PendingIntent {
    val intent =
      MainActivity.sealed(context, Intent(context, MainActivity::class.java))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .setData(Uri.parse("orden-chat-open://$code/${if (answers) "reply" else "open"}"))
        .putExtra(MainActivity.EXTRA_LINK, link)
    val changing =
      if (answers && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        PendingIntent.FLAG_MUTABLE
      } else if (answers) {
        0
      } else {
        PendingIntent.FLAG_IMMUTABLE
      }
    return PendingIntent.getActivity(context, code, intent, PendingIntent.FLAG_UPDATE_CURRENT or changing)
  }

  fun replied(intent: Intent): String =
    RemoteInput.getResultsFromIntent(intent)?.getCharSequence(REPLY)?.toString() ?: ""

  private fun lines(context: Context, chat: String): List<PushLine> {
    val held =
      try {
        JSONArray(prefs(context).getString(LINES + chat, "[]") ?: "[]")
      } catch (error: Exception) {
        JSONArray()
      }
    val lines = mutableListOf<PushLine>()
    for (at in 0 until held.length()) {
      val one = held.optJSONObject(at) ?: continue
      lines.add(PushLine(one.optString("id"), one.optString("title"), one.optString("words"), one.optLong("at")))
    }
    return lines
  }

  private fun toJson(lines: List<PushLine>): String {
    val json = JSONArray()
    for (one in lines) {
      json.put(JSONObject().put("id", one.id).put("title", one.title).put("words", one.words).put("at", one.at))
    }
    return json.toString()
  }
}

class ChatActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ChatNotes.ACTION_READ) return
    val chat = intent.getStringExtra(ChatNotes.EXTRA_CHAT) ?: return
    val message = intent.getStringExtra(ChatNotes.EXTRA_MESSAGE) ?: return
    ChatNotes.read(context, chat, message, intent.getLongExtra(ChatNotes.EXTRA_SEQ, 0L))
  }
}
