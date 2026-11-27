package so.orden.Orden

import org.json.JSONArray
import org.json.JSONObject

data class TrackActivity(val id: String, val name: String, val color: String)

data class TrackRunning(val id: String, val name: String, val color: String, val since: Long)

data class TrackState(
  val running: TrackRunning?,
  val activities: List<TrackActivity>,
  val last: String,
)

object TrackTimer {
  const val MOST = 8
  const val MOST_ASKED = 32
  const val LONGEST_ID = 64

  val NOTHING = TrackState(null, emptyList(), "")

  private val COLOR = Regex("^#[0-9a-fA-F]{6}$")

  private fun known(id: String) = id.isNotEmpty() && id.length <= LONGEST_ID

  fun stateOf(json: String): TrackState {
    val read =
      try {
        JSONObject(json)
      } catch (error: Exception) {
        return NOTHING
      }
    val activities = mutableListOf<TrackActivity>()
    val listed = read.optJSONArray("activities") ?: JSONArray()
    for (at in 0 until listed.length()) {
      val one = listed.optJSONObject(at) ?: continue
      val id = one.optString("id")
      val name = one.optString("name")
      if (!known(id) || name.isEmpty() || activities.any { it.id == id }) continue
      activities.add(TrackActivity(id, name, one.optString("color")))
      if (activities.size == MOST) break
    }
    val held = read.optJSONObject("running")
    val since = held?.optLong("since", 0L) ?: 0L
    val running =
      if (held != null && known(held.optString("id")) && held.optString("name").isNotEmpty() && since > 0) {
        TrackRunning(held.optString("id"), held.optString("name"), held.optString("color"), since)
      } else {
        null
      }
    val last = read.optString("last").takeIf { known(it) } ?: ""
    return TrackState(running, activities, last)
  }

  fun toJson(state: TrackState): String {
    val json = JSONObject()
    val running = state.running
    json.put(
      "running",
      if (running == null) {
        JSONObject.NULL
      } else {
        JSONObject()
          .put("id", running.id)
          .put("name", running.name)
          .put("color", running.color)
          .put("since", running.since)
      },
    )
    val listed = JSONArray()
    for (one in state.activities) {
      listed.put(JSONObject().put("id", one.id).put("name", one.name).put("color", one.color))
    }
    return json.put("activities", listed).put("last", state.last).toString()
  }

  fun colorOf(said: String, fallback: Int): Int =
    if (COLOR.matches(said)) (0xFF000000 or said.substring(1).toLong(16)).toInt() else fallback

  fun inkOn(color: Int): Int {
    val part = { shift: Int ->
      val one = ((color shr shift) and 0xFF) / 255.0
      if (one <= 0.03928) one / 12.92 else Math.pow((one + 0.055) / 1.055, 2.4)
    }
    val light = 0.2126 * part(16) + 0.7152 * part(8) + 0.0722 * part(0)
    return if (light > 0.179) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
  }

  fun stopped(state: TrackState): TrackState = state.copy(running = null)

  fun started(state: TrackState, id: String, now: Long): TrackState {
    val found = state.activities.find { it.id == id } ?: return state
    return state.copy(running = TrackRunning(found.id, found.name, found.color, now), last = found.id)
  }

  fun pressed(state: TrackState, press: String, now: Long): Pair<TrackState, JSONObject?> =
    when {
      press == "stop" || (press == "toggle" && state.running != null) ->
        if (state.running == null) {
          state to null
        } else {
          stopped(state) to JSONObject().put("do", "stop").put("at", now)
        }
      press == "toggle" -> pressed(state, "start:${state.last}", now)
      press.startsWith("start:") -> {
        val id = press.removePrefix("start:")
        val next = started(state, id, now)
        if (next === state || state.running?.id == id) {
          state to null
        } else {
          next to JSONObject().put("do", "start").put("id", id).put("at", now)
        }
      }
      else -> state to null
    }

  fun asked(held: String, added: JSONObject): String {
    val before =
      try {
        JSONArray(held)
      } catch (error: Exception) {
        JSONArray()
      }
    val after = JSONArray()
    val from = maxOf(0, before.length() - (MOST_ASKED - 1))
    for (at in from until before.length()) before.optJSONObject(at)?.let { after.put(it) }
    return after.put(added).toString()
  }
}
