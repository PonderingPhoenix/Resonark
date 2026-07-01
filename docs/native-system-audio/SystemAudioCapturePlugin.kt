// Capacitor plugin: requests screen/audio-capture consent (MediaProjection),
// starts the foreground AudioCaptureService, and forwards captured PCM chunks to
// JS as 'pcm' events. Copy into android/app/src/main/java/<yourAppId>/ and adjust
// the package line. Register it in MainActivity (see README).
package com.echovault.app

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.util.Base64
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "SystemAudioCapture")
class SystemAudioCapturePlugin : Plugin() {

    /** Launches the system capture-consent dialog. Resolves once capture starts. */
    @PluginMethod
    fun start(call: PluginCall) {
        val mpm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        startActivityForResult(call, mpm.createScreenCaptureIntent(), "captureResult")
    }

    @ActivityCallback
    private fun captureResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode != Activity.RESULT_OK || result.data == null) {
            call.reject("Capture permission denied")
            return
        }
        // Stream PCM chunks from the service up to JS.
        AudioCaptureService.listener = { bytes, sampleRate, channels ->
            val js = JSObject()
            js.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            js.put("sampleRate", sampleRate)
            js.put("channels", channels)
            notifyListeners("pcm", js)
        }
        val svc = Intent(context, AudioCaptureService::class.java).apply {
            putExtra("resultCode", result.resultCode)
            putExtra("data", result.data)
        }
        ContextCompat.startForegroundService(context, svc)
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        AudioCaptureService.listener = null
        context.stopService(Intent(context, AudioCaptureService::class.java))
        call.resolve()
    }
}
