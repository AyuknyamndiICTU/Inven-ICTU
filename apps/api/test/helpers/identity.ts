import { b64urlDecode, b64urlEncode, popMessage } from '@labpass/contracts/tap';
import { generateDeviceKey, signDer } from '@labpass/contracts/tap-node';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { TestApp } from './app';

let n = 0;

export async function makeStudent(
  t: TestApp,
  over: Partial<{
    matricule: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    dateOfBirth: string;
    status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  }> = {},
) {
  n += 1;
  return t.prisma.student.create({
    data: {
      matricule: over.matricule ?? `ICTU2024${String(n).padStart(4, '0')}`,
      firstName: over.firstName ?? 'Awa',
      lastName: over.lastName ?? 'Ngo Bassa',
      email: over.email === undefined ? `student${n}@ictuniversity.test` : over.email,
      phone: over.phone ?? null,
      dateOfBirth: new Date(`${over.dateOfBirth ?? '2004-03-02'}T00:00:00Z`),
      status: over.status ?? 'ACTIVE',
      program: 'Networks & Telecoms',
      level: 'L2',
    },
  });
}

/** Last OTP code sent through the test notification hook. */
export function lastOtp(t: TestApp): string {
  const msg = [...t.notifications.sentForTest].reverse().find((m) => m.template === 'otp');
  if (!msg) throw new Error('no OTP was sent');
  return String(msg.data!.code);
}

const sha256 = (b: Uint8Array | string) => new Uint8Array(createHash('sha256').update(b).digest());

/** A simulated Android phone: P-256 device key + proof of possession. */
export function fakePhone() {
  const key = generateDeviceKey();
  return {
    key,
    spki: b64urlEncode(key.spki),
    pop: (sessionId: string, popNonce: string) =>
      b64urlEncode(signDer(key.pkcs8, popMessage(sessionId, b64urlDecode(popNonce)))),
  };
}

/** Software WebAuthn authenticator (ES256, `fmt: none`, user verification) for passkey tests. */
export class SoftAuthenticator {
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  readonly credentialId = randomBytes(16);
  private counter = 0;

  constructor(
    readonly rpId = 'localhost',
    readonly origin = 'http://localhost:3102',
  ) {}

  get id() {
    return b64urlEncode(this.credentialId);
  }

  private coseKey() {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    return isoCBOR.encode(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
        [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))],
      ]),
    );
  }

  private authData(flags: number, attested?: Uint8Array) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(this.rpId), Buffer.of(flags), c, ...(attested ? [attested] : [])]);
  }

  private clientData(type: string, challenge: string, origin = this.origin) {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  /** `navigator.credentials.create()` → RegistrationResponseJSON. */
  register(options: Record<string, unknown>, opts: { origin?: string } = {}) {
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.credentialId, this.coseKey()]);
    const authData = this.authData(0x45, attested); // UP | UV | AT
    const attestationObject = isoCBOR.encode(
      new Map<string, unknown>([
        ['fmt', 'none'],
        ['attStmt', new Map()],
        ['authData', new Uint8Array(authData)],
      ]) as Parameters<typeof isoCBOR.encode>[0],
    );
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64urlEncode(this.clientData('webauthn.create', String(options.challenge), opts.origin)),
        attestationObject: b64urlEncode(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  /** `navigator.credentials.get()` → AuthenticationResponseJSON. */
  assert(options: Record<string, unknown>) {
    this.counter += 1;
    const authData = this.authData(0x05); // UP | UV
    const clientDataJSON = this.clientData('webauthn.get', String(options.challenge));
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), {
      key: this.keys.privateKey,
      dsaEncoding: 'der',
    });
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      response: {
        clientDataJSON: b64urlEncode(clientDataJSON),
        authenticatorData: b64urlEncode(authData),
        signature: b64urlEncode(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}

/** Full Android enrollment for a matching student; returns the phone and its tokens. */
export async function enrollAndroid(
  t: TestApp,
  student: { matricule: string; firstName: string; lastName: string; dateOfBirth: Date },
) {
  const start = await t.request({
    method: 'POST',
    url: '/enroll/start',
    origin: null,
    payload: {
      matricule: student.matricule,
      firstName: student.firstName,
      lastName: student.lastName,
      dateOfBirth: student.dateOfBirth.toISOString().slice(0, 10),
      platform: 'ANDROID_APP',
    },
  });
  if (start.statusCode !== 200) throw new Error(`enroll.start ${start.statusCode} ${start.body}`);
  const { sessionId } = start.json() as { sessionId: string };
  const otp = await t.request({
    method: 'POST',
    url: '/enroll/otp/verify',
    origin: null,
    payload: { sessionId, code: lastOtp(t) },
  });
  const { popNonce } = otp.json() as { popNonce: string };
  const phone = fakePhone();
  const res = await t.request({
    method: 'POST',
    url: '/enroll/key',
    origin: null,
    payload: {
      sessionId,
      spki: phone.spki,
      popSignature: phone.pop(sessionId, popNonce),
      capabilities: { hce: true, scan: true },
      deviceLabel: 'Tecno Spark',
    },
  });
  if (res.statusCode !== 200) throw new Error(`enroll.key ${res.statusCode} ${res.body}`);
  const body = res.json() as {
    status: string;
    credentialId: string;
    tokens: { accessToken: string; refreshToken: string };
  };
  return { phone, ...body };
}
