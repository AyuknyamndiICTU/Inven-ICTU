# Runbook — WhatsApp low-stock alerts (Meta WhatsApp Cloud API)

**Owner:** ICTU (decision Q10 — ICTU owns the WhatsApp Business account). **Status:** waiting for Meta Business verification.

LabPass sends WhatsApp messages only through **pre-approved message templates**, because alerts are business-initiated
(outside the 24-hour customer-service window). Until the account and templates are approved, the WhatsApp channel stays
disabled and alerts go by email (and SMS once a provider is configured). Nothing else in LabPass depends on WhatsApp.

## 1. One-time setup (ICTU administration)

1. Create or reuse the **ICTU Meta Business Portfolio** and complete **business verification** (legal name, address, official
   documents, a domain or phone the business controls).
2. In <https://developers.facebook.com/apps>, create an app of type **Business**, add the **WhatsApp** product, and link the portfolio.
3. Add a **dedicated phone number** for LabPass (not one already used by a WhatsApp app). Verify it by SMS or voice.
   Set the display name to **"ICTU LabPass"** (display names are reviewed by Meta).
4. Create a **System User** (Business settings → Users → System users) with the `whatsapp_business_messaging` permission and
   generate a **permanent access token**. Never use a personal temporary token in production.
5. Note the **Phone number ID** (not the phone number) and the app's **App secret** (App settings → Basic).

## 2. Templates to submit (category: UTILITY, except `labpass_otp`: AUTHENTICATION)

Submit each template in **English (`en`)** and **French (`fr`)**. Variables are positional (`{{1}}`, `{{2}}`, …) and must match the
order below — LabPass sends parameters in exactly this order.

| Template               | Used for                             | Body (en)                                                               | Body (fr)                                                                     | Parameters                 |
| ---------------------- | ------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------- |
| `labpass_low_stock`    | Low-stock alert                      | `Low stock at the Cisco Lab: {{1}} has {{2}} left (alert level {{3}}).` | `Stock faible au laboratoire Cisco : {{1}}, il en reste {{2}} (seuil {{3}}).` | item, available, threshold |
| `labpass_out_of_stock` | Out-of-stock alert                   | `{{1}} is now out of stock at the Cisco Lab.`                           | `{{1}} est en rupture de stock au laboratoire Cisco.`                         | item                       |
| `labpass_test`         | "Send test" in Settings              | `This is a test from ICTU LabPass. Your WhatsApp alerts work.`          | `Ceci est un test d'ICTU LabPass. Vos alertes WhatsApp fonctionnent.`         | —                          |
| `labpass_otp`          | Verifying an admin's WhatsApp number | Meta's authentication template with a copy-code button                  | (same, French)                                                                | code                       |

Record each submission here:

| Template               | Language | Submitted on | Status    | Notes |
| ---------------------- | -------- | ------------ | --------- | ----- |
| `labpass_low_stock`    | en / fr  | _pending_    | _pending_ |       |
| `labpass_out_of_stock` | en / fr  | _pending_    | _pending_ |       |
| `labpass_test`         | en / fr  | _pending_    | _pending_ |       |
| `labpass_otp`          | en / fr  | _pending_    | _pending_ |       |

## 3. Webhook (delivery receipts)

- **Callback URL:** `https://<labpass-domain>/api/webhooks/whatsapp` (must be publicly reachable over HTTPS — see Q13).
- **Verify token:** any long random string; enter the same value in LabPass (Settings → Notifications → WhatsApp).
- **Fields:** subscribe to `messages`.
- LabPass answers Meta's `GET` handshake only when `hub.verify_token` matches, and accepts `POST` callbacks only when
  `X-Hub-Signature-256` is a valid HMAC-SHA256 of the raw body with the **App secret**. Statuses `sent`, `delivered`,
  `read` and `failed` update the delivery log.

## 4. Configure LabPass (SUPER_ADMIN)

Settings → Notifications → WhatsApp (or `PUT /notifications/providers`):

```json
{ "whatsapp": { "enabled": true, "phoneNumberId": "…", "accessToken": "…", "appSecret": "…", "verifyToken": "…" } }
```

Secrets are encrypted at rest (AES-256-GCM with `DATA_KEY`) and are **write-only**: the API never returns them.
Then each admin who wants WhatsApp alerts verifies their number (Profile → WhatsApp → code) and turns WhatsApp on in their
notification preferences. Finally use **Send test** and check the delivery log.

## 5. Operations

- **Token rotation:** generate a new system-user token, save it in LabPass, then revoke the old one in Meta.
- **Template rejected or paused:** messages fail with a template error in the delivery log; alerts still go by email.
  Fix the template in WhatsApp Manager and resubmit; no LabPass change is needed if the name and parameters stay the same.
- **Pausing delivery:** set `enabled: false` (alerts keep flowing to the other channels). Queued jobs are kept.
- **Costs:** Meta charges per delivered template message (utility/authentication rates for Cameroon). Low-stock alerts are
  rate-limited by design: one alert per item until stock recovers above its threshold.
- **Acceptance (S14 gate):** a real low-stock alert must reach a verified admin's WhatsApp, and the delivery log must show `DELIVERED`.
