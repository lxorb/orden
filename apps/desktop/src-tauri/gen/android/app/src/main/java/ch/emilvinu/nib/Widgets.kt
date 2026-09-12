package ch.emilvinu.nib

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject

/**
 * What the app leaves on the home screen: a new note, the search, and the notes
 * that were written in last, each of which opens that note.
 *
 * A widget is drawn by the launcher and not by the app, so it cannot ask the page
 * anything: the page says what the rows are whenever the file list changes and
 * that is what is drawn until it says so again. Which notes those are, in which
 * order and under what names is decided in mobile/widgets.ts, where it is one
 * answer that can be read and tested; everything here is the drawing of it.
 *
 * A note pinned in the app comes first, which is what "open a chosen note" means
 * here. A picker of its own would be a second file list written in a second
 * language, and the app already has the one gesture for keeping a note to hand.
 */
class NotesWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) manager.updateAppWidget(id, drawn(context))
  }

  companion object {
    /** As many rows as the layout has. A widget resized shorter than its rows
     *  simply shows fewer of them; the launcher crops what it was given. */
    private val ROWS =
      intArrayOf(R.id.nib_row_0, R.id.nib_row_1, R.id.nib_row_2, R.id.nib_row_3, R.id.nib_row_4)

    /** Draws every widget on the home screen again. Called when the page says the
     *  rows have changed, and by the launcher on its own schedule. */
    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context) ?: return
      val ids = manager.getAppWidgetIds(ComponentName(context, NotesWidget::class.java))
      if (ids == null || ids.isEmpty()) return

      val views = drawn(context)
      for (id in ids) manager.updateAppWidget(id, views)
    }

    private fun drawn(context: Context): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_notes)
      val state = read(context)

      views.setTextViewText(R.id.nib_title, state.title)
      views.setOnClickPendingIntent(R.id.nib_title, command(context, "", 1))
      views.setOnClickPendingIntent(R.id.nib_new, command(context, "new", 2))
      views.setOnClickPendingIntent(R.id.nib_search, command(context, "search-space", 3))

      for ((at, row) in ROWS.withIndex()) {
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
      views.setViewVisibility(R.id.nib_empty, if (empty) View.VISIBLE else View.GONE)
      if (empty) views.setOnClickPendingIntent(R.id.nib_empty, command(context, "new", 4))

      return views
    }

    /** A row that runs one of the app's own commands, or opens the app when the
     *  id is empty. */
    private fun command(context: Context, id: String, at: Int): PendingIntent {
      val intent = intent(context)
      if (id.isNotEmpty()) intent.putExtra(MainActivity.EXTRA_COMMAND, id)
      return pending(context, intent, at)
    }

    /** A row that opens one note. */
    private fun open(context: Context, path: String, at: Int): PendingIntent =
      pending(context, intent(context).putExtra(MainActivity.EXTRA_OPEN, path), at)

    private fun intent(context: Context): Intent =
      Intent(context, MainActivity::class.java)
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
        Log.w("nib", "the widget's notes could not be read: ${error.message}")
        Rows(context.getString(R.string.app_name), emptyList())
      }
    }

    private class Row(val name: String, val path: String)

    private class Rows(val title: String, val notes: List<Row>)
  }
}

/**
 * The one copy of what the widgets draw, written by the page through the bridge
 * and read by the launcher's own process. Preferences rather than a file: it is a
 * handful of names, it has to be readable from a broadcast with no activity
 * behind it, and it is the app's own storage either way, which
 * `data_extraction_rules.xml` keeps out of every backup with the notes.
 */
object WidgetNotes {
  private const val STORE = "nib.widgets"
  private const val KEY = "notes"

  fun write(context: Context, json: String) {
    context
      .getSharedPreferences(STORE, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY, json)
      .apply()

    NotesWidget.refresh(context)
  }

  fun read(context: Context): String =
    context.getSharedPreferences(STORE, Context.MODE_PRIVATE).getString(KEY, "") ?: ""
}
