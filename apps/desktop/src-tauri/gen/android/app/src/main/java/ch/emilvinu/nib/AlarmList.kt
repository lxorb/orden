package ch.emilvinu.nib

data class Alarm(
  val id: String,
  val at: Long,
  val title: String,
  val body: String,
  val space: String,
  val path: String,
  val hash: String,
  val line: Int,
)

object AlarmList {
  const val MOST = 64

  const val SNOOZE_MS = 15 * 60_000L

  const val REMEMBERED_MS = 7 * 86_400_000L

  fun wanted(plan: List<Alarm>, now: Long): List<Alarm> =
    plan.filter { it.at > now }.sortedBy { it.at }.take(MOST)

  fun cancelled(held: List<Alarm>, wanted: List<Alarm>): List<String> {
    val keep = wanted.map { it.id }.toSet()
    return held.map { it.id }.filter { it !in keep }
  }

  fun requestCode(id: String): Int = id.take(8).toLongOrNull(16)?.toInt() ?: id.hashCode()

  fun snoozed(now: Long): Long = now + SNOOZE_MS

  fun known(id: String, held: List<Alarm>, rung: Map<String, Long>, now: Long): Boolean =
    held.any { it.id == id } || (rung[id]?.let { now - it < REMEMBERED_MS } ?: false)
}
