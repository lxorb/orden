package ch.emilvinu.nib

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService

abstract class NibTile : TileService() {
  protected abstract val command: String

  override fun onStartListening() {
    super.onStartListening()
    qsTile?.let { tile ->
      tile.state = Tile.STATE_INACTIVE
      tile.updateTile()
    }
  }

  override fun onClick() {
    super.onClick()

    val intent =
      MainActivity.sealed(this, Intent(this, MainActivity::class.java))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .putExtra(MainActivity.EXTRA_COMMAND, command)

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
