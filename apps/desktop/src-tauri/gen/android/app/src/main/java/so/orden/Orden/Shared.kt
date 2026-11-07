package so.orden.Orden

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

object Shared {
  private const val TAG = "nib"

  private const val FOLDER = "shared"

  private const val MOST_BYTES = 64L * 1024 * 1024

  private const val STEP = 64 * 1024

  private class Item(
    val name: String,
    val mime: String,
    val text: String?,
    val file: File?,
  )

  private var action = ""
  private var subject = ""
  private var items = listOf<Item>()

  val waiting: Boolean
    get() = items.isNotEmpty()

  fun take(context: Context, intent: Intent): Boolean {
    val uris =
      when (intent.action) {
        Intent.ACTION_SEND -> listOfNotNull(stream(intent))
        Intent.ACTION_SEND_MULTIPLE -> streams(intent)
        else -> return false
      }

    val text = intent.getStringExtra(Intent.EXTRA_TEXT)
    if (uris.isEmpty() && text.isNullOrBlank()) return false

    clear(context)
    action = intent.action ?: ""
    subject = intent.getStringExtra(Intent.EXTRA_SUBJECT) ?: ""

    val read = mutableListOf<Item>()
    if (!text.isNullOrBlank()) {
      read.add(Item(name = "", mime = "text/plain", text = text, file = null))
    }

    var room = MOST_BYTES
    for (uri in uris) {
      if (room <= 0L) break
      val copied = copy(context, uri, read.size, room) ?: continue
      room -= copied.file?.length() ?: 0L
      read.add(copied)
    }

    items = read
    return waiting
  }

  fun json(): String {
    val listed = JSONArray()
    for (item in items) {
      val one = JSONObject()
      one.put("name", item.name)
      one.put("mime", item.mime)
      one.put("size", item.file?.length() ?: 0L)
      if (item.text != null) one.put("text", item.text)
      listed.put(one)
    }

    val all = JSONObject()
    all.put("action", action)
    all.put("subject", subject)
    all.put("items", listed)
    return all.toString()
  }

  fun bytes(index: Int, offset: Int, length: Int): String {
    val file = items.getOrNull(index)?.file ?: return ""
    if (offset < 0 || length <= 0) return ""

    val size = file.length()
    if (offset >= size) return ""

    val want = minOf(length.toLong(), size - offset).toInt()
    val buffer = ByteArray(want)
    var filled = 0

    try {
      file.inputStream().use { stream ->
        var skipped = 0L
        while (skipped < offset) {
          val stepped = stream.skip(offset.toLong() - skipped)
          if (stepped <= 0L) break
          skipped += stepped
        }

        if (skipped >= offset) {
          while (filled < want) {
            val got = stream.read(buffer, filled, want - filled)
            if (got < 0) break
            filled += got
          }
        }
      }
    } catch (error: Exception) {
      Log.w(TAG, "a shared file could not be read: ${error.message}")
      return ""
    }

    if (filled <= 0) return ""
    val slice = if (filled == want) buffer else buffer.copyOf(filled)
    return Base64.encodeToString(slice, Base64.NO_WRAP)
  }

  fun clear(context: Context) {
    action = ""
    subject = ""
    items = emptyList()

    val held = folder(context).listFiles() ?: return
    for (file in held) file.delete()
  }

  private fun folder(context: Context): File {
    val dir = File(context.cacheDir, FOLDER)
    dir.mkdirs()
    return dir
  }

  private fun copy(context: Context, uri: Uri, at: Int, room: Long): Item? {
    if (!foreign(context, uri)) {
      Log.w(TAG, "a shared address that is not another app's content was left out")
      return null
    }
    val resolver = context.contentResolver
    val name = nameOf(resolver, uri, at)
    val mime = resolver.getType(uri) ?: typeOf(uri)
    val target = File(folder(context), "$at-$name")
    var total = 0L

    val read =
      try {
        val stream = resolver.openInputStream(uri)
        if (stream == null) false
        else
          stream.use { source ->
            target.outputStream().use { out ->
              val buffer = ByteArray(STEP)
              while (true) {
                val got = source.read(buffer)
                if (got < 0) break
                total += got
                if (total > room) break
                out.write(buffer, 0, got)
              }
            }
            total <= room
          }
      } catch (error: Exception) {
        Log.w(TAG, "a shared file could not be read: ${error.message}")
        false
      }

    if (!read) {
      target.delete()
      return null
    }

    return Item(name = name, mime = mime, text = null, file = target)
  }

  private fun nameOf(resolver: ContentResolver, uri: Uri, at: Int): String {
    val given =
      try {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { row ->
          if (row.moveToFirst() && !row.isNull(0)) row.getString(0) else null
        }
      } catch (error: Exception) {
        Log.w(TAG, "a shared file would not say its name: ${error.message}")
        null
      }

    return safe(given ?: uri.lastPathSegment ?: "shared-$at")
  }

  private fun safe(name: String): String {
    val kept =
      name
        .takeLast(120)
        .map { letter ->
          if (letter.isLetterOrDigit() || letter == '.' || letter == '-' || letter == '_') letter
          else '-'
        }
        .joinToString("")
        .trimStart('.')

    return if (kept.isBlank()) "shared" else kept
  }

  private fun typeOf(uri: Uri): String {
    val name = uri.lastPathSegment?.lowercase() ?: ""
    val markdown = name.endsWith(".md") || name.endsWith(".markdown")
    return if (markdown) "text/markdown" else "application/octet-stream"
  }

  @Suppress("DEPRECATION")
  private fun foreign(context: Context, uri: Uri): Boolean =
    uri.scheme == android.content.ContentResolver.SCHEME_CONTENT &&
      uri.authority?.substringAfterLast('@')?.startsWith(context.packageName, ignoreCase = true) != true

  private fun stream(intent: Intent): Uri? = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)

  @Suppress("DEPRECATION")
  private fun streams(intent: Intent): List<Uri> =
    intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.filterNotNull() ?: emptyList()
}
