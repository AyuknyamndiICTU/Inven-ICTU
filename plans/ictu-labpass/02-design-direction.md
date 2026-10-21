# ICTU LabPass — Design & Motion Direction

> Companion to [00-blueprint.md](./00-blueprint.md). Steps cite this file as `DESIGN §n`.
> Built with the ECC `frontend-design-direction` method (evidence contract → build → rendered finish gate)
> and the `motion-foundations` / `motion-patterns` / `motion-advanced` token rules.
> Reference frames live in [references/](./references/). They are for internal reference only and must never ship in an app.

## §1 Direction in one line

**Theatre at the kiosk, precision in the admin, intimacy on the phone.**
Each surface is futuristic in a different way, sized to how often it is used.

| | Kiosk (Cisco lab PC) | Admin console | Student mobile |
|---|---|---|---|
| Job | Identify a student in < 1 s, then borrow or return in 3 taps | Keep stock correct, react to alerts, approve credentials | Hold a credential; see my loans |
| Audience | Students in a hurry, standing, often in groups | Lab admin and assistants, every day, on a desktop | Students, on budget Android phones and iPhones |
| Tone | Cinematic, dark, luminous, big type | Calm, light, dense, scannable (HorizonX light) | Personal, tactile, card-centred |
| Memorable detail | The **Reader Eye**: a dark orb whose cyan slit opens into a horizon when you tap | The **Stock Skyline**: live bars with light-edged tops | The **Pass Card**: tilts with the phone and glows when tapped |
| Motion budget | Expressive (theatre ≤ 900 ms, never blocking input) | Subtle (≤ 240 ms, no ambient loops in tables) | Medium (springs, haptics) |
| Theme | Dark only | Light default + dark | Follows the system setting |

## §2 Reference observations → decisions (evidence contract)

| Ref frame | Observation | Decision | Used in |
|---|---|---|---|
| `v2-02.5s-orb-cyan-slit-debris` | A matte black sphere with a horizontal cyan light slit, floating rock debris at several depths, and wide tracked caps ("ELEVATE YOUR SOUND") | **Reader Eye** idle orb (A1) with slow drifting equipment silhouettes (router, switch, cable spool) for parallax depth | Kiosk attract |
| `v2-10.0s-pedestal-ring-landing`, `v2-09.0s-descend-through-clouds` | The camera descends and the object lands on a lit pedestal ring | **Identity Rise** (A3) and **Ring Landing** (A6): the student card and the success check land on a light ring | Kiosk identify and success |
| `v2-07.5s/08.0s-mask-reveal` | A headline rises line by line from a clipping mask | Mask-up text reveal for names and headings (A3) | Kiosk, admin login |
| `v2-03.5s`, `v2-06.0s`, `v2-06.5s` | The product overlaps giant or outlined type, creating a depth sandwich | **Depth Type** (A9): an outlined "CISCO LAB" word sits behind the orb | Kiosk attract, admin login |
| `hx-01-hero-fanned-cards`, `v1-03.3s` | Five rotated, overlapping cards with soft shadows | **Fanned Cart** (A4): the borrow cart fans out like a hand of cards | Kiosk sign-in cart, mobile onboarding |
| `v1-11.0s-realtime-skyline-bars` | Black bars of varying height with glowing specular top edges ("Built for real-time decisions") | **Stock Skyline** (A5): stock per item or category; the edge colour encodes health | Admin dashboard, kiosk availability strip |
| `v1-10.0s-particle-converge` | Blue, purple and gold particles converging in a WebGL scene | Particles converge into the success check (A6), limited to 600 particles on the GPU | Kiosk success only |
| `hx-02-capsule-nav-bento-steps` | Floating pill nav with blur; 1 px-bordered bento cells; numbered circles; generous whitespace | **Capsule Nav** (A7) and bento dashboard cells | Admin shell |
| `hx-03-footer-horizon-glow` | Film grain plus a radial horizon glow at the bottom of a dark panel | **Horizon Glow** (A10), recoloured to Signal cyan and ink (not purple) | Kiosk background, admin login |
| `v1-04.3s`, `v1-08.1s` (grid paper) | Light graph-paper background behind floating UI frames | Grid-paper texture (24 px) with radial fade | Admin empty states, mobile onboarding |
| Scene cuts in both videos | Scenes change through blur, scale and fade | **Blur Push** (A8) stage transitions | Kiosk stages |
| HorizonX reviews marquee (55 s loop) | A slow, endless ticker | **Live Ticker** (A11): recent equipment movements, with **no student names** | Kiosk idle footer |
| HorizonX computed styles | Inter; h1 49 px/700 at −0.05 em; h2 −0.04 em; text #171717; capsule buttons (radius 48 px) | Typography and radius tokens in §3 | All |

Anti-patterns rejected on purpose: purple-gradient blobs (we use Signal cyan on ink instead), cards inside cards,
marketing hero copy inside tools, and ambient animation in data tables.

## §3 Tokens (`packages/design-tokens/tokens.json` → CSS vars, Tailwind v4 theme, RN theme)

**Colour**
| Token | Value | Notes |
|---|---|---|
| `ink-950 / 900 / 800 / 700` | `#07080A / #0E1014 / #171A20 / #22262E` | Kiosk surfaces |
| `paper-0 / 50 / 100` | `#FFFFFF / #FAFAF9 / #F3F3F1` | Admin surfaces |
| `text-strong` | `#171717` (light) / `#F5F6F7` (dark) | Copied from HorizonX primary |
| `text-muted` | `#6B6F76` / `#9AA0A8` | Must still meet AA on its background |
| `line` | `#E7E6E3` / `rgba(255,255,255,.08)` | 1 px borders and grid paper |
| `signal-300 / 500 / 700` | `#7FE3FF / #00A3E0 / #00739E` | Brand light (a nod to Cisco blue). Use **700 for text on light** (500 fails AA) |
| `ok / low / out` | `#12B76A / #F5A524 / #F04438` | Stock health. Always paired with an icon and a label |
| `ictu-*` | TBD | Fill in from the ICTU brand guide; Signal remains the "light" colour |

**Type.** Inter (UI) · **Unbounded** (kiosk/display caps, +0.02 em) · JetBrains Mono (matricules, codes, counts, `tabular-nums`).
All fonts are self-hosted through `@fontsource` so the kiosk works offline.
Scale: 12 · 13 · 14 · 16 · 18 · 22 · 28 · 36 · 49 · 72 (kiosk) · 120 (kiosk depth type).
Tracking: display −0.05 em, h2 −0.04 em, body −0.01 em.

**Shape and depth.** Radius: `pill 999` (buttons, nav, chips) · `card 24` · `field 14` · `tile 18`.
Levitation shadow: a separate blurred ellipse under floating cards (taken from video 2), not a box shadow.
Glass: `backdrop-blur 16px` + `white/6` fill + 1 px `line`, used only for overlays and the nav.
Spacing uses a 4 px base. Kiosk touch targets are at least 56 px; admin and mobile targets are at least 44 px.

## §4 Motion system (`packages/motion`, the single source of truth)

| Token | Value |
|---|---|
| duration | `instant 0.1 · fast 0.16 · normal 0.24 · slow 0.4 · theatre 0.9` (s) |
| easing | `smooth [0.22,1,0.36,1] · emphasized [0.2,0,0,1] · exit [0.4,0,1,1]` |
| springs | `snappy {stiffness 500, damping 32}` · `gentle {260, 26}` · `lift {180, 20, mass 1.1}` |
| stagger | 0.06 (allowed range 0.05–0.10) |
| distance | `sm 8 · md 16 · lg 32 · xl 64` px |

The web uses `motion/react` and the mobile app uses Reanimated 3 + Skia, both with the **same token values**.
Every animation has an `exit`. `useSafeMotion` replaces movement with an opacity crossfade when
`prefers-reduced-motion` is set. On mobile, the equivalent is `AccessibilityInfo.isReduceMotionEnabled`.
The kiosk also has an admin setting, `kiosk.motionLevel = full | reduced | minimal`, for weak GPUs.

### Signature animations (steps refer to these IDs)
| ID | Name | Choreography | Fallback |
|---|---|---|---|
| A1 | Reader Eye | The orb's slit "breathes" (scaleX 0.86↔1, glow opacity 0.6↔1, 3.2 s loop). Silhouettes drift at 3 depths (parallax 4/8/14 px), and an outlined "CISCO LAB" word sits behind (A9). OGL shader for the orb lighting and grain | CSS radial gradients and a static PNG poster |
| A2 | Horizon Sweep | **Fires on the reader event, before the API answers.** The slit grows to a full-width horizon line (scaleX→1, 0.22 s emphasized). A glow pulse and an optional chime play. The status capsule reads "Reading…" | A colour flash only |
| A3 | Identity Rise | When the API replies, the student card rises from the horizon (y 48→0, spring `lift`) over a light ring. The photo un-blurs. The name appears through a mask-up reveal (lines staggered 0.06), and the matricule shows in mono. **Readable within 300 ms; done within 700 ms** | Fade |
| A4 | Fanned Cart | An item picked from the combobox flies into the cart (`layoutId`). Cards fan out at −10°…+10° with a 28 px overlap. Removing one drops it (y+40, fade). With more than 5 items the stack collapses into a count badge | Plain list |
| A5 | Stock Skyline | Bars ease to new heights with spring `gentle` on websocket updates. The top edge carries a specular gradient. The edge is `ok`/`low`/`out`, and `out` pulses once (it does not loop) | Static bars |
| A6 | Ring Landing | The ring lands (scale 1.2→1, 0.4 s). The check path draws (0.3 s). Up to 600 GPU particles converge into the check (0.9 s total). A receipt slides up. The "New tap in 8 s" capsule counts down | Check icon and text |
| A7 | Capsule Nav | The pill nav condenses on scroll (height 64→52, blur on). The active-tab pill slides with `layoutId` | Instant |
| A8 | Blur Push | The outgoing stage goes to scale 0.98, blur 8 px, opacity 0. The incoming stage comes from scale 1.02 with blur. 0.28 s, `mode="wait"` | Crossfade |
| A9 | Depth Type | Giant outlined Unbounded word layered behind the hero object, with slight parallax opposite to the pointer or drift | Static |
| A10 | Horizon Glow | Grain texture plus a radial Signal glow rising from the bottom edge, with a 12 s slow drift | Static gradient |
| A11 | Live Ticker | Marquee of "Router 2911 returned · 2 min ago" items; 60 s loop; pauses on hover or focus | Static list |
| A12 | Pass Card (mobile) | Skia sheen follows the gyroscope (±6° tilt). A successful tap or scan triggers a haptic, a ring pulse and "Signed at Cisco Lab". In **Scan kiosk** mode, a reticle locks onto the QR with a quick spring snap | No tilt |
| A13 | Live Challenge QR (kiosk) | The kiosk's challenge QR sits inside a glass tile below the orb. On each refresh, the modules dissolve and reform (0.3 s). A thin countdown ring around it shows the remaining TTL | Instant swap |
| E1 | Slit Flicker (error) | The slit turns `out` red, does a 3 × 6 px shake, and shows an error capsule with the next action | Colour, icon and text only |

Rules: theatre must **never delay input**. During A3 and A6 the next actions are already focusable. All WebGL runs on one
shared canvas per surface, pauses on `visibilitychange`, and is skipped when `detect-gpu` reports tier 0–1.

## §5 Screen inventory

**Kiosk** — K1 Attract (A1, A9, A10, A11, plus the A13 "Scan with LabPass" challenge QR) · K2 Reading (A2) · K3 Student (A3: photo, name, matricule, programme,
open loans with due status, and two large actions **Sign In** / **Sign Out**) · K4 Sign In: searchable combobox
grouped by category with image, live availability and a quantity stepper → fanned cart (A4) → confirm · K5 Sign Out:
the student's open loan lines only, with qty and condition OK/Damaged · K6 Success (A6, receipt, auto-reset) ·
K7 Manual matricule (on-screen keypad plus the physical keyboard → name + photo → PIN, OTP or assistant confirmation according to policy, ARCH §5 F4) · K8 Unknown card → link
card · K9 Blocking states (reader unplugged, student inactive/suspended, out of stock, overdue block, offline read-only lock).
The **K9-offline** variant is not blocking: when the API is unreachable, an amber "Offline — loans will sync" capsule replaces the status capsule,
the orb's slit turns amber, a pending-sync counter is shown, and manual entry asks for assistant confirmation (ARCH §5 F9).
K10 Assistant overlay (PIN), which reaches the hidden kiosk settings. Inactivity timeout: 45 s → K1.

**Admin** — Login + TOTP (A9, A10) · Dashboard: KPI counters (items out, overdue, low stock, active students today),
Stock Skyline (A5), live activity feed, low-stock list, kiosk status · Inventory: table (TanStack) with category chips,
search, inline status, an **Adjust stock** drawer (+/−, reason, preview of the new total/available) and an equipment detail
with movement timeline and image · Loans: open/overdue, force-return, export · Students: search and profile
(credentials, cards, loans) · Import wizard: upload → map → dry-run diff → commit · Credential requests: queue with
a per-field diff, approve/reject · Alerts: global and per-item thresholds, channels per admin (Email/SMS/WhatsApp),
quiet hours, a test send button, delivery log · Settings: Sign In/Out labels, manual-entry policy, due policy,
max items, retention, language · Kiosks: register (code) and status · Users & roles · Audit log · Reports.

**Mobile** — Onboarding (fanned cards on grid paper) · Enroll (matricule, names, DOB) · OTP · Secure key
(biometric prompt) · Pending / Approved / Rejected · **Pass** (A12). It has two modes: **Tap** on NFC Android, with a mini Reader Eye
and "Hold near the reader", and **Scan kiosk** on any phone, which opens the camera with a reticle. The offline fallback shows a response QR
for the kiosk webcam. Other screens: My loans (due countdown) · History · Profile (language, manual-entry PIN, lost phone → revoke).

## §6 Content-state contract (must be exercised in S13's finish gate)

| State | Kiosk | Admin | Mobile |
|---|---|---|---|
| Loading | A2 sweep plus the card skeleton; tap again is ignored for 1.5 s | Skeleton shimmer with stable table geometry | Skeleton Pass card |
| Empty | "No open loans — nothing to return" with a Sign In shortcut | Grid-paper empty state with a primary action (e.g. "Add first equipment") | "No loans yet" |
| Error | E1 plus a specific message and next action (retry / use matricule / call assistant) | Inline problem+json message with a field highlight and retry | Retry; offline banner |
| Partial | The student is shown but loan history failed: banner "History unavailable", actions still allowed. **Offline mode**: amber capsule, receipts marked "Offline — will sync" | Widgets fail independently, each with its own retry | Cached Pass shown, plus "Last synced …" |
| Success | A6 plus a receipt; screen resets | Toast with **Undo** for stock adjustments within 10 s | Haptic plus a ring pulse |
| Permission | Student SUSPENDED/INACTIVE → explanation and "See lab assistant" | Role-gated pages show a lock screen naming the required role | Credential revoked → re-enroll flow |

## §7 Accessibility & performance budgets

- WCAG 2.2 AA. Focus rings use a 2 px Signal outline with an offset. A kiosk `aria-live` region says "Welcome, {first name}".
  Stock health is never shown by colour alone. Language toggle EN/FR is on every surface (`i18n-sync`).
- Kiosk: card/phone present → A2 feedback **≤ 100 ms**; tap → student readable **≤ 800 ms p95** on the LAN;
  phone scan → kiosk shows the student **≤ 1.5 s p95** (depends on the phone's network); 60 fps on the target lab PC
  (assumed Intel UHD 620-class GPU; confirmed in S01, gated in S11); memory stable over a 12 h soak.
- HCE metrics, measured separately:
  - (a) phone APDU handling: SIGN processed **≤ 150 ms**;
  - (b) full SELECT+SIGN exchange at the reader: **p95 ≤ 400 ms**;
  - (c) end-to-end: the 800 ms target above.

  The ≥ 98 % success gate applies to **unlocked** phones. A locked phone must never produce a signature.
- Admin: LCP ≤ 2.0 s and INP ≤ 200 ms on the campus network; route JS ≤ 250 KB gzip; WebGL only on login and the dashboard, lazy-loaded.
- Mobile: cold start ≤ 2.5 s on a mid-range Android (Tecno/Infinix class); Pass screen at 60 fps; camera ready ≤ 1 s in Scan kiosk mode.

## §8 Finish gate (per UI step, then again in S13)

1. Render the target viewports: kiosk `1920x1080` and `1366x768`; admin `1440x900` and `390x844`; mobile `390x844` and `360x800`.
2. Exercise every §6 state. Check keyboard navigation, focus, contrast, reduced motion and long FR strings.
3. Save screenshots to `docs/evidence/<surface>/` and write `evidence.json`. Run `pnpm evidence:check <surface>`.
   This root script (from S02) wraps the ECC checker at
   `$env:USERPROFILE\.copilot\skills\frontend-design-direction\scripts\check-evidence.js`.
4. Run the ECC `make-interfaces-feel-better` review pass.
   - **Web surfaces** (admin, kiosk renderer, ui-kit): also run `browser-qa` (Playwright) for console errors and Web Vitals.
   - **Mobile**: capture screenshots with Maestro, run accessibility checks with `@testing-library/react-native` role/label queries, and do a manual TalkBack + VoiceOver pass.
