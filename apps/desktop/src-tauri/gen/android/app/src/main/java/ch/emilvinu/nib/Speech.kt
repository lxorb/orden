package ch.emilvinu.nib

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import org.json.JSONObject

/**
 * The phone's own speech recogniser, writing into the note.
 *
 * The web's `SpeechRecognition` is Chrome's and not the webview's, so a page in
 * this app has no dictation of its own; this is the same feature through the API
 * Android hands every app. What comes back is words, and the page puts them where
 * the caret is - the same place a paste lands - so there is nothing new on screen
 * except the mark that says it is listening.
 *
 * It listens in turns, because that is what Android offers: the recogniser ends
 * each time the speaker pauses, and it is started again while dictation is still
 * on. Errors that mean "nothing was said" are part of that rhythm and are not
 * reported; anything else stops it, so a recogniser that cannot work does not sit
 * there restarting itself against the battery.
 */
class Dictation(private val activity: MainActivity) {
  /** How many failures in a row are a rhythm, and how many are a fault. */
  private val MOST_FAILURES = 3

  private var recogniser: SpeechRecognizer? = null
  private var wanted = false
  private var failures = 0

  /** Whether this phone has a recogniser at all. Asked before the row is offered
   *  rather than after it is pressed. */
  fun available(): Boolean = SpeechRecognizer.isRecognitionAvailable(activity)

  /** Whether the microphone has been granted to the app. */
  private fun allowed(): Boolean =
    activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  /**
   * Turns dictation on or off. Answers whether it is on afterwards, which is
   * false when the microphone has still to be asked for: the page hears about the
   * answer through `heard` instead, once the reader has given one.
   */
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

  /** Called when the reader has answered the microphone question. */
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
        // No language of its own: whatever the phone is set to is the language
        // its owner is about to speak.
        .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)

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

  /** One turn ended. Another is started while dictation is still wanted, which is
   *  how a pause between sentences does not end it. */
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

  private val listener =
    object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {}

      override fun onBeginningOfSpeech() {}

      override fun onRmsChanged(rms: Float) {}

      override fun onBufferReceived(buffer: ByteArray?) {}

      override fun onEndOfSpeech() {}

      override fun onResults(results: Bundle?) {
        failures = 0
        val said =
          results
            ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            ?.firstOrNull()
            .orEmpty()

        if (said.isNotEmpty()) activity.heard(words(said))
        again()
      }

      override fun onPartialResults(partial: Bundle?) {}

      override fun onEvent(type: Int, params: Bundle?) {}

      override fun onError(error: Int) {
        // Nothing said, or a pause long enough to end the turn. Both are the
        // rhythm rather than a fault, up to a point: a recogniser that answers
        // this immediately, over and over, is one that is not going to work.
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
