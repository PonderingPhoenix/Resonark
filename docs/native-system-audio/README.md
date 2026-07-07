# Native system-audio capture (Android) — template

This folder is a **starting point**, not wired into the build. It captures *all
device audio* (music from Spotify/YouTube/etc.) natively via Android's
`MediaProjection` + `AudioPlaybackCapture` and feeds it into Resonark's existing
analyser, so the visualizer/meter/vault all work on streamed audio with no mic.

> ⚠️ **Read first**
> - **Android 10 (API 29)+ only.** `AudioPlaybackCapture` doesn't exist before that.
> - Android still shows a **one-time capture-consent dialog per session** (the
>   screen-capture prompt). There's no fully silent capture — that's an OS rule.
>   After consent it runs in a **foreground service** (persistent notification).
> - **Apps can opt out.** An app that sets `allowAudioPlaybackCapture="false"`
>   (some do) **cannot** be captured — you'll get silence for it. Most music apps
>   allow it; verify with the one you use.
> - **iOS cannot do this at all** (Apple sandbox). Android only.
> - This is **unverified device code** — it compiles against the Android SDK you
>   build with; expect to iterate in Android Studio.

## How it fits together

```
MediaProjection consent ─▶ AudioCaptureService (foreground)
        │                        │  AudioRecord(playback-capture) → PCM 16-bit
        │                        ▼
  SystemAudioCapturePlugin ──emits 'pcm' events──▶  native-source.js (JS)
                                                          │ decode → Float32
                                                          ▼
                                            AudioWorklet (pcm-worklet.js)
                                                          │  outputs samples
                                                          ▼
                                            AnalyserNode  ← the app's existing
                                            pipeline (viz / meter / recorder)
```

The PCM is pushed through an `AudioWorkletNode` into the **same `AnalyserNode`**
the rest of the app already reads, so nothing downstream changes.

## Steps

1. **Copy the native files** into the Android project:
   - `SystemAudioCapturePlugin.kt` → `android/app/src/main/java/com/echovault/app/`
   - `AudioCaptureService.kt` → same folder
   Adjust the `package` line if your `appId` differs from `com.echovault.app`.

2. **Register the plugin** in `MainActivity.java`:
   ```java
   package com.echovault.app;
   import android.os.Bundle;
   import com.getcapacitor.BridgeActivity;
   public class MainActivity extends BridgeActivity {
     @Override public void onCreate(Bundle savedInstanceState) {
       registerPlugin(SystemAudioCapturePlugin.class);
       super.onCreate(savedInstanceState);
     }
   }
   ```

3. **Manifest** — add to `android/app/src/main/AndroidManifest.xml`:
   ```xml
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
   <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION" />
   <!-- inside <application> -->
   <service
       android:name=".AudioCaptureService"
       android:foregroundServiceType="mediaProjection"
       android:exported="false" />
   ```
   Set `minSdkVersion` to **29+** in `android/variables.gradle`.

4. **Web side** — copy `native-source.js` into `src/audio/` and
   `pcm-worklet.js` into `public/` (so it's served at `/pcm-worklet.js`). Then in
   `src/audio/AudioEngine.js` add a `useNativeSystemAudio()` method that calls
   `startNativeSource(this.ctx, this.analyser)` from `native-source.js` (see the
   header of that file). Wire a source button that calls it, gated on
   `Capacitor.isNativePlatform() && Capacitor.Plugins.SystemAudioCapture`.

5. **Build & test on a device** (`npm run cap:android`). Play music in another
   app, tap the native-capture source, accept the consent prompt, and the meter
   should light up from the *clean digital* stream.

## Notes / gotchas

- Bridge bandwidth: PCM is base64'd over the JS bridge (~120 KB/s at 44.1 kHz
  mono). Fine for a visualizer; if you want lower overhead, do the FFT natively
  and emit 64 band bytes per frame instead (a smaller change to `AudioEngine`).
- Capture path: a native-captured session is a clean pre-speaker digital signal,
  so treat it like `capturePath: 'system'` (reference-eligible) in the recorder.
- Stop the service when switching away, and on app pause, to drop the
  notification and release `AudioRecord`.
