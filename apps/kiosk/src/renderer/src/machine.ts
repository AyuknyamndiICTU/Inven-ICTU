import { assign, fromCallback, fromPromise, sendTo, setup } from 'xstate';
import type { IdentifiedView, IdentifyView, KioskError, Receipt, TapErrorCode } from '../../shared/ipc';

/**
 * Kiosk flow (S11 task 6, DESIGN §5 K1–K10):
 *   attract → reading → identified → borrowing | returning → confirming → success → attract
 * plus manual matricule entry (K7), link-card (K8) and the blocking error state (K9).
 * Every network effect is an injected actor, so the model tests run without Electron.
 */

export interface CartLine {
  equipmentId: string;
  name: string;
  categoryName: string;
  qty: number;
  max: number;
}

export interface ReturnLine {
  qty: number;
  condition: 'OK' | 'DAMAGED';
}

export type ErrorRecovery = 'retry' | 'tapAgain' | 'manual' | 'assistant' | 'home';

export interface FlowError {
  code: string;
  message: string;
  recovery: ErrorRecovery;
}

export type Lookup = Extract<IdentifyView, { status: 'VERIFICATION_REQUIRED' }>;

export interface KioskContext {
  student: IdentifiedView | null;
  lookup: Lookup | null;
  unknownCard: { uidSuffix: string } | null;
  link: { requestId: string; verification: 'OTP' | 'REVIEW'; destination: string | null } | null;
  otpDestination: string | null;
  cart: CartLine[];
  returns: Record<string, ReturnLine>;
  receipt: Receipt | null;
  error: FlowError | null;
  notice: string | null;
  /** One key per confirmation, reused by RETRY so a lost response never borrows twice. */
  idempotencyKey: string | null;
  pending: { kind: 'BORROW' | 'RETURN' } | null;
  timing: { inactivityMs: number; successMs: number };
}

export type KioskMachineEvent =
  | { type: 'TAP_PRESENT' }
  | { type: 'IDENTIFY_RESULT'; result: IdentifyView }
  | { type: 'IDENTIFY_ERROR'; error: KioskError }
  | { type: 'TAP_ERROR'; code: TapErrorCode }
  | { type: 'CONFIG'; inactivityMs: number; successMs: number }
  | { type: 'USER_ACTIVITY' }
  | { type: 'INACTIVE' }
  | { type: 'MANUAL' }
  | { type: 'SUBMIT_MATRICULE'; matricule: string }
  | { type: 'SUBMIT_PIN'; pin: string }
  | { type: 'SUBMIT_ASSISTANT'; pin: string }
  | { type: 'REQUEST_OTP' }
  | { type: 'SUBMIT_OTP'; code: string }
  | { type: 'LINK_CARD' }
  | { type: 'SIGN_IN' }
  | { type: 'SIGN_OUT' }
  | { type: 'ADD_ITEM'; item: Omit<CartLine, 'qty'> }
  | { type: 'SET_QTY'; equipmentId: string; qty: number }
  | { type: 'REMOVE_ITEM'; equipmentId: string }
  | { type: 'SET_RETURN'; loanLineId: string; qty: number; condition: 'OK' | 'DAMAGED' }
  | { type: 'AVAILABILITY'; equipmentId: string; available: number }
  | { type: 'CONFIRM' }
  | { type: 'RETRY' }
  | { type: 'BACK' }
  | { type: 'DONE' };

export type SubmitInput =
  | { kind: 'BORROW'; idempotencyKey: string; lines: Array<{ equipmentId: string; quantity: number }> }
  | {
      kind: 'RETURN';
      idempotencyKey: string;
      lines: Array<{ loanLineId: string; quantity: number; condition: 'OK' | 'DAMAGED' }>;
    };

export type ManualVerifyInput =
  | { lookupId: string; method: 'PIN'; pin: string }
  | { lookupId: string; method: 'ASSISTANT'; assistantPin: string }
  | { lookupId: string; method: 'OTP'; code: string };

/** Maps an API/kiosk error code to the next action the student should take (DESIGN §6 "Error"). */
export function recoveryFor(code: string): ErrorRecovery {
  switch (code) {
    case 'NETWORK':
    case 'IDEMPOTENCY_IN_PROGRESS':
      return 'retry';
    case 'SESSION_EXPIRED':
    case 'PHONE_LOCKED':
    case 'READ_FAILED':
    case 'NO_CHALLENGE':
    case 'READ_TIMEOUT':
    case 'CARD_AUTH_REQUIRED':
      return 'tapAgain';
    case 'NOT_RECOGNISED':
    case 'FOREIGN_PHONE':
    case 'OFFLINE_UNKNOWN_CARD':
    case 'OFFLINE_PASSKEY':
      return 'manual';
    case 'STUDENT_INACTIVE':
    case 'CARD_AUTH_FAILED':
    case 'NEEDS_REVIEW':
    case 'NO_CONTACT':
      return 'assistant';
    default:
      return 'home';
  }
}

const toFlowError = (e: unknown): FlowError => {
  const err = e as Partial<KioskError> | undefined;
  const code = err?.code ?? 'INTERNAL';
  return { code, message: err?.message ?? 'Something went wrong', recovery: recoveryFor(code) };
};

const newKey = () => crypto.randomUUID();

const initialContext = (timing: KioskContext['timing']): KioskContext => ({
  student: null,
  lookup: null,
  unknownCard: null,
  link: null,
  otpDestination: null,
  cart: [],
  returns: {},
  receipt: null,
  error: null,
  notice: null,
  idempotencyKey: null,
  pending: null,
  timing,
});

export const kioskMachine = setup({
  types: {
    context: {} as KioskContext,
    events: {} as KioskMachineEvent,
    input: {} as { timing?: Partial<KioskContext['timing']> } | undefined,
  },
  actors: {
    identifyManual: fromPromise<IdentifyView, { matricule: string }>(async () => {
      throw new Error('identifyManual not provided');
    }),
    verifyManual: fromPromise<IdentifiedView, ManualVerifyInput>(async () => {
      throw new Error('verifyManual not provided');
    }),
    requestOtp: fromPromise<{ destination: string }, { lookupId: string }>(async () => {
      throw new Error('requestOtp not provided');
    }),
    cardLink: fromPromise<NonNullable<KioskContext['link']>, { matricule: string }>(async () => {
      throw new Error('cardLink not provided');
    }),
    cardLinkConfirm: fromPromise<{ status: 'LINKED' }, { requestId: string; code: string }>(async () => {
      throw new Error('cardLinkConfirm not provided');
    }),
    submit: fromPromise<Receipt, SubmitInput>(async () => {
      throw new Error('submit not provided');
    }),
    /** 45 s inactivity watchdog; USER_ACTIVITY (forwarded) restarts it. */
    idleTimer: fromCallback<{ type: 'USER_ACTIVITY' }, { ms: number }>(({ sendBack, receive, input }) => {
      let t = setTimeout(() => sendBack({ type: 'INACTIVE' }), input.ms);
      receive(() => {
        clearTimeout(t);
        t = setTimeout(() => sendBack({ type: 'INACTIVE' }), input.ms);
      });
      return () => clearTimeout(t);
    }),
  },
  actions: {
    /** Tells main to drop the kiosk session (provided by the app; a no-op in tests). */
    endSession: () => undefined,
    reset: assign(({ context }) => initialContext(context.timing)),
    setIdentified: assign(({ event }) => {
      const result = (event as { result: IdentifiedView }).result;
      return {
        student: result,
        lookup: null,
        unknownCard: null,
        link: null,
        cart: [],
        returns: {},
        receipt: null,
        error: null,
        notice: null,
        idempotencyKey: null,
      };
    }),
  },
  guards: {
    isIdentified: ({ event }) => event.type === 'IDENTIFY_RESULT' && event.result.status === 'IDENTIFIED',
    needsVerification: ({ event }) =>
      event.type === 'IDENTIFY_RESULT' && event.result.status === 'VERIFICATION_REQUIRED',
    isUnknownCard: ({ event }) => event.type === 'IDENTIFY_RESULT' && event.result.status === 'UNKNOWN_CARD',
    canBorrow: ({ context }) => Boolean(context.student?.eligibility.canBorrow),
    canReturn: ({ context }) => Boolean(context.student && context.student.openLines.length > 0),
    hasCart: ({ context }) => context.cart.some((l) => l.qty > 0),
    hasReturns: ({ context }) => Object.values(context.returns).some((r) => r.qty > 0),
    canRetrySubmit: ({ context }) => context.error?.recovery === 'retry' && context.pending !== null,
  },
  delays: {
    successReset: ({ context }) => context.timing.successMs,
    errorReset: 12_000,
    readTimeout: 8000,
    linkedReset: 6000,
  },
}).createMachine({
  id: 'kiosk',
  context: ({ input }) =>
    initialContext({
      inactivityMs: input?.timing?.inactivityMs ?? 45_000,
      successMs: input?.timing?.successMs ?? 8000,
    }),
  initial: 'attract',
  on: {
    CONFIG: {
      actions: assign({ timing: ({ event }) => ({ inactivityMs: event.inactivityMs, successMs: event.successMs }) }),
    },
    // A new identity always wins, so the renderer and main never disagree about whose session is open.
    IDENTIFY_RESULT: [
      { guard: 'isIdentified', target: '.session.identified', actions: 'setIdentified' },
      {
        guard: 'needsVerification',
        target: '.session.manual.verify',
        actions: assign({
          lookup: ({ event }) => event.result as Lookup,
          student: null,
          unknownCard: null,
          error: null,
          notice: null,
        }),
      },
      {
        guard: 'isUnknownCard',
        target: '.session.linkCard',
        actions: assign({
          unknownCard: ({ event }) => ({ uidSuffix: (event.result as { uidSuffix: string }).uidSuffix }),
          student: null,
          lookup: null,
          error: null,
        }),
      },
    ],
    IDENTIFY_ERROR: { target: '.error', actions: assign({ error: ({ event }) => toFlowError(event.error) }) },
    TAP_ERROR: {
      target: '.error',
      actions: assign({
        error: ({ event }) => ({ code: event.code, message: event.code, recovery: recoveryFor(event.code) }),
      }),
    },
  },
  states: {
    /** K1: Reader Eye, depth type, live challenge QR, ticker. */
    attract: {
      entry: 'reset',
      on: { TAP_PRESENT: 'reading', MANUAL: 'session.manual' },
    },
    /** K2: A2 horizon sweep while main reads the card and asks the API. */
    reading: {
      after: {
        readTimeout: {
          target: 'error',
          actions: assign({
            error: () => ({ code: 'READ_TIMEOUT', message: 'READ_TIMEOUT', recovery: 'tapAgain' as const }),
          }),
        },
      },
    },
    session: {
      invoke: { id: 'idle', src: 'idleTimer', input: ({ context }) => ({ ms: context.timing.inactivityMs }) },
      on: {
        USER_ACTIVITY: { actions: sendTo('idle', { type: 'USER_ACTIVITY' }) },
        INACTIVE: { target: 'attract', actions: 'endSession' },
        TAP_PRESENT: 'reading',
      },
      initial: 'identified',
      states: {
        /** K3: student card + Sign In / Sign Out. */
        identified: {
          on: {
            SIGN_IN: { guard: 'canBorrow', target: 'borrowing' },
            SIGN_OUT: { guard: 'canReturn', target: 'returning' },
            DONE: { target: '#kiosk.attract', actions: 'endSession' },
          },
        },
        /** K4: combobox + stepper + fanned cart. */
        borrowing: {
          on: {
            ADD_ITEM: {
              actions: assign({
                cart: ({ context, event }) =>
                  context.cart.some((l) => l.equipmentId === event.item.equipmentId)
                    ? context.cart.map((l) =>
                        l.equipmentId === event.item.equipmentId ? { ...l, qty: Math.min(l.max, l.qty + 1) } : l,
                      )
                    : event.item.max > 0
                      ? [...context.cart, { ...event.item, qty: 1 }]
                      : context.cart,
                notice: null,
              }),
            },
            SET_QTY: {
              actions: assign({
                cart: ({ context, event }) =>
                  context.cart.map((l) =>
                    l.equipmentId === event.equipmentId ? { ...l, qty: Math.max(1, Math.min(l.max, event.qty)) } : l,
                  ),
              }),
            },
            REMOVE_ITEM: {
              actions: assign({
                cart: ({ context, event }) => context.cart.filter((l) => l.equipmentId !== event.equipmentId),
              }),
            },
            AVAILABILITY: {
              actions: assign({
                cart: ({ context, event }) =>
                  context.cart.map((l) =>
                    l.equipmentId === event.equipmentId
                      ? { ...l, max: event.available, qty: Math.min(l.qty, Math.max(event.available, 0)) }
                      : l,
                  ),
              }),
            },
            CONFIRM: {
              guard: 'hasCart',
              target: 'confirming',
              actions: assign({ pending: { kind: 'BORROW' }, idempotencyKey: () => newKey(), error: null }),
            },
            BACK: { target: 'identified', actions: assign({ cart: [], notice: null }) },
          },
        },
        /** K5: only the student's open lines, with qty and OK/DAMAGED. */
        returning: {
          on: {
            SET_RETURN: {
              actions: assign({
                returns: ({ context, event }) => ({
                  ...context.returns,
                  [event.loanLineId]: { qty: event.qty, condition: event.condition },
                }),
              }),
            },
            CONFIRM: {
              guard: 'hasReturns',
              target: 'confirming',
              actions: assign({ pending: { kind: 'RETURN' }, idempotencyKey: () => newKey(), error: null }),
            },
            BACK: { target: 'identified', actions: assign({ returns: {} }) },
          },
        },
        confirming: {
          on: { INACTIVE: {}, TAP_PRESENT: {} },
          invoke: {
            src: 'submit',
            input: ({ context }): SubmitInput =>
              context.pending?.kind === 'RETURN'
                ? {
                    kind: 'RETURN',
                    idempotencyKey: context.idempotencyKey!,
                    lines: Object.entries(context.returns)
                      .filter(([, r]) => r.qty > 0)
                      .map(([loanLineId, r]) => ({ loanLineId, quantity: r.qty, condition: r.condition })),
                  }
                : {
                    kind: 'BORROW',
                    idempotencyKey: context.idempotencyKey!,
                    lines: context.cart
                      .filter((l) => l.qty > 0)
                      .map((l) => ({ equipmentId: l.equipmentId, quantity: l.qty })),
                  },
            onDone: {
              target: '#kiosk.success',
              actions: assign({ receipt: ({ event }) => event.output, pending: null, idempotencyKey: null }),
            },
            onError: [
              {
                // 409: someone else just took the last units. Stay in the cart with the real availability.
                guard: ({ event }) => (event.error as KioskError | undefined)?.code === 'INSUFFICIENT_STOCK',
                target: 'borrowing',
                actions: assign(({ context, event }) => {
                  const d = (event.error as KioskError).details as
                    { equipmentId?: string; available?: number } | undefined;
                  return {
                    pending: null,
                    idempotencyKey: null,
                    notice: (event.error as KioskError).message,
                    cart: context.cart
                      .map((l) =>
                        l.equipmentId === d?.equipmentId
                          ? { ...l, max: d.available ?? 0, qty: Math.min(l.qty, d.available ?? 0) }
                          : l,
                      )
                      .filter((l) => l.qty > 0),
                  };
                }),
              },
              { target: '#kiosk.error', actions: assign({ error: ({ event }) => toFlowError(event.error) }) },
            ],
          },
        },
        /** K7: matricule → name + photo → PIN / OTP / assistant (per manualEntryPolicy). */
        manual: {
          initial: 'entry',
          on: { BACK: { target: '#kiosk.attract', actions: 'endSession' } },
          states: {
            entry: {
              on: { SUBMIT_MATRICULE: 'looking' },
            },
            looking: {
              invoke: {
                src: 'identifyManual',
                input: ({ event }) => ({ matricule: (event as { matricule: string }).matricule }),
                onDone: [
                  {
                    guard: ({ event }) => event.output.status === 'IDENTIFIED',
                    target: '#kiosk.session.identified',
                    actions: assign(({ event }) => ({
                      student: event.output as IdentifiedView,
                      lookup: null,
                      notice: null,
                    })),
                  },
                  {
                    guard: ({ event }) => event.output.status === 'VERIFICATION_REQUIRED',
                    target: 'verify',
                    actions: assign({ lookup: ({ event }) => event.output as Lookup, notice: null }),
                  },
                  { target: 'entry', actions: assign({ notice: 'NOT_RECOGNISED' }) },
                ],
                onError: {
                  target: 'entry',
                  actions: assign({ notice: ({ event }) => toFlowError(event.error).message }),
                },
              },
            },
            verify: {
              on: {
                SUBMIT_PIN: 'verifying',
                SUBMIT_ASSISTANT: 'verifying',
                SUBMIT_OTP: 'verifying',
                REQUEST_OTP: 'sendingOtp',
              },
            },
            sendingOtp: {
              invoke: {
                src: 'requestOtp',
                input: ({ context }) => ({ lookupId: context.lookup!.lookupId }),
                onDone: {
                  target: 'verify',
                  actions: assign({ otpDestination: ({ event }) => event.output.destination }),
                },
                onError: {
                  target: 'verify',
                  actions: assign({ notice: ({ event }) => toFlowError(event.error).message }),
                },
              },
            },
            verifying: {
              invoke: {
                src: 'verifyManual',
                input: ({ context, event }): ManualVerifyInput => {
                  const lookupId = context.lookup!.lookupId;
                  if (event.type === 'SUBMIT_ASSISTANT')
                    return { lookupId, method: 'ASSISTANT', assistantPin: event.pin };
                  if (event.type === 'SUBMIT_OTP') return { lookupId, method: 'OTP', code: event.code };
                  return { lookupId, method: 'PIN', pin: (event as { pin: string }).pin };
                },
                onDone: {
                  target: '#kiosk.session.identified',
                  actions: assign(({ event }) => ({
                    student: event.output,
                    lookup: null,
                    notice: null,
                    otpDestination: null,
                  })),
                },
                onError: [
                  {
                    guard: ({ event }) => (event.error as KioskError | undefined)?.code === 'LOOKUP_EXPIRED',
                    target: 'entry',
                    actions: assign({ lookup: null, notice: ({ event }) => toFlowError(event.error).message }),
                  },
                  { target: 'verify', actions: assign({ notice: ({ event }) => toFlowError(event.error).message }) },
                ],
              },
            },
          },
        },
        /** K8: unknown card → link it to a matricule (OTP to the SIS contact, or admin review). */
        linkCard: {
          initial: 'offer',
          on: { BACK: { target: '#kiosk.attract', actions: 'endSession' } },
          states: {
            offer: { on: { LINK_CARD: 'form', MANUAL: '#kiosk.session.manual' } },
            form: { on: { SUBMIT_MATRICULE: 'requesting' } },
            requesting: {
              invoke: {
                src: 'cardLink',
                input: ({ event }) => ({ matricule: (event as { matricule: string }).matricule }),
                onDone: [
                  {
                    guard: ({ event }) => event.output.verification === 'REVIEW',
                    target: 'review',
                    actions: assign({ link: ({ event }) => event.output }),
                  },
                  { target: 'otp', actions: assign({ link: ({ event }) => event.output, notice: null }) },
                ],
                onError: {
                  target: 'form',
                  actions: assign({ notice: ({ event }) => toFlowError(event.error).message }),
                },
              },
            },
            otp: { on: { SUBMIT_OTP: 'confirmingOtp' } },
            confirmingOtp: {
              invoke: {
                src: 'cardLinkConfirm',
                input: ({ context, event }) => ({
                  requestId: context.link!.requestId,
                  code: (event as { code: string }).code,
                }),
                onDone: 'linked',
                onError: {
                  target: 'otp',
                  actions: assign({ notice: ({ event }) => toFlowError(event.error).message }),
                },
              },
            },
            linked: { after: { linkedReset: '#kiosk.attract' }, on: { DONE: '#kiosk.attract' } },
            review: { after: { linkedReset: '#kiosk.attract' }, on: { DONE: '#kiosk.attract' } },
          },
        },
      },
    },
    /** K6: ring landing + receipt; resets after `successResetSec`. A new tap may start immediately. */
    success: {
      after: { successReset: 'attract' },
      on: { DONE: 'attract', TAP_PRESENT: 'reading' },
    },
    /** K9: E1 flicker, specific message and the next action. */
    error: {
      after: { errorReset: 'attract' },
      on: {
        RETRY: { guard: 'canRetrySubmit', target: 'session.confirming', actions: assign({ error: null }) },
        MANUAL: { target: 'session.manual', actions: assign({ error: null }) },
        TAP_PRESENT: 'reading',
        DONE: { target: 'attract', actions: 'endSession' },
      },
    },
  },
});

export type KioskMachine = typeof kioskMachine;
