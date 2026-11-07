package so.orden.Orden

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.appwidget.AppWidgetProviderInfo
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

class NotesWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    val state = read(context)
    for (id in ids) manager.updateAppWidget(id, drawn(context, state, onKeyguard(manager, id)))
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    manager: AppWidgetManager,
    id: Int,
    options: Bundle?,
  ) {
    manager.updateAppWidget(id, drawn(context, read(context), onKeyguard(manager, id)))
  }

  companion object {
    private val ROWS =
      intArrayOf(R.id.orden_row_0, R.id.orden_row_1, R.id.orden_row_2, R.id.orden_row_3, R.id.orden_row_4)

    private val LOCK_ROWS = ROWS.copyOfRange(0, 3)

    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context) ?: return
      val ids = manager.getAppWidgetIds(ComponentName(context, NotesWidget::class.java))
      if (ids == null || ids.isEmpty()) return

      val state = read(context)
      for (id in ids) manager.updateAppWidget(id, drawn(context, state, onKeyguard(manager, id)))
    }

    private fun onKeyguard(manager: AppWidgetManager, id: Int): Boolean {
      val options = manager.getAppWidgetOptions(id) ?: return false
      val category =
        options.getInt(
          AppWidgetManager.OPTION_APPWIDGET_HOST_CATEGORY,
          AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN,
        )

      return category == AppWidgetProviderInfo.WIDGET_CATEGORY_KEYGUARD
    }

    private fun drawn(context: Context, state: Rows, lock: Boolean): RemoteViews {
      val views =
        RemoteViews(
          context.packageName,
          if (lock) R.layout.widget_notes_lock else R.layout.widget_notes,
        )
      val rows = if (lock) LOCK_ROWS else ROWS

      views.setTextViewText(R.id.orden_title, state.title)
      views.setOnClickPendingIntent(R.id.orden_title, command(context, "", 1))
      views.setOnClickPendingIntent(R.id.orden_new, command(context, "new", 2))
      views.setOnClickPendingIntent(R.id.orden_search, command(context, "search-space", 3))

      for ((at, row) in rows.withIndex()) {
        val note = state.notes.getOrNull(at)
        if (note == null) {
          views.setViewVisibility(row, View.GONE)
          continue
        }

        views.setViewVisibility(row, View.VISIBLE)
        views.setTextViewText(row, note.name)
        views.setOnClickPendingIntent(row, open(context, note.path, 10 + at))
      }

      val empty = state.notes.isEmpty()
      views.setViewVisibility(R.id.orden_empty, if (empty) View.VISIBLE else View.GONE)
      if (empty) views.setOnClickPendingIntent(R.id.orden_empty, command(context, "new", 4))

      return views
    }

    private fun command(context: Context, id: String, at: Int): PendingIntent {
      val intent = intent(context)
      if (id.isNotEmpty()) intent.putExtra(MainActivity.EXTRA_COMMAND, id)
      return pending(context, intent, at)
    }

    private fun open(context: Context, path: String, at: Int): PendingIntent =
      pending(context, intent(context).putExtra(MainActivity.EXTRA_OPEN, path), at)

    private fun intent(context: Context): Intent =
      MainActivity.sealed(context, Intent(context, MainActivity::class.java))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

    private fun pending(context: Context, intent: Intent, at: Int): PendingIntent =
      PendingIntent.getActivity(
        context,
        at,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    private fun read(context: Context): Rows {
      val held = WidgetNotes.read(context)
      if (held.isEmpty()) return Rows(context.getString(R.string.app_name), emptyList())

      return try {
        val json = JSONObject(held)
        val listed = json.optJSONArray("notes")
        val notes = mutableListOf<Row>()
        for (at in 0 until (listed?.length() ?: 0)) {
          val one = listed?.optJSONObject(at) ?: continue
          val name = one.optString("name")
          val path = one.optString("path")
          if (name.isEmpty() || path.isEmpty()) continue
          notes.add(Row(name, path))
          if (notes.size == ROWS.size) break
        }

        val title = json.optString("title")
        Rows(if (title.isEmpty()) context.getString(R.string.app_name) else title, notes)
      } catch (error: Exception) {
        Log.w("orden", "the widget's notes could not be read: ${error.message}")
        Rows(context.getString(R.string.app_name), emptyList())
      }
    }

    private class Row(val name: String, val path: String)

    private class Rows(val title: String, val notes: List<Row>)
  }
}

object WidgetNotes {
  private const val STORE = "orden.widgets"
  private const val KEY = "notes"

  fun write(context: Context, json: String) {
    context
      .getSharedPreferences(STORE, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, json)
      .apply()

    NotesWidget.refresh(context)
    TodayWidget.refresh(context)
  }

  fun read(context: Context): String =
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getString(KEY, "") ?: ""
}
