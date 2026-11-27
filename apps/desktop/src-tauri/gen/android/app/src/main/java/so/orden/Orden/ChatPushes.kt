package so.orden.Orden

import org.json.JSONArray
import org.json.JSONObject

data class ChatPush(
  val id: String,
  val title: String,
  val body: String,
  val chat: String,
  val space: String,
  val message: String,
  val seq: Long,
  val at: Long,
  val from: String,
  val reason: String,
  val text: Boolean,
)

data class PushHours(val days: Set<Int>, val from: Int, val to: Int)

data class PushQuiet(
  val hours: PushHours?,
  val dndUntil: Long?,
  val previews: Boolean,
  val sound: Boolean,
)

data class PushLine(val id: String, val title: String, val words: String, val at: Long)

object ChatPushes {
  const val MOST = 8
  const val MOST_TAKEN = 64

  val LOUD = PushQuiet(null, null, previews = true, sound = true)

  private val CHAT = Regex("^c_[0-9a-f]{32}$")
  private val MESSAGE = Regex("^[0-9A-Za-z_-]{1,64}$")
  private val WHOLE = Regex("^\\d{1,16}$")
  private val WHO = Regex("^(user|guest|program):[0-9A-Za-z_-]{1,64}$")
  private val REASONS = setOf("mention", "reply", "direct", "all")
  private const val DAY_MINUTES = 1440

  fun of(data: Map<String, String>): ChatPush? {
    if (data["kind"] != "chat" || data["v"] != "1") return null
    val id = data["id"] ?: return null
    val title = data["title"] ?: return null
    val body = data["body"] ?: return null
    val chat = data["chat"]?.takeIf { CHAT.matches(it) } ?: return null
    val space = data["space"]?.takeIf { it.isNotEmpty() } ?: return null
    val message = data["message"]?.takeIf { MESSAGE.matches(it) } ?: return null
    val seq = data["seq"]?.takeIf { WHOLE.matches(it) } ?: return null
    val at = data["at"]?.takeIf { WHOLE.matches(it) } ?: return null
    val from = data["from"]?.takeIf { WHO.matches(it) } ?: return null
    val reason = data["reason"]?.takeIf { it in REASONS } ?: return null
    val text = data["text"]?.takeIf { it == "yes" || it == "no" } ?: return null
    return ChatPush(
      id, title, body, chat, space, message, seq.toLong(), at.toLong(), from, reason, text == "yes",
    )
  }

  fun link(chat: String, message: String): String = "orden-chat://chat/$chat?message=$message"

  fun chatOf(link: String): String =
    link.removePrefix("orden-chat://chat/").substringBefore('?').takeIf { CHAT.matches(it) } ?: ""

  fun quietOf(json: String): PushQuiet? {
    val read =
      try {
        JSONObject(json)
      } catch (error: Exception) {
        return null
      }
    for (key in listOf("hours", "dndUntil", "previews", "sound")) if (!read.has(key)) return null
    val previews = read.opt("previews") as? Boolean ?: return null
    val sound = read.opt("sound") as? Boolean ?: return null
    val dndUntil =
      if (read.isNull("dndUntil")) null else whole(read.opt("dndUntil")) ?: return null
    val hours = if (read.isNull("hours")) null else hoursOf(read.opt("hours")) ?: return null
    return PushQuiet(hours, dndUntil, previews, sound)
  }

  private fun whole(value: Any?): Long? =
    when (value) {
      is Int -> value.toLong()
      is Long -> value
      is Double -> if (value == Math.floor(value) && !value.isInfinite()) value.toLong() else null
      else -> null
    }

  private fun hoursOf(value: Any?): PushHours? {
    val read = value as? JSONObject ?: return null
    val listed = read.opt("days") as? JSONArray ?: return null
    val days = mutableSetOf<Int>()
    for (at in 0 until listed.length()) {
      val day = whole(listed.opt(at)) ?: return null
      if (day < 0 || day > 6 || !days.add(day.toInt())) return null
    }
    val from = whole(read.opt("from")) ?: return null
    val to = whole(read.opt("to")) ?: return null
    if (from < 0 || from >= DAY_MINUTES || to < 0 || to >= DAY_MINUTES) return null
    return PushHours(days, from.toInt(), to.toInt())
  }

  fun inHours(hours: PushHours?, day: Int, minute: Int): Boolean {
    if (hours == null) return true
    if (hours.from == hours.to) return day in hours.days
    if (hours.from < hours.to) return day in hours.days && minute >= hours.from && minute < hours.to
    val yesterday = (day + 6) % 7
    return (day in hours.days && minute >= hours.from) || (yesterday in hours.days && minute < hours.to)
  }

  fun shows(quiet: PushQuiet, now: Long, day: Int, minute: Int): Boolean =
    !(quiet.dndUntil != null && quiet.dndUntil > now) && inHours(quiet.hours, day, minute)

  fun words(push: ChatPush, previews: Boolean, hidden: String, attachment: String): String =
    when {
      !previews -> hidden
      !push.text || push.body.isEmpty() -> attachment
      else -> push.body
    }

  fun kept(held: List<PushLine>, added: PushLine): List<PushLine> =
    (held.filter { it.id != added.id } + added).sortedBy { it.at }.takeLast(MOST)

  fun noteId(chat: String): Int = chat.hashCode()

  fun taken(held: String, chat: String, message: String, seq: Long): String {
    val before =
      try {
        JSONArray(held)
      } catch (error: Exception) {
        JSONArray()
      }
    val after = JSONArray()
    val from = maxOf(0, before.length() - (MOST_TAKEN - 1))
    for (at in from until before.length()) {
      val one = before.optJSONObject(at) ?: continue
      if (one.optString("chat") != chat) after.put(one)
    }
    after.put(JSONObject().put("chat", chat).put("message", message).put("seq", seq))
    return after.toString()
  }
}
