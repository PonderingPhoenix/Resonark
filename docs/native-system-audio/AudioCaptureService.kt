// Foreground service that captures device playback audio via AudioPlaybackCapture
// (Android 10 / API 29+) and streams 16-bit PCM to a listener. MediaProjection
// capture MUST run in a foreground service. Copy alongside the plugin.
package com.echovault.app

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import androidx.annotation.RequiresApi

@RequiresApi(Build.VERSION_CODES.Q)
class AudioCaptureService : Service() {

    companion object {
        // Set by the plugin; invoked with (pcm16, sampleRate, channels) per chunk.
        var listener: ((ByteArray, Int, Int) -> Unit)? = null
        private const val CHANNEL_ID = "echovault_capture"
        private const val SAMPLE_RATE = 44100
    }

    private var projection: MediaProjection? = null
    private var record: AudioRecord? = null
    @Volatile private var running = false
    private var thread: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(1, buildNotification())
        val resultCode = intent!!.getIntExtra("resultCode", Activity.RESULT_CANCELED)
        @Suppress("DEPRECATION")
        val data = intent.getParcelableExtra<Intent>("data")!!
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        projection = mpm.getMediaProjection(resultCode, data)
        startCapture()
        return START_NOT_STICKY
    }

    private fun startCapture() {
        val config = AudioPlaybackCaptureConfiguration.Builder(projection!!)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(SAMPLE_RATE)
            .setChannelMask(AudioFormat.CHANNEL_IN_MONO)
            .build()
        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT
        )
        record = AudioRecord.Builder()
            .setAudioFormat(format)
            .setBufferSizeInBytes(minBuf * 2)
            .setAudioPlaybackCaptureConfig(config)
            .build()
        record!!.startRecording()
        running = true
        thread = Thread {
            val buf = ByteArray(2048)
            while (running) {
                val n = record?.read(buf, 0, buf.size) ?: -1
                if (n > 0) listener?.invoke(buf.copyOf(n), SAMPLE_RATE, 1)
            }
        }.also { it.start() }
    }

    override fun onDestroy() {
        running = false
        thread?.join(200)
        record?.let { runCatching { it.stop() }; it.release() }
        record = null
        projection?.stop()
        projection = null
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Audio capture", NotificationManager.IMPORTANCE_LOW)
            )
        }
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("EchoVault")
            .setContentText("Capturing system audio")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .build()
    }
}
