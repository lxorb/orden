package so.orden.Orden

import android.app.Activity
import android.app.NotificationManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object Track {
  private const val STORE = "orden.track"
  private const val STATE = "state"
  private const val ASKED = "asked"

  const val CHANNEL = "timer"
  const val ACTION_STOP = "so.orden.Orden.track.STOP"
  const val HEARD = "window.__ordenTrack?.()"

  private const val TAG = "orden.track"
  private const val NOTE = 0x7472
  private const val ACCENT = 0xFF4F6BED.toInt()

  private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)

  fun held(context: Context): TrackState =
    TrackTimer.stateOf(prefs(context).getString(STATE, "") ?: "")

  fun set(activity: Activity, json: String) {
    val state = TrackTimer.stateOf(json)
    prefs(activity).edit().putString(STATE, TrackTimer.toJson(state)).apply()
    if (state.running != null) Showing.askOnce(activity)
    drawn(activity, state)
  }

  @Synchronized
  fun taken(context: Context): String {
    val prefs = prefs(context)
    val held = prefs.getString(ASKED, "[]") ?: "[]"
    prefs.edit().remove(ASKED).apply()
    return held
  }

  @Synchronized
  fun pressed(context: Context, press: String) {
    val prefs = prefs(context)
    val (next, asked) = TrackTimer.pressed(held(context), press, System.currentTimeMillis())
    if (asked == null) return
    prefs
      .edit()
      .putString(STATE, TrackTimer.toJson(next))
      .putString(ASKED, TrackTimer.asked(prefs.getString(ASKED, "[]") ?: "[]", asked))
      .apply()
    drawn(context, next)
    MainActivity.told(HEARD)
  }

  private fun drawn(context: Context, state: TrackState) {
    note(context, state.running)
    TrackWidget.refresh(context, state)
    try {
      TileService.requestListeningState(context, ComponentName(context, TrackTile::class.java))
    } catch (error: RuntimeException) {
      Log.w("orden", "the Track tile could not be told: ${error.message}")
    }
  }

  private fun note(context: Context, running: TrackRunning?) {
    if (running == null) {
      NotificationManagerCompat.from(context).cancel(TAG, NOTE)
      return
    }
    Showing.channel(
      context,
      CHANNEL,
      context.getString(R.string.track_channel),
      NotificationManager.IMPORTANCE_LOW,
    )
    val stop =
      PendingIntent.getBroadcast(
        context,
        NOTE,
        Intent(context, TrackReceiver::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    val notification =
      NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_track)
        .setContentTitle(running.name)
        .setColor(TrackTimer.colorOf(running.color, ACCENT))
        .setWhen(running.since)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setContentIntent(opens(context, "", NOTE))
        .addAction(0, context.getString(R.string.track_stop), stop)
        .build()
    Showing.show(context, TAG, NOTE, notification)
  }

  fun opens(context: Context, press: String, code: Int): PendingIntent {
    val intent =
      MainActivity.sealed(context, Intent(context, MainActivity::class.java))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (press.isNotEmpty()) {
      intent.setData(Uri.parse("orden-track-press://$code")).putExtra(MainActivity.EXTRA_TRACK, press)
    }
    return PendingIntent.getActivity(
      context,
      code,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  fun accent(): Int = ACCENT
}

class TrackReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Track.ACTION_STOP) Track.pressed(context, "stop")
  }
}

class TrackTile : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    val running = Track.held(this).running
    qsTile?.let { tile ->
      tile.state = if (running == null) Tile.STATE_INACTIVE else Tile.STATE_ACTIVE
      tile.label = running?.name ?: getString(R.string.tile_track)
      tile.updateTile()
    }
  }

  override fun onClick() {
    super.onClick()
    Track.pressed(this, "toggle")
    val pending = Track.opens(this, "", 0x7473)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startActivityAndCollapse(pending)
    } else {
      val intent =
        MainActivity.sealed(this, Intent(this, MainActivity::class.java))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      @Suppress("DEPRECATION") startActivityAndCollapse(intent)
    }
  }
}

class TrackWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val state = Track.held(context)
    for (id in ids) manager.updateAppWidget(id, drawn(context, state))
  }

  companion object {
    private val CELLS =
      intArrayOf(
        R.id.orden_track_cell_0,
        R.id.orden_track_cell_1,
        R.id.orden_track_cell_2,
        R.id.orden_track_cell_3,
        R.id.orden_track_cell_4,
        R.id.orden_track_cell_5,
        R.id.orden_track_cell_6,
        R.id.orden_track_cell_7,
      )

    fun refresh(context: Context, state: TrackState) {
      val manager = AppWidgetManager.getInstance(context) ?: return
      val ids = manager.getAppWidgetIds(ComponentName(context, TrackWidget::class.java))
      if (ids == null || ids.isEmpty()) return
      for (id in ids) manager.updateAppWidget(id, drawn(context, state))
    }

    private fun drawn(context: Context, state: TrackState): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_track)
      val running = state.running

      views.setTextViewText(
        R.id.orden_track_title,
        running?.name ?: context.getString(R.string.widget_track),
      )
      views.setOnClickPendingIntent(R.id.orden_track_title, Track.opens(context, "", 200))
      views.setViewVisibility(R.id.orden_track_stop, if (running == null) View.GONE else View.VISIBLE)
      views.setOnClickPendingIntent(R.id.orden_track_stop, Track.opens(context, "stop", 201))

      for ((at, cell) in CELLS.withIndex()) {
        val one = state.activities.getOrNull(at)
        if (one == null) {
          views.setViewVisibility(cell, View.INVISIBLE)
          continue
        }
        val color = TrackTimer.colorOf(one.color, Track.accent())
        views.setViewVisibility(cell, View.VISIBLE)
        views.setTextViewText(cell, one.name)
        views.setInt(cell, "setBackgroundColor", color)
        views.setTextColor(cell, TrackTimer.inkOn(color))
        views.setOnClickPendingIntent(cell, Track.opens(context, "start:${one.id}", 210 + at))
      }

      val empty = state.activities.isEmpty()
      views.setViewVisibility(R.id.orden_track_empty, if (empty) View.VISIBLE else View.GONE)
      views.setViewVisibility(R.id.orden_track_cells, if (empty) View.GONE else View.VISIBLE)
      return views
    }
  }
}
