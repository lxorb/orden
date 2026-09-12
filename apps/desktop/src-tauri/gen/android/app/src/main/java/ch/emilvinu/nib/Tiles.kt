package ch.emilvinu.nib

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

/**
 * The app's three rows in the quick settings panel: a new note, the search, and
 * the recorder.
 *
 * Each one is the same gesture as the command of the same name in the app, and it
 * is the same command: the tile carries an id into the activity, the activity
 * hands it to the page, and the page looks it up in the one registry the palette
 * and the menus read. Nothing here knows what a note is, so a tile can never mean
 * something slightly different from the row it is named after.
 *
 * An id the page does not know is one it does nothing about, which is what keeps
 * `record` inert until the recorder lands; the service is turned off in the
 * manifest until then, so the tile is not even offered.
 */
abstract class NibTile : TileService() {
  /** The command in `commands.ts` this tile stands for. */
  protected abstract val command: String

  override fun onStartListening() {
    super.onStartListening()
    // Every one of these does something rather than turning something on, so
    // none of them is ever the active state.
    qsTile?.let { tile ->
      tile.state = Tile.STATE_INACTIVE
      tile.updateTile()
    }
  }

  override fun onClick() {
    super.onClick()

    val intent =
      Intent(this, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(MainActivity.EXTRA_COMMAND, command)

    // Android 14 refuses the intent form outright - it throws rather than
    // ignoring it - so the panel is handed something it may launch itself.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      val pending =
        PendingIntent.getActivity(
          this,
          command.hashCode(),
          intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
      startActivityAndCollapse(pending)
    } else {
      @Suppress("DEPRECATION") startActivityAndCollapse(intent)
    }
  }
}

class NewNoteTile : NibTile() {
  override val command = "new"
}

class SearchTile : NibTile() {
  override val command = "search-space"
}

class RecordTile : NibTile() {
  override val command = "record"
}
