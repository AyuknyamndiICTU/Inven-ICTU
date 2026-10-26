import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import type { IdentifiedView, IdentifyView, KioskError, Receipt } from '../../shared/ipc';
import { kioskMachine, recoveryFor, type SubmitInput } from './machine';

const student = (over: Partial<IdentifiedView> = {}): IdentifiedView => ({
  status: 'IDENTIFIED',
  method: 'CARD',
  sessionExpiresAt: new Date(Date.now() + 120_000).toISOString(),
  student: {
    id: '0d9e8c7b-6a5f-4e3d-8c2b-1a0f9e8d7c6b',
    matricule: 'ICTU20231234',
    firstName: 'Ama',
    lastName: 'Mbah',
    program: 'BSc Networks',
    level: 'L3',
    photoUrl: null,
    status: 'ACTIVE',
  },
  eligibility: { canBorrow: true, canReturn: true, reasons: [], remainingItems: null },
  openLines: [
    {
      loanLineId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      loanId: 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      equipmentId: 'c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      equipmentCode: 'CBL-CON',
      equipmentName: 'Console cable',
      outstanding: 2,
      dueAt: new Date().toISOString(),
      overdue: false,
    },
  ],
  flags: [],
  ...over,
});

const receipt = (kind: 'BORROW' | 'RETURN'): Receipt => ({
  kind,
  loanIds: [],
  occurredAt: new Date().toISOString(),
  dueAt: null,
  studentFirstName: 'Ama',
  lines: [],
  offline: false,
});

const lookup: IdentifyView = {
  status: 'VERIFICATION_REQUIRED',
  lookupId: 'd1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
  student: { firstName: 'Chantal', lastName: 'Ngono', photoUrl: null },
  options: ['PIN', 'ASSISTANT', 'OTP'],
};

const err = (code: string, details?: Record<string, unknown>): KioskError => ({
  code,
  status: 409,
  message: code,
  details,
});

function start(
  overrides: {
    submit?: (i: SubmitInput) => Promise<Receipt>;
    identifyManual?: () => Promise<IdentifyView>;
    verifyManual?: (i: { method: string }) => Promise<IdentifiedView>;
  } = {},
) {
  const submit = vi.fn(overrides.submit ?? (async (i: SubmitInput) => receipt(i.kind)));
  const endSession = vi.fn();
  const machine = kioskMachine.provide({
    actors: {
      submit: fromPromise(({ input }) => submit(input)),
      identifyManual: fromPromise(async () => (overrides.identifyManual ? overrides.identifyManual() : lookup)),
      verifyManual: fromPromise(async ({ input }) =>
        overrides.verifyManual ? overrides.verifyManual(input) : student({ flags: ['MANUAL'], method: 'MANUAL' }),
      ),
      requestOtp: fromPromise(async () => ({ destination: 'c•••@ictu.cm' })),
      cardLink: fromPromise(async () => ({
        requestId: 'e1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
        verification: 'OTP' as 'OTP' | 'REVIEW',
        destination: 'x' as string | null,
      })),
      cardLinkConfirm: fromPromise(async () => ({ status: 'LINKED' as const })),
    },
    actions: { endSession },
  });
  const actor = createActor(machine, { input: { timing: { inactivityMs: 45_000, successMs: 8000 } } }).start();
  const state = () => actor.getSnapshot().value;
  const ctx = () => actor.getSnapshot().context;
  const flush = async () => {
    await vi.advanceTimersByTimeAsync(0);
  };
  return { actor, state, ctx, submit, endSession, flush };
}

const item = { equipmentId: 'f1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', name: 'Router', categoryName: 'Routers', max: 3 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('kiosk flow machine', () => {
  it('happy path: attract → reading → identified → borrowing → confirming → success → attract (8 s)', async () => {
    const k = start();
    expect(k.state()).toBe('attract');
    k.actor.send({ type: 'TAP_PRESENT' });
    expect(k.state()).toBe('reading');
    k.actor.send({ type: 'IDENTIFY_RESULT', result: student() });
    expect(k.state()).toEqual({ session: 'identified' });
    k.actor.send({ type: 'SIGN_IN' });
    k.actor.send({ type: 'ADD_ITEM', item });
    k.actor.send({ type: 'ADD_ITEM', item });
    k.actor.send({ type: 'ADD_ITEM', item: { ...item, equipmentId: 'a2b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' } });
    expect(k.ctx().cart.map((l) => l.qty)).toEqual([2, 1]);
    k.actor.send({ type: 'CONFIRM' });
    expect(k.state()).toEqual({ session: 'confirming' });
    await k.flush();
    expect(k.state()).toBe('success');
    expect(k.submit.mock.calls[0]![0]).toMatchObject({ kind: 'BORROW', lines: [{ quantity: 2 }, { quantity: 1 }] });
    await vi.advanceTimersByTimeAsync(7999);
    expect(k.state()).toBe('success');
    await vi.advanceTimersByTimeAsync(1);
    expect(k.state()).toBe('attract');
    expect(k.ctx().student).toBeNull();
  });

  it('cart quantities are clamped to availability; empty cart cannot confirm', () => {
    const k = start();
    k.actor.send({ type: 'IDENTIFY_RESULT', result: student() });
    k.actor.send({ type: 'SIGN_IN' });
    k.actor.send({ type: 'CONFIRM' });
    expect(k.state()).toEqual({ session: 'borrowing' });
    k.actor.send({ type: 'ADD_ITEM', item });
    k.actor.send({ type: 'SET_QTY', equipmentId: item.equipmentId, qty: 99 });
    expect(k.ctx().cart[0]!.qty).toBe(3);
    k.actor.send({ type: 'AVAILABILITY', equipmentId: item.equipmentId, available: 1 });
    expect(k.ctx().cart[0]).toMatchObject({ qty: 1, max: 1 });
    k.actor.send({ type: 'ADD_ITEM', item: { ...item, equipmentId: 'b9b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', max: 0 } });
    expect(k.ctx().cart).toHaveLength(1);
    k.actor.send({ type: 'REMOVE_ITEM', equipmentId: item.equipmentId });
    expect(k.ctx().cart).toHaveLength(0);
    k.actor.send({ type: 'BACK' });
    expect(k.state()).toEqual({ session: 'identified' });
  });

  it('return: only open lines with qty > 0 are sent, with condition', async () => {
    const k = start();
    k.actor.send({ type: 'IDENTIFY_RESULT', result: student() });
    k.actor.send({ type: 'SIGN_OUT' });
    k.actor.send({ type: 'CONFIRM' });
    expect(k.state()).toEqual({ session: 'returning' });
    k.actor.send({
      type: 'SET_RETURN',
      loanLineId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
      qty: 1,
      condition: 'DAMAGED',
    });
    k.actor.send({ type: 'SET_RETURN', loanLineId: 'zz', qty: 0, condition: 'OK' });
    k.actor.send({ type: 'CONFIRM' });
    await k.flush();
    expect(k.submit.mock.calls[0]![0]).toMatchObject({
      kind: 'RETURN',
      lines: [{ loanLineId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', quantity: 1, condition: 'DAMAGED' }],
    });
    expect(k.ctx().receipt?.kind).toBe('RETURN');
  });

  it('guards: no Sign In when not eligible; no Sign Out without open lines', () => {
    const k = start();
    k.actor.send({
      type: 'IDENTIFY_RESULT',
      result: student({
        eligibility: { canBorrow: false, canReturn: true, reasons: ['OVERDUE'], remainingItems: null },
        openLines: [],
      }),
    });
    k.actor.send({ type: 'SIGN_IN' });
    k.actor.send({ type: 'SIGN_OUT' });
    expect(k.state()).toEqual({ session: 'identified' });
  });

  it('45 s inactivity returns to attract and ends the session; activity restarts the timer', async () => {
    const k = start();
    k.actor.send({ type: 'IDENTIFY_RESULT', result: student() });
    k.actor.send({ type: 'SIGN_IN' });
    await vi.advanceTimersByTimeAsync(40_000);
    k.actor.send({ type: 'USER_ACTIVITY' });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(k.state()).toEqual({ session: 'borrowing' });
    await vi.advanceTimersByTimeAsync(5_001);
    expect(k.state()).toBe('attract');
    expect(k.endSession).toHaveBeenCalled();
  });

  it('CONFIG changes the timers', async () => {
    const k = start();
    k.actor.send({ type: 'CONFIG', inactivityMs: 15_000, successMs: 3000 });
    k.actor.send({ type: 'IDENTIFY_RESULT', result: student() });
    await vi.advanceTimersByTimeAsync(15_001);
    expect(k.state()).toBe('attract');
  });

  it('409 INSUFFICIENT_STOCK returns to the cart with the real availability and a notice', async () => {
    const k = start({
      submit: async () => {
        throw err('INSUFFICIENT_STOCK', { equipmentId: item.equipmentId, available: 1 });
      },
    });
    k.actor.send({ type: 'IDENTIFY_RESULT', result: student() });
    k.actor.send({ type: 'SIGN_IN' });
    k.actor.send({ type: 'ADD_ITEM', item });
    k.actor.send({ type: 'SET_QTY', equipmentId: item.equipmentId, qty: 3 });
    k.actor.send({ type: 'CONFIRM' });
    await k.flush();
    expect(k.state()).toEqual({ session: 'borrowing' });
    expect(k.ctx().cart[0]).toMatchObject({ qty: 1, max: 1 });
    expect(k.ctx().notice).toBe('INSUFFICIENT_STOCK');
  });

  it('network failure → K9 with retry that reuses the same idempotency key', async () => {
    let fail = true;
    const k = start({
      submit: async (i) => {
        if (fail) {
          fail = false;
          throw err('NETWORK');
        }
        return receipt(i.kind);
      },
    });
    k.actor.send({ type: 'IDENTIFY_RESULT', result: student() });
    k.actor.send({ type: 'SIGN_IN' });
    k.actor.send({ type: 'ADD_ITEM', item });
    k.actor.send({ type: 'CONFIRM' });
    await k.flush();
    expect(k.state()).toBe('error');
    expect(k.ctx().error?.recovery).toBe('retry');
    k.actor.send({ type: 'RETRY' });
    await k.flush();
    expect(k.state()).toBe('success');
    const [first, second] = k.submit.mock.calls.map((c) => c[0].idempotencyKey);
    expect(first).toBe(second);
  });

  it('errors without a pending submit cannot RETRY; K9 auto-resets after 12 s', async () => {
    const k = start();
    k.actor.send({ type: 'TAP_PRESENT' });
    k.actor.send({ type: 'TAP_ERROR', code: 'PHONE_LOCKED' });
    expect(k.state()).toBe('error');
    expect(k.ctx().error).toMatchObject({ code: 'PHONE_LOCKED', recovery: 'tapAgain' });
    k.actor.send({ type: 'RETRY' });
    expect(k.state()).toBe('error');
    await vi.advanceTimersByTimeAsync(12_000);
    expect(k.state()).toBe('attract');
  });

  it('reading times out after 8 s (no answer from main)', async () => {
    const k = start();
    k.actor.send({ type: 'TAP_PRESENT' });
    await vi.advanceTimersByTimeAsync(8000);
    expect(k.state()).toBe('error');
    expect(k.ctx().error?.code).toBe('READ_TIMEOUT');
  });

  it('identify error from main → K9', () => {
    const k = start();
    k.actor.send({ type: 'TAP_PRESENT' });
    k.actor.send({ type: 'IDENTIFY_ERROR', error: err('NOT_RECOGNISED') });
    expect(k.state()).toBe('error');
    expect(k.ctx().error?.recovery).toBe('manual');
    k.actor.send({ type: 'MANUAL' });
    expect(k.state()).toEqual({ session: { manual: 'entry' } });
  });

  it('manual matricule → PIN → identified (wrong PIN stays on verify with a notice)', async () => {
    let tries = 0;
    const k = start({
      verifyManual: async () => {
        if (tries++ === 0) throw err('VERIFICATION_FAILED');
        return student({ flags: ['MANUAL'] });
      },
    });
    k.actor.send({ type: 'MANUAL' });
    k.actor.send({ type: 'SUBMIT_MATRICULE', matricule: 'ICTU20230002' });
    await k.flush();
    expect(k.state()).toEqual({ session: { manual: 'verify' } });
    expect(k.ctx().lookup?.student.firstName).toBe('Chantal');
    k.actor.send({ type: 'SUBMIT_PIN', pin: '0000' });
    await k.flush();
    expect(k.state()).toEqual({ session: { manual: 'verify' } });
    expect(k.ctx().notice).toBe('VERIFICATION_FAILED');
    k.actor.send({ type: 'SUBMIT_PIN', pin: '2468' });
    await k.flush();
    expect(k.state()).toEqual({ session: 'identified' });
  });

  it('manual OTP request shows the masked destination; LOOKUP_EXPIRED restarts entry', async () => {
    const k = start({
      verifyManual: async () => {
        throw err('LOOKUP_EXPIRED');
      },
    });
    k.actor.send({ type: 'MANUAL' });
    k.actor.send({ type: 'SUBMIT_MATRICULE', matricule: 'ICTU20230002' });
    await k.flush();
    k.actor.send({ type: 'REQUEST_OTP' });
    await k.flush();
    expect(k.ctx().otpDestination).toBe('c•••@ictu.cm');
    k.actor.send({ type: 'SUBMIT_OTP', code: '123456' });
    await k.flush();
    expect(k.state()).toEqual({ session: { manual: 'entry' } });
  });

  it('OPEN policy: matricule identifies directly', async () => {
    const k = start({ identifyManual: async () => student({ flags: ['MANUAL'] }) });
    k.actor.send({ type: 'MANUAL' });
    k.actor.send({ type: 'SUBMIT_MATRICULE', matricule: 'ICTU20230003' });
    await k.flush();
    expect(k.state()).toEqual({ session: 'identified' });
  });

  it('unknown card → K8 link → OTP → linked → attract', async () => {
    const k = start();
    k.actor.send({ type: 'TAP_PRESENT' });
    k.actor.send({ type: 'IDENTIFY_RESULT', result: { status: 'UNKNOWN_CARD', uidSuffix: 'BBAA' } });
    expect(k.state()).toEqual({ session: { linkCard: 'offer' } });
    expect(k.ctx().unknownCard).toEqual({ uidSuffix: 'BBAA' });
    k.actor.send({ type: 'LINK_CARD' });
    k.actor.send({ type: 'SUBMIT_MATRICULE', matricule: 'ICTU20231234' });
    await k.flush();
    expect(k.state()).toEqual({ session: { linkCard: 'otp' } });
    k.actor.send({ type: 'SUBMIT_OTP', code: '424242' });
    await k.flush();
    expect(k.state()).toEqual({ session: { linkCard: 'linked' } });
    await vi.advanceTimersByTimeAsync(6000);
    expect(k.state()).toBe('attract');
  });

  it('a new identity during a session replaces the old one (renderer and main stay in sync)', () => {
    const k = start();
    k.actor.send({ type: 'IDENTIFY_RESULT', result: student() });
    k.actor.send({ type: 'SIGN_IN' });
    k.actor.send({ type: 'ADD_ITEM', item });
    k.actor.send({
      type: 'IDENTIFY_RESULT',
      result: student({ student: { ...student().student, firstName: 'Brice' } }),
    });
    expect(k.state()).toEqual({ session: 'identified' });
    expect(k.ctx().student?.student.firstName).toBe('Brice');
    expect(k.ctx().cart).toHaveLength(0);
  });

  it('a tap during confirming is ignored; a tap on the success screen starts reading at once', async () => {
    let resolve!: (r: Receipt) => void;
    const k = start({ submit: () => new Promise((r) => (resolve = r)) });
    k.actor.send({ type: 'IDENTIFY_RESULT', result: student() });
    k.actor.send({ type: 'SIGN_IN' });
    k.actor.send({ type: 'ADD_ITEM', item });
    k.actor.send({ type: 'CONFIRM' });
    k.actor.send({ type: 'TAP_PRESENT' });
    expect(k.state()).toEqual({ session: 'confirming' });
    resolve(receipt('BORROW'));
    await k.flush();
    k.actor.send({ type: 'TAP_PRESENT' });
    expect(k.state()).toBe('reading');
  });

  it('DONE on K3 ends the session', () => {
    const k = start();
    k.actor.send({ type: 'IDENTIFY_RESULT', result: student() });
    k.actor.send({ type: 'DONE' });
    expect(k.state()).toBe('attract');
    expect(k.endSession).toHaveBeenCalledTimes(1);
  });

  it('maps codes to the next action', () => {
    expect(recoveryFor('NETWORK')).toBe('retry');
    expect(recoveryFor('SESSION_EXPIRED')).toBe('tapAgain');
    expect(recoveryFor('NOT_RECOGNISED')).toBe('manual');
    expect(recoveryFor('STUDENT_INACTIVE')).toBe('assistant');
    expect(recoveryFor('WHATEVER')).toBe('home');
  });
});
