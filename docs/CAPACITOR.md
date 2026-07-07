# Resonark on mobile (Capacitor)

Resonark is wrapped with [Capacitor](https://capacitorjs.com) so the same web
app can ship as a native **Android** app (and iOS, with the caveat below).

> **What native actually adds.** Resonark already installs to a phone home
> screen as a **PWA** (Add to Home Screen) with offline support. The reason to
> go native is (1) Play Store / App Store distribution and a real app shell, and
> (2) the *possibility* of **true system-audio capture** on Android via a native
> plugin — see [`native-system-audio/`](./native-system-audio/README.md).

## Build & run (Android)

Prerequisites: **Android Studio** (with the Android SDK + a JDK). None of this
runs in CI here — it's a local, on-device workflow.

```bash
npm install
npm run cap:android      # builds the web app, syncs it into android/, opens Android Studio
```

Then in Android Studio press **Run** with a device/emulator selected. Or from
the CLI after `npm run cap:sync`:

```bash
cd android && ./gradlew assembleDebug   # produces app/build/outputs/apk/debug/app-debug.apk
```

Whenever you change the web app, re-sync:

```bash
npm run cap:sync         # npm run build && cap sync
```

## What works in the native app

- **Microphone** capture (`getUserMedia` in the WebView) — the `RECORD_AUDIO`
  permission is declared in the manifest; Android will prompt on first use.
  With "Auto-listen" on, the mic starts on open once granted.
- **File** capture, the visualizers, the vault, analytics, settings — everything
  the web app does.
- The **System** button auto-hides on native (the WebView has no
  `getDisplayMedia`). True system capture is the native-plugin path below.

## iOS

`npx cap add ios` will scaffold an Xcode project and the app runs the same. But
**iOS does not allow third-party apps to capture other apps' audio** (Spotify,
Apple Music, etc.) — Apple's sandbox forbids it, with no workaround. So on iOS
Resonark is mic + file only. The system-audio plugin below is **Android-only**.

## App icons / splash

Capacitor uses the icons under `android/app/src/main/res/mipmap-*`. To regenerate
from a source image, use [`@capacitor/assets`](https://github.com/ionic-team/capacitor-assets):

```bash
npx @capacitor/assets generate --android
```
