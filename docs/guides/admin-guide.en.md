# LabPass — Administrator guide

_Version 1.0 · ICT University Cisco Lab · Français : [admin-guide.fr.md](./admin-guide.fr.md)_

LabPass records who borrows which equipment in the Cisco lab:

- Students identify at the **kiosk** (the lab PC with the card reader) with their ICTU card, their Android phone, the LabPass app's QR code, or their matricule.
- They then choose what they borrow or return.
- You manage everything from the **admin console** at `https://admin.<lab domain>`.

## 1. Signing in

1. Open the admin console and enter your email and password.
2. Enter the 6-digit code from your authenticator app (Google Authenticator, Microsoft Authenticator, Aegis…). At your first sign-in you scan a QR code to set it up. Then change the temporary password under **My profile**.
3. Sessions end after inactivity. Never share your account: every action is written to the **Audit log** under your name.

Press **Ctrl K** (⌘K on Mac) anywhere to search for a page, a student or an item.

## 2. Roles

| Role          | Can                                                                              |
| ------------- | -------------------------------------------------------------------------------- |
| Super admin   | Everything, including **Settings**, **Users** and the "No verification" option   |
| Lab admin     | Equipment and stock, students, imports, requests, loans, alerts, reports, kiosks |
| Lab assistant | Loans, requests, and confirming matricule entries at the kiosk                   |
| Viewer        | Read-only: dashboard, inventory, loans and reports                               |

## 3. Daily work

### Dashboard

Shows live counts: items on loan, overdue loans, low-stock items, kiosk status, and recent activity. It updates by itself. The dot in the top bar is green while the live connection works.

### Inventory: equipment and stock

- **Add equipment:** Inventory → _Add equipment_. Enter:
  - **name** and **code** (the label on the item or shelf, e.g. `CBL-CONSOLE-USB`);
  - **category**;
  - starting **quantity**;
  - optional **alert level**.
- **Adjust stock:** open the item → _Adjust stock_. Choose the type of change and enter the quantity and a **reason**:
  - **Restock**: new purchase, or units found;
  - **Write off**: lost, broken beyond repair, retired;
  - **Correction**: after a physical count.

  Stock is never edited directly; every change is a recorded movement, so the history always adds up.

- Units on loan cannot be written off. Record the return first, with condition _Lost_ or _Damaged_ if needed.

### Loans

- **Open** shows what is out now, **Overdue** what is past its due time, and **Returned** the history.
- _Record return_: use it when equipment comes back without the student going through the kiosk (e.g. found on a bench). Choose the condition of each item (Good, Damaged or Lost) and give a reason.

### Requests

- **Phone passes:** students who ask to use their phone as a lab card. Requests whose details match the school records exactly are **approved automatically**. The others wait here:
  - compare _Entered by the student_ with _School records_;
  - where they differ, check the student's ID card in person before approving;
  - a rejection reason is sent to the student.
- **Card links:** a card that was not in the supplier's batch file and was linked at the kiosk by a student. Approve it after checking the student's ID card.

### Students and imports

- **Students** shows each student's status, card, phone pass and open loans. Open a student to:
  - _Reset PIN_ (manual-entry PIN);
  - _Link a card_ or _Unlink_ one (lost card);
  - _Revoke_ a phone pass (lost phone).

  A student's status (Active / Inactive / Suspended) comes from the school records import.

- **Import:**
  - Upload the registrar's CSV or Excel file (French or English headers). Use _Download template_ for the expected columns.
  - Check the preview (New / Changed / Unchanged / Problems), then _Import_.
  - _Undo import_ reverses the last import.
  - The same page configures the automatic **school system connector** when IT provides one.
- **Card batch from the supplier:** import the supplier's file (card number ↔ matricule) so that cards work on the first tap.

### Kiosks

- **Register a kiosk:**
  1. Click _Register a kiosk_ and give it a name and location.
  2. Type the code on the kiosk, or scan the QR code shown. The code works once and expires in 10 minutes.
- The list shows each kiosk as online or offline, its last-seen time, reader state and app version. _Revoke_ immediately stops a stolen or retired PC.

### Offline sync

If the server was unreachable, the kiosks keep lending (for up to the hours set in Settings) and send their records when it comes back. Loans that could not be applied automatically appear in **Offline sync**:

- _Accept_ records what physically happened. For stock conflicts the stock is corrected first, so availability never goes negative.
- _Void_ records nothing. Use it when the transaction did not happen or cannot be trusted.

## 4. Alerts and notifications

**Alerts & notifications**:

- **Global alert level:** alert when available units fall to this number or below. Each item can override it (_Per-item alert levels_).
- **How I receive alerts:** choose email, SMS, WhatsApp and/or push for low stock, out of stock and phone pass requests.
  - Phone numbers must be verified with a code first.
  - _Send test_ checks a channel.
- **Quiet hours:** low-stock alerts wait until quiet hours end. Out-of-stock alerts are always sent. _Group low-stock alerts_ sends one digest instead of many messages.
- **Providers** (super admin):
  - the SMS gateway (_Test mode_ sends nothing real);
  - the WhatsApp Cloud API settings (see the WhatsApp runbook).

  Saved secrets are never shown again; leave the field empty to keep them.

- **Delivery log:** every message, its status and its attempts.

## 5. Settings (super admin)

| Setting                                   | Recommended                                                   | Notes                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Matricule entry without a card            | Student PIN or lab assistant                                  | "No verification" lets anyone borrow in another student's name; such loans are flagged.                     |
| When loans are due                        | At lab closing time                                           | Or after a number of hours                                                                                  |
| Maximum items per student                 | 3–5                                                           |                                                                                                             |
| Students with overdue items cannot borrow | On                                                            |                                                                                                             |
| Return to the start screen after          | 30 s                                                          | Kiosk privacy timeout                                                                                       |
| Animations                                | Full (Reduced/Minimal on slow PCs)                            |                                                                                                             |
| Card security                             | Card number only → Secure check when the DESFire cards arrive |                                                                                                             |
| Offline lending allowed for               | 8 hours                                                       | 0 disables offline lending                                                                                  |
| Keep loan history for                     | 24 months                                                     | The agreed retention period. v1 stores it; automatic purging is enabled after the data-protection sign-off. |
| Minimum phone app version                 | Latest release                                                | Older Android apps are asked to update                                                                      |

**My kiosk assistant PIN** (all assistants): the PIN you type at the kiosk to confirm a student's matricule entry.

## 6. Users (super admin)

- _Add user_: give a name, email, role and a temporary password (12+ characters). Hand the password over in person.
- _Reset 2-step_: the user lost their phone; they enrol a new authenticator at next sign-in.
- _Deactivate_: the user's sessions end immediately.

## 7. Reports and audit

- **Reports** cover a date range: most borrowed items, loans per day, busiest hours, number of different students. _Export CSV_ for any table.
- **Audit log** records every administrative action: who, when, what changed. Secrets and PINs are never shown.

## 8. When something goes wrong

| Problem                                  | What to do                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Kiosk shows "Card reader not connected"  | Replug the reader. Students can still use the matricule or the app's QR code.                           |
| Kiosk shows "LabPass server unreachable" | Lending continues offline. Tell IT; check Offline sync afterwards.                                      |
| A student's card is unknown              | The student can link it at the kiosk (with their matricule); approve the link in Requests → Card links. |
| Stock looks wrong                        | Check the item's movement history; correct with _Adjust stock_ → correction, with a clear reason.       |
| Lost authenticator                       | Ask another super admin to _Reset 2-step_.                                                              |

Technical procedures for IT (installation, backups, monitoring, keys) are in [`docs/runbooks`](../runbooks/README.md).
