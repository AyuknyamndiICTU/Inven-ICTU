# Runbook — LabPass kiosk (Cisco lab PC)

**Owner:** lab administrator, with ICTU IT for installation and certificates. **Applies to:** `apps/kiosk` (S11).

The kiosk is an Electron app in Windows kiosk mode. It talks to the reader through PC/SC (ADR-0002) and to the
LabPass API over HTTPS. The device token is stored with Windows DPAPI (`safeStorage`) and never reaches the screen
process. The renderer makes no network requests at all.

## 1. Install

1. Install the **ACS ACR1252U driver** (PC/SC) from ACS, plug the reader in, and check that _Smart Card_ service is running
   (`Get-Service SCardSvr` → `Running`, startup type _Automatic_).
2. Create a **restricted local Windows account** (e.g. `labpass-kiosk`) with automatic sign-in. Do not give it admin rights.
3. As an administrator, run `LabPass-Kiosk-Setup-<version>.exe` (per-machine install). The app starts at sign-in.
4. Power settings: never sleep, never turn off the display during lab hours; disable Windows Update active-hours restarts.
5. Optional environment (system variables, set by IT):
   | Variable               | Purpose                                                         |
   | ---------------------- | --------------------------------------------------------------- |
   | `LABPASS_API_URL`      | Default server, e.g. `https://labpass.ictuniversity.edu.cm/api` |
   | `LABPASS_ALLOW_HTTP=1` | Only if the server is on the LAN without TLS (pilot only, Q13)  |
   | `LABPASS_KIOSK_MODE=0` | Maintenance: run windowed                                       |

## 2. Register the kiosk (first run, or after "Unregister")

1. Admin console → **Kiosks** → _Register kiosk_ → name + location → a one-time code and its QR code appear.
2. On the kiosk's _Register this kiosk_ screen, type the code (or press _Scan the admin QR_ and show the QR to the webcam).
3. Choose a **6-digit service PIN** for the lab assistants. Write it in the lab safe, not on the PC.
4. The kiosk shows the attract screen with the live QR. In Admin → Kiosks it appears **online** with the reader status.

## 3. Lab-assistant overlay (K10)

Press and hold the **LabPass logo** (top left) for 2 seconds, then type the service PIN (5 wrong PINs lock it for 5 minutes).
Actions: _Restart card reader_, _Reload screen_, _Unregister this kiosk_, _Exit kiosk mode_.

## 4. Card reader troubleshooting

| Symptom                                 | Action                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Red capsule "Card reader not connected" | Replug the USB cable → wait 5 s. Still red: overlay → _Restart card reader_.                         |
| Phones tap but nothing happens          | Ask the student to **unlock** the phone; HCE never answers while locked.                             |
| "This phone has no LabPass credential"  | The LabPass Android app is not enrolled on that phone; use the card, matricule, or _Scan-the-Kiosk_. |
| Reader keeps going to ERROR             | Check `Get-Service SCardSvr`; reinstall the ACS driver; read the log (below).                        |

Logs: `%APPDATA%\LabPass Kiosk\logs\kiosk.log` (rotating, 3 × 1 MB). They contain event codes only, never names,
matricules, card UIDs or tokens.

## 5. Updates (decision Q12)

- **Signed builds + update channel:** only when ICTU IT provides an Authenticode certificate and an HTTPS, allow-listed,
  versioned update feed. Until then auto-update is **off** (`publish: null` in `electron-builder.yml`).
- **Manual update (current procedure):**
  1. Download the new installer from the release page; verify its SHA-256 against the release notes
     (`Get-FileHash .\LabPass-Kiosk-Setup-<v>.exe -Algorithm SHA256`).
  2. Overlay → _Exit kiosk mode_. Sign in as an administrator. Run the installer (it upgrades in place; registration and
     the service PIN are kept in `%APPDATA%`).
  3. Sign back in as `labpass-kiosk`; check the version in the overlay and the kiosk status in the admin console.
- The API can force old kiosks to update with **Settings → minimum supported version**.

## 6. Rollback

Keep the previous installer next to the current one. To roll back, exit kiosk mode and run the previous installer
(NSIS installs over a newer version when run explicitly). Kiosks are never updated from an unpromoted build.

## 7. Revocation and re-registration

- If a kiosk PC is lost or replaced: Admin → Kiosks → **Revoke**. The kiosk wipes its token immediately (socket event)
  or at the next heartbeat (≤ 30 s) and returns to the registration screen.
- To move a kiosk: overlay → _Unregister this kiosk_, then register again with a new code.

## 8. Development and demos without hardware

`pnpm --filter @labpass/kiosk dev` uses the **FakeReader**. A "Simulated reader" panel (development builds only) can
place a card, an unknown card, an unlocked or locked phone, a phone without LabPass, or unplug the reader.
`pnpm --filter @labpass/kiosk test:e2e` runs the same scenarios against an in-memory API.
