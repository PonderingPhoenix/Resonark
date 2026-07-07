# Security Policy

Resonark is a **local-first** app: it has no backend and no accounts, and all
data (your vault) lives only in your own browser's storage. There's no server to
attack and nothing is transmitted without an explicit action by you. The only
optional network call is to Spotify's API, over an opt-in OAuth (PKCE) flow with
no client secret.

## Reporting a vulnerability

If you find a security issue — for example a way to inject script into the page
(XSS), a Content-Security-Policy bypass, or a flaw in the Spotify OAuth handling —
please report it privately:

- Use **GitHub → Security → Report a vulnerability** (private advisory), or
- open a minimal issue that describes the *class* of problem without a working
  exploit, and note you have details to share privately.

Please don't post a working exploit publicly before it's fixed. As a hobby
project there's no bounty, but fixes are taken seriously and credit is given.

## Supported versions

The latest release on the `main` branch is the supported version.
