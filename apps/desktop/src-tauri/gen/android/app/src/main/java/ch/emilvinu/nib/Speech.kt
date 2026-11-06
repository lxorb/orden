package ch.emilvinu.nib

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import org.json.JSONObject

class Dictation(private val activity: MainActivity) {
  private val MOST_FAILURES = 3

  private var recogniser: SpeechRecognizer? = null
  private var wanted = false
  private var failures = 0

  private var levelSaid = 0L

  fun available(): Boolean = SpeechRecognizer.isRecognitionAvailable(activity)

  private fun allowed(): Boolean =
    activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  fun listen(on: Boolean): Boolean {
    if (!on) {
      wanted = false
      activity.runOnUiThread { stop() }
      return false
    }

    if (!available()) return false

    wanted = true
    failures = 0

    if (!allowed()) {
      activity.askForTheMicrophone()
      return false
    }

    activity.runOnUiThread { begin() }
    return true
  }

  fun allowedNow(granted: Boolean) {
    if (!wanted) return

    if (!granted) {
      wanted = false
      activity.heard(state("refused"))
      return
    }

    activity.runOnUiThread { begin() }
  }

  private fun begin() {
    if (!wanted) return

    val made = recogniser ?: SpeechRecognizer.createSpeechRecognizer(activity)
    recogniser = made
    made.setRecognitionListener(listener)

    val intent =
      Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(
          RecognizerIntent.EXTRA_LANGUAGE_MODEL,
          RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
        )
        .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)

    try {
      made.startListening(intent)
      activity.heard(state("listening"))
    } catch (error: Exception) {
      wanted = false
      activity.heard(state("off"))
    }
  }

  private fun stop() {
    recogniser?.let { one ->
      one.cancel()
      one.destroy()
    }
    recogniser = null
    activity.heard(state("off"))
  }

  private fun again() {
    if (!wanted) return

    recogniser?.let { one ->
      one.cancel()
      one.destroy()
    }
    recogniser = null
    begin()
  }

  private fun state(what: String): String {
    val json = JSONObject()
    json.put("state", what)
    return json.toString()
  }

  private fun words(text: String): String {
    val json = JSONObject()
    json.put("state", "listening")
    json.put("text", text)
    return json.toString()
  }

  private fun partly(text: String): String {
    val json = JSONObject()
    json.put("state", "listening")
    json.put("partial", text)
    return json.toString()
  }

  private fun level(rms: Float): String {
    val json = JSONObject()
    json.put("level", rms.toDouble())
    return json.toString()
  }

  private fun firstOf(results: Bundle?): String =
    results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()

  private val listener =
    object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {}

      override fun onBeginningOfSpeech() {}

      override fun onRmsChanged(rms: Float) {
        val now = System.currentTimeMillis()
        if (now - levelSaid < 100) return
        levelSaid = now
        activity.heard(level(rms))
      }

      override fun onBufferReceived(buffer: ByteArray?) {}

      override fun onEndOfSpeech() {}

      override fun onResults(results: Bundle?) {
        failures = 0
        val said = firstOf(results)

        if (said.isNotEmpty()) activity.heard(words(said))
        again()
      }

      override fun onPartialResults(partial: Bundle?) {
        val said = firstOf(partial)
        if (said.isNotEmpty()) activity.heard(partly(said))
      }

      override fun onEvent(type: Int, params: Bundle?) {}

      override fun onError(error: Int) {
        val quiet =
          error == SpeechRecognizer.ERROR_NO_MATCH ||
            error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT

        failures++
        if (quiet && failures < MOST_FAILURES) {
          again()
          return
        }

        wanted = false
        activity.runOnUiThread { stop() }
      }
    }
}
