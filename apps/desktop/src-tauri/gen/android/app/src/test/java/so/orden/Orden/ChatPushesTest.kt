package so.orden.Orden

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatPushesTest {
  private val chat = "c_0123456789abcdef0123456789abcdef"
  private val push =
    mapOf(
      "kind" to "chat",
      "v" to "1",
      "id" to "msg00000001",
      "title" to "Ada",
      "body" to "Lunch?",
      "chat" to chat,
      "space" to "s1",
      "message" to "msg00000001",
      "seq" to "7",
      "at" to "1700000000000",
      "from" to "user:u1",
      "reason" to "mention",
      "text" to "yes",
    )
  private val quiet =
    """{"hours":{"days":[1,2,3,4,5],"from":540,"to":1080},"dndUntil":null,"previews":true,"sound":false}"""

  private fun quietWith(change: (String) -> String) = ChatPushes.quietOf(change(quiet))

  @Test
  fun aPushIsReadAsItWasSent() {
    val read = ChatPushes.of(push)
    assertNotNull(read)
    assertEquals(7L, read?.seq)
    assertEquals(1700000000000L, read?.at)
    assertEquals("Ada", read?.title)
    assertEquals(true, read?.text)
  }

  @Test
  fun aPushWithAPartMissingOrWrongIsRefused() {
    for (key in push.keys) assertNull(key, ChatPushes.of(push - key))
    assertNull(ChatPushes.of(push + ("kind" to "todo")))
    assertNull(ChatPushes.of(push + ("v" to "2")))
    assertNull(ChatPushes.of(push + ("chat" to "c_short")))
    assertNull(ChatPushes.of(push + ("message" to "has space")))
    assertNull(ChatPushes.of(push + ("seq" to "-1")))
    assertNull(ChatPushes.of(push + ("from" to "ada")))
    assertNull(ChatPushes.of(push + ("reason" to "whim")))
    assertNull(ChatPushes.of(push + ("text" to "maybe")))
  }

  @Test
  fun thePressOpensTheChatAtTheMessage() {
    val link = ChatPushes.link(chat, "msg00000001")
    assertEquals("orden-chat://chat/$chat?message=msg00000001", link)
    assertEquals(chat, ChatPushes.chatOf(link))
    assertEquals("", ChatPushes.chatOf("orden-chat://chat/nothing"))
  }

  @Test
  fun quietTimesAreReadBackAsToldAndRefusedWhenAPartIsWrong() {
    val read = ChatPushes.quietOf(quiet)
    assertEquals(PushQuiet(PushHours(setOf(1, 2, 3, 4, 5), 540, 1080), null, true, false), read)
    assertNull(quietWith { it.replace("[1,2,3,4,5]", "[9]") })
    assertNull(quietWith { it.replace("[1,2,3,4,5]", "[1,1]") })
    assertNull(quietWith { it.replace("\"dndUntil\":null", "\"dndUntil\":\"later\"") })
    assertNull(quietWith { it.replace(",\"previews\":true", "") })
    assertNull(quietWith { it.replace("\"to\":1080", "\"to\":1440") })
    assertNull(ChatPushes.quietOf("null"))
    assertNull(ChatPushes.quietOf(""))
    assertEquals(null, quietWith { it.replace(Regex("\"hours\":\\{[^}]*\\}"), "\"hours\":null") }?.hours)
  }

  @Test
  fun aPushShowsInsideTheHoursAndNotOutsideThem() {
    val held = ChatPushes.quietOf(quiet)!!
    assertTrue(ChatPushes.shows(held, 1000, 1, 540))
    assertTrue(ChatPushes.shows(held, 1000, 1, 1079))
    assertFalse(ChatPushes.shows(held, 1000, 1, 1080))
    assertFalse(ChatPushes.shows(held, 1000, 6, 600))
    assertTrue(ChatPushes.shows(held.copy(hours = null), 1000, 6, 600))
  }

  @Test
  fun hoursPastMidnightBelongToTheDayTheyBegan() {
    val late = ChatPushes.quietOf(quiet)!!.copy(hours = PushHours(setOf(5), 1320, 120))
    assertTrue(ChatPushes.shows(late, 1000, 5, 1400))
    assertTrue(ChatPushes.shows(late, 1000, 6, 60))
    assertFalse(ChatPushes.shows(late, 1000, 6, 121))
    assertFalse(ChatPushes.shows(late, 1000, 5, 60))
  }

  @Test
  fun theSameStartAndEndMeanTheWholeDay() {
    val whole = ChatPushes.quietOf(quiet)!!.copy(hours = PushHours(setOf(2), 600, 600))
    assertTrue(ChatPushes.shows(whole, 1000, 2, 0))
    assertTrue(ChatPushes.shows(whole, 1000, 2, 1439))
    assertFalse(ChatPushes.shows(whole, 1000, 3, 600))
  }

  @Test
  fun nothingShowsUntilDoNotDisturbHasRunOut() {
    val held = ChatPushes.quietOf(quiet)!!.copy(dndUntil = 2000)
    assertFalse(ChatPushes.shows(held, 1999, 1, 600))
    assertTrue(ChatPushes.shows(held, 2000, 1, 600))
  }

  @Test
  fun hiddenContentShowsOnlyThatAMessageCame() {
    val read = ChatPushes.of(push)!!
    assertEquals("Lunch?", ChatPushes.words(read, true, "New message", "Sent an attachment"))
    assertEquals("New message", ChatPushes.words(read, false, "New message", "Sent an attachment"))
    val bare = ChatPushes.of(push + ("text" to "no") + ("body" to ""))!!
    assertEquals("Sent an attachment", ChatPushes.words(bare, true, "New message", "Sent an attachment"))
    assertEquals("New message", ChatPushes.words(bare, false, "New message", "Sent an attachment"))
  }

  @Test
  fun aChatKeepsItsLastEightLinesOldestFirstAndNoMessageTwice() {
    var lines = emptyList<PushLine>()
    for (at in 1..10) lines = ChatPushes.kept(lines, PushLine("m$at", "Ada", "line $at", at * 10L))
    assertEquals(8, lines.size)
    assertEquals("m3", lines.first().id)
    assertEquals("m10", lines.last().id)
    val again = ChatPushes.kept(lines, PushLine("m5", "Ada", "edited", 50L))
    assertEquals(8, again.size)
    assertEquals("edited", again.first { it.id == "m5" }.words)
  }

  @Test
  fun markedReadIsKeptOncePerChatForThePageToTake() {
    val other = "c_ffffffffffffffffffffffffffffffff"
    var held = ChatPushes.taken("[]", chat, "m1", 3)
    held = ChatPushes.taken(held, other, "m9", 1)
    held = ChatPushes.taken(held, chat, "m2", 4)
    val read = JSONArray(held)
    assertEquals(2, read.length())
    assertEquals(other, read.getJSONObject(0).getString("chat"))
    assertEquals("m2", read.getJSONObject(1).getString("message"))
    assertEquals(4L, read.getJSONObject(1).getLong("seq"))
    assertEquals(1, JSONArray(ChatPushes.taken("not json", chat, "m1", 3)).length())
  }
}
