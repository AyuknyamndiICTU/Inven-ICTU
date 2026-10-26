/// <reference lib="dom" />
import { _electron as electron, type ElectronApplication, expect, type Page, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {} from '../src/preload/index.d';
import { MOCK, MockBackend } from '../test/mock-backend';

/**
 * S11 e2e (Verify): the built kiosk + FakeReader + in-memory API over real HTTP and Socket.IO.
 * Scenarios: register, token isolation, card → borrow 2 → success, HCE phone, locked phone, scan via socket,
 * manual + PIN, unknown card → link, 409 out of stock, API down. Finish-gate screenshots at 1920×1080 and 1366×768.
 */

let app: ElectronApplication;
let page: Page;
let backend: MockBackend;
let apiUrl: string;
let userData: string;
const shots = join(__dirname, '.results', 'screens');

type Scenario = 'card' | 'unknownCard' | 'phone' | 'lockedPhone' | 'foreignPhone' | 'unplug' | 'plug';
const simulate = (s: Scenario) => page.evaluate((scenario) => window.labpass.invoke('devSimulate', { scenario }), s);

const shot = async (name: string) => {
  // Finish-gate evidence, not an assertion: a slow machine must not fail the flow tests.
  try {
    for (const [w, h] of [
      [1920, 1080],
      [1366, 768],
    ] as const) {
      await app.evaluate(
        ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setContentSize(size.w, size.h),
        { w, h },
      );
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(shots, `${name}-${w}x${h}.png`), timeout: 60_000 });
    }
  } catch (e) {
    console.warn(`screenshot ${name} skipped: ${(e as Error).message.split('\n')[0]}`);
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1920, 1080));
};

const home = () => expect(page.getByRole('heading', { name: 'Tap your ICTU card or phone' })).toBeVisible();

async function finish(name = 'Finish') {
  // The screen may already have auto-reset (success 8 s, K9 12 s) while screenshots were taken; a stage may be fading in.
  const btn = page.getByRole('button', { name });
  const heading = page.getByRole('heading', { name: 'Tap your ICTU card or phone' });
  await expect(btn.or(heading).first()).toBeVisible();
  if (await btn.isVisible()) await btn.click({ timeout: 5000 }).catch(() => undefined);
  await home();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true });
  backend = new MockBackend();
  apiUrl = await backend.listen();
  userData = mkdtempSync(join(tmpdir(), 'lp-kiosk-e2e-'));
  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: '',
      LABPASS_DEV: '1',
      LABPASS_READER: 'fake',
      LABPASS_API_URL: apiUrl,
      LABPASS_USER_DATA: userData,
      LABPASS_AUTOSTART: '0',
      LABPASS_FAKE_CARD_UID: MOCK.cardUid,
    },
  });
  page = await app.firstWindow();
  // Not closable and out of the taskbar, so the e2e window cannot be closed by accident on a shared desktop.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    w.setClosable(false);
    w.setSkipTaskbar(true);
  });
  app.process().stderr?.on('data', (d: Buffer) => process.stderr.write(`[electron] ${d.toString()}`));
  app.on('close', () => process.stderr.write('[electron] application closed\n'));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1920, 1080));
});

test.afterAll(async () => {
  try {
    process.stderr.write(`[kiosk.log]\n${readFileSync(join(userData, 'logs', 'kiosk.log'), 'utf8')}\n`);
  } catch {
    // No log written.
  }
  // The window is not closable during the run, so exit the app directly.
  await app?.evaluate(({ app: a }) => a.exit(0)).catch(() => undefined);
  await backend?.close();
  // Electron releases its profile files shortly after exit; a leftover temp folder is harmless.
  await new Promise((r) => setTimeout(r, 1500));
  try {
    rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch {
    // Ignored.
  }
});

test('first run: register with the admin code and choose a service PIN', async () => {
  await expect(page.getByRole('heading', { name: 'Register this kiosk' })).toBeVisible();
  await page.getByLabel('Registration code').fill(`LPKR1.${MOCK.registrationCode}`);
  await page.getByLabel('Service PIN for lab assistants (6 digits)').fill('135790');
  await page.getByRole('button', { name: 'Register kiosk' }).click();
  await home();
  // The live challenge QR appears once the pool is filled.
  await expect(page.getByRole('img', { name: /scan this code/i }).first()).toBeVisible();
  await shot('k1-attract');
});

test('the renderer cannot read the device token or reach the network', async () => {
  const probe = await page.evaluate(async (url) => {
    const keys = Object.keys(window.labpass).sort();
    const status = JSON.stringify(await window.labpass.invoke('status'));
    let fetched = 'allowed';
    try {
      await fetch(`${url}/kiosk/config`);
    } catch {
      fetched = 'blocked';
    }
    const w = window as unknown as Record<string, unknown>;
    return { keys, status, fetched, node: typeof w.require + typeof w.process };
  }, apiUrl);
  expect(probe.keys).toEqual(['appInfo', 'invoke', 'subscribe']);
  expect(probe.status).not.toContain(MOCK.token);
  expect(probe.fetched).toBe('blocked');
  expect(probe.node).toBe('undefinedundefined');
});

test('card → borrow 2 items → success → attract', async () => {
  await simulate('card');
  await expect(page.getByRole('heading', { name: 'Ama Mbah' })).toBeVisible();
  await expect(page.getByText('Console cable (RJ45-USB)')).toBeVisible(); // open loan line
  await shot('k3-student');
  await page.getByRole('button', { name: /^Sign In/ }).click();
  const search = page.getByPlaceholder('Search by name or code…');
  await search.fill('2911');
  await page.getByRole('option', { name: /Cisco 2911 Router/ }).click();
  await search.fill('2960');
  await page.getByRole('option', { name: /Catalyst 2960 Switch/ }).click();
  await shot('k4-borrow');
  await page.getByRole('button', { name: 'Borrow 2 item(s)' }).click();
  await expect(page.getByRole('heading', { name: /Borrowed\. Please return by/ })).toBeVisible();
  await shot('k6-success');
  expect(backend.equipment[0]!.available).toBe(5);
  expect(backend.equipment[2]!.available).toBe(8);
  await finish();
});

test('return: only the open lines, with condition', async () => {
  await simulate('card');
  await page.getByRole('button', { name: /^Sign Out/ }).click();
  await expect(page.getByRole('heading', { name: 'What are you returning?' })).toBeVisible();
  await page.getByRole('radio', { name: 'Damaged' }).first().click();
  await shot('k5-return');
  await page.getByRole('button', { name: /^Return \d+ item\(s\)/ }).click();
  await expect(page.getByRole('heading', { name: /Returned\. Thank you, Ama/ })).toBeVisible();
  await finish();
});

test('Android phone (HCE) signs a pool challenge and is identified', async () => {
  await simulate('phone');
  await expect(page.getByRole('heading', { name: 'Brice Tchoua' })).toBeVisible();
  await finish();
});

test('locked phone → "Unlock your phone and tap again"', async () => {
  await simulate('lockedPhone');
  await expect(page.getByRole('heading', { name: 'Unlock your phone and tap again.' })).toBeVisible();
  await shot('k9-error');
  await finish('Back to start');
});

test('scan-the-kiosk: the API pushes `identified` over the socket', async () => {
  // A broadcast sent while the socket is reconnecting is lost; like a student, scan again until the kiosk reacts.
  await expect(async () => {
    await backend.scanBy('ICTU20220456');
    await expect(page.getByRole('heading', { name: 'Brice Tchoua' })).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Brice Tchoua' })).toBeVisible();
  await finish();
});

test('manual matricule → name + photo → PIN', async () => {
  await page.getByRole('button', { name: 'No card? Enter your matricule' }).click();
  await page.getByLabel('Matricule').fill(MOCK.manualMatricule);
  await shot('k7-manual');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Is this you?' })).toBeVisible();
  await expect(page.getByText('Chantal Ngono')).toBeVisible();
  await page.getByRole('tab', { name: 'My PIN' }).click();
  const pad = page.getByRole('group', { name: 'Enter your LabPass PIN' });
  for (const d of MOCK.pin) await pad.getByRole('button', { name: d, exact: true }).click();
  await pad.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Chantal Ngono' })).toBeVisible();
  await expect(page.getByText('Verified by matricule')).toBeVisible();
  await finish();
});

test('unknown card → link it with an OTP', async () => {
  await simulate('unknownCard');
  await expect(page.getByRole('heading', { name: 'This card is not linked to a student yet' })).toBeVisible();
  await shot('k8-link');
  await page.getByRole('button', { name: 'Link this card' }).click();
  await page.getByLabel('Matricule').fill('ICTU20231234');
  await page.getByRole('button', { name: 'Link this card' }).click();
  const pad = page.getByRole('group', { name: 'Enter the 6-digit code' });
  for (const d of MOCK.otp) await pad.getByRole('button', { name: d, exact: true }).click();
  await pad.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Card linked. Tap it again to start.' })).toBeVisible();
  await finish();
});

test('409: someone took the last unit → back to the cart with the real availability', async () => {
  await simulate('card');
  await page.getByRole('button', { name: /^Sign In/ }).click();
  await page.getByPlaceholder('Search by name or code…').fill('4321');
  await page.getByRole('option', { name: /Cisco ISR 4321/ }).click();
  backend.equipment[1]!.available = 0; // another kiosk borrowed it; no socket event yet
  await page.getByRole('button', { name: 'Borrow 1 item(s)' }).click();
  await expect(page.getByRole('alert')).toContainText('Only 0 × Cisco ISR 4321 left.');
  await expect(page.getByText('Pick equipment from the list to add it here.')).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await finish();
});

test('assistant overlay: corner long-press + service PIN', async () => {
  const brand = page.getByLabel('LabPass', { exact: true });
  const box = (await brand.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.waitForTimeout(2200);
  await page.mouse.up();
  const pad = page.getByRole('group', { name: 'Service PIN' });
  for (const d of '135790') await pad.getByRole('button', { name: d, exact: true }).click();
  await pad.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('button', { name: 'Restart card reader' })).toBeVisible();
  await shot('k10-assistant');
  await page.keyboard.press('Escape');
});

test('reader unplugged → K9 with the matricule fallback', async () => {
  await simulate('unplug');
  await expect(page.getByRole('heading', { name: 'Card reader not connected' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'No card? Enter your matricule' })).toBeVisible();
  await simulate('plug');
  await home();
});

test('API down → error with retry guidance and the offline capsule', async () => {
  backend.down = true;
  await simulate('card');
  await expect(page.getByRole('heading', { name: 'The LabPass server is not answering.' })).toBeVisible();
  await expect(page.getByText('Offline — loans will sync').first()).toBeVisible();
  backend.down = false;
});
