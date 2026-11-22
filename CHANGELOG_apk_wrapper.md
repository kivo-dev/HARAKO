# APK wrapper (test builds)

New files only; nothing existing is changed.

- `mobile/` : Capacitor wrapper that opens the HARAKO web app from a server URL.
- `.github/workflows/android-apk.yml` : manual GitHub Actions build of a debug APK.

Limits: needs the site (and backend) reachable from the phone; on plain http the phone's
location (GPS) is blocked by Android WebView; debug-signed, not for stores. NOT TESTED yet.
