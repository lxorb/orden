package so.orden.Orden

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class TrackTimerTest {
  private val told =
    """{"running":{"id":"a1","name":"Reading","color":"#3366cc","since":1700000000000},""" +
      """"activities":[{"id":"a1","name":"Reading","color":"#3366cc"},{"id":"a2","name":"Running","color":"#cc3333"}],""" +
      """"last":"a1"}"""
  private val idle = told.replace(Regex("\"running\":\\{[^}]*\\}"), "\"running\":null")

  @Test
  fun whatThePageToldIsReadAndWrittenBackTheSame() {
    val state = TrackTimer.stateOf(told)
    assertEquals(TrackRunning("a1", "Reading", "#3366cc", 1700000000000L), state.running)
    assertEquals(listOf("a1", "a2"), state.activities.map { it.id })
    assertEquals("a1", state.last)
    assertEquals(state, TrackTimer.stateOf(TrackTimer.toJson(state)))
    assertNull(TrackTimer.stateOf(idle).running)
    assertEquals(TrackTimer.stateOf(idle), TrackTimer.stateOf(TrackTimer.toJson(TrackTimer.stateOf(idle))))
  }

  @Test
  fun whatCannotBeReadIsNothingRunningAndNoActivities() {
    assertEquals(TrackTimer.NOTHING, TrackTimer.stateOf(""))
    assertEquals(TrackTimer.NOTHING, TrackTimer.stateOf("[]"))
    assertNull(TrackTimer.stateOf("""{"running":{"id":"a1","name":"Reading","since":0}}""").running)
    assertNull(TrackTimer.stateOf("""{"running":{"id":"","name":"Reading","since":5}}""").running)
  }

  @Test
  fun atMostEightActivitiesEachOnce() {
    val many =
      (1..12).joinToString(",") { """{"id":"a${it % 10}","name":"Activity $it","color":"#000000"}""" }
    val state = TrackTimer.stateOf("""{"running":null,"activities":[$many],"last":""}""")
    assertEquals(8, state.activities.size)
    assertEquals(8, state.activities.map { it.id }.toSet().size)
  }

  @Test
  fun stopAsksThePageToStopAtThatMomentAndShowsNothingRunning() {
    val (next, asked) = TrackTimer.pressed(TrackTimer.stateOf(told), "stop", 5000)
    assertNull(next.running)
    assertEquals("stop", asked?.getString("do"))
    assertEquals(5000L, asked?.getLong("at"))
    val (same, none) = TrackTimer.pressed(next, "stop", 6000)
    assertSame(next, same)
    assertNull(none)
  }

  @Test
  fun theTileStopsWhatRunsAndOtherwiseStartsTheLastActivity() {
    val running = TrackTimer.stateOf(told)
    assertEquals("stop", TrackTimer.pressed(running, "toggle", 5000).second?.getString("do"))
    val (next, asked) = TrackTimer.pressed(TrackTimer.stateOf(idle), "toggle", 7000)
    assertEquals(TrackRunning("a1", "Reading", "#3366cc", 7000L), next.running)
    assertEquals("start", asked?.getString("do"))
    assertEquals("a1", asked?.getString("id"))
    assertEquals(7000L, asked?.getLong("at"))
    assertNull(TrackTimer.pressed(TrackTimer.stateOf(idle).copy(last = ""), "toggle", 7000).second)
  }

  @Test
  fun aCellStartsItsActivityAndNeitherTheRunningOneNorOneItDoesNotKnow() {
    val running = TrackTimer.stateOf(told)
    val (next, asked) = TrackTimer.pressed(running, "start:a2", 8000)
    assertEquals("a2", next.running?.id)
    assertEquals("a2", next.last)
    assertEquals("a2", asked?.getString("id"))
    assertNull(TrackTimer.pressed(running, "start:a1", 8000).second)
    assertNull(TrackTimer.pressed(running, "start:gone", 8000).second)
    assertNull(TrackTimer.pressed(running, "dance", 8000).second)
  }

  @Test
  fun whatWasAskedWaitsInOrderForThePageAndOnlyTheLastThirtyTwo() {
    var held = "not json"
    for (at in 1..40) held = TrackTimer.asked(held, org.json.JSONObject().put("do", "stop").put("at", at))
    val read = JSONArray(held)
    assertEquals(32, read.length())
    assertEquals(9L, read.getJSONObject(0).getLong("at"))
    assertEquals(40L, read.getJSONObject(31).getLong("at"))
  }

  @Test
  fun aColourIsReadFromSixHexDigitsAndInkIsChosenToBeReadOnIt() {
    assertEquals(0xFF3366CC.toInt(), TrackTimer.colorOf("#3366cc", 1))
    assertEquals(1, TrackTimer.colorOf("var(--accent)", 1))
    assertEquals(1, TrackTimer.colorOf("#36c", 1))
    assertEquals(0xFF000000.toInt(), TrackTimer.inkOn(0xFFFFEE88.toInt()))
    assertEquals(0xFFFFFFFF.toInt(), TrackTimer.inkOn(0xFF223355.toInt()))
  }
}
