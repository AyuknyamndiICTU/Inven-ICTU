# Runbook — LabPass Android app release (APK) and web app

**Owner:** ICTU IT (signing key), lab administrator (publishing). **Design:** ADR-0010.

## 1. One-time: create the signing key (ICTU IT, offline machine)

```powershell
keytool -genkeypair -v -storetype PKCS12 -keystore labpass-release.p12 -alias labpass `
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=ICT University LabPass, O=ICT University, C=CM"
```

Store `labpass-release.p12` and its password in the ICTU safe; give an encrypted copy to the IT director. Never commit it.

## 2. Build a release APK (build PC with Android SDK + JDK 17)

```powershell
cd apps\mobile
$env:EXPO_PUBLIC_API_URL = "https://labpass.ictuniversity.edu.cm/api"
npx expo prebuild --platform android --clean
cd android
.\gradlew.bat :ictu-credential:testDebugUnitTest      # tap-protocol vectors on the Kotlin implementation
.\gradlew.bat assembleRelease `
  -Pandroid.injected.signing.store.file=C:\secure\labpass-release.p12 `
  -Pandroid.injected.signing.store.password=$env:LP_STORE_PW `
  -Pandroid.injected.signing.key.alias=labpass `
  -Pandroid.injected.signing.key.password=$env:LP_KEY_PW
Get-FileHash .\app\build\outputs\apk\release\app-release.apk -Algorithm SHA256
```

## 3. Publish

1. Upload the APK to the server's static downloads folder (e.g. `/downloads/labpass-0.2.0.apk`).
2. Admin console → **Settings → Student app**: set version, URL and SHA-256. Apps on older versions see an update prompt;
   raise **minimum supported version** to force the update.
3. Check `https://<labpass-domain>/download/android` shows the new version, checksum and QR.

## 4. Web app (PWA)

`pnpm --filter @labpass/mobile build` writes `apps/mobile/dist`. It is served at the site root of the LabPass domain,
same origin as `/api` (passkeys and the HttpOnly refresh cookie need this). The service worker updates on the next load.
Regenerate icons after a brand change with `pnpm --filter @labpass/mobile icons`.

## 5. Rollback

- Web: redeploy the previous `dist`.
- Android: put the previous APK back in Settings → Student app (users reinstall it over the bad one), and if a native bug
  is involved raise the minimum supported version once a fixed APK exists.
- Either: revoke affected credentials in Admin → Students.
