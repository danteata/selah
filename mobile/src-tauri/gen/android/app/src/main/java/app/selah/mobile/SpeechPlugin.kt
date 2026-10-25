package app.selah.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * Voice search on Android. The web view has no Web Speech (the browser's
 * speech recognition), so the app uses Android's own recognizer: one phrase,
 * returned as text. Called from Rust (`speech_listen` / `speech_stop` in
 * src/lib.rs), which the web page invokes.
 */
@TauriPlugin
class SpeechPlugin(private val activity: Activity) : Plugin(activity) {
  private var recognizer: SpeechRecognizer? = null
  private var pending: Invoke? = null

  @Command
  fun listen(invoke: Invoke) {
    activity.runOnUiThread {
      if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
        invoke.reject("Speech recognition isn't available on this phone. Check that the Google app is installed and up to date.")
        return@runOnUiThread
      }
      if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.RECORD_AUDIO), 4021)
        invoke.reject("Allow Selah to use the microphone, then tap the mic again.")
        return@runOnUiThread
      }

      // One phrase at a time: a second tap replaces the first.
      pending?.reject("Stopped")
      recognizer?.destroy()
      pending = invoke

      val r = SpeechRecognizer.createSpeechRecognizer(activity)
      r.setRecognitionListener(object : RecognitionListener {
        override fun onResults(results: Bundle?) {
          val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""
          finish { it.resolve(JSObject().put("text", text)) }
        }

        override fun onError(error: Int) {
          when (error) {
            // Nothing said, or nothing understood: not a failure.
            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT ->
              finish { it.resolve(JSObject().put("text", "")) }
            else -> finish { it.reject(messageFor(error)) }
          }
        }

        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onPartialResults(partialResults: Bundle?) {}
        override fun onEvent(eventType: Int, params: Bundle?) {}
      })

      val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      }
      recognizer = r
      r.startListening(intent)
    }
  }

  /** Stop listening early; the phrase heard so far still comes back. */
  @Command
  fun stop(invoke: Invoke) {
    activity.runOnUiThread {
      recognizer?.stopListening()
      invoke.resolve()
    }
  }

  private fun finish(answer: (Invoke) -> Unit) {
    val invoke = pending ?: return
    pending = null
    answer(invoke)
    recognizer?.destroy()
    recognizer = null
  }

  private fun messageFor(error: Int): String = when (error) {
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
      "Selah can't use the microphone. Allow it in Settings → Apps → Selah → Permissions."
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
      "Voice search needs the internet on this phone. You can type your search instead."
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT ->
      "Speech recognition is busy. Try again in a moment."
    SpeechRecognizer.ERROR_AUDIO -> "The microphone didn't record. Try again."
    else -> "Voice search failed (code $error). You can type your search instead."
  }
}
