/**
 * WebAuthn JSON ⇄ browser objects (the server uses @simplewebauthn, which speaks the standard JSON encoding with
 * base64url buffers). Pure helpers so they can be unit-tested outside a browser.
 */

export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(b: ArrayBuffer | Uint8Array): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = '';
  for (const x of u) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type Json = Record<string, unknown>;

/** PublicKeyCredentialCreationOptionsJSON → options for navigator.credentials.create. */
export function creationOptionsFromJson(o: Json): PublicKeyCredentialCreationOptions {
  const user = o.user as Json;
  return {
    ...(o as unknown as PublicKeyCredentialCreationOptions),
    challenge: b64urlToBytes(o.challenge as string) as BufferSource,
    user: {
      ...(user as unknown as PublicKeyCredentialUserEntity),
      id: b64urlToBytes(user.id as string) as BufferSource,
    },
    excludeCredentials: ((o.excludeCredentials as Json[] | undefined) ?? []).map((c) => ({
      ...(c as unknown as PublicKeyCredentialDescriptor),
      id: b64urlToBytes(c.id as string) as BufferSource,
    })),
  };
}

/** PublicKeyCredentialRequestOptionsJSON → options for navigator.credentials.get. */
export function requestOptionsFromJson(o: Json): PublicKeyCredentialRequestOptions {
  return {
    ...(o as unknown as PublicKeyCredentialRequestOptions),
    challenge: b64urlToBytes(o.challenge as string) as BufferSource,
    allowCredentials: ((o.allowCredentials as Json[] | undefined) ?? []).map((c) => ({
      ...(c as unknown as PublicKeyCredentialDescriptor),
      id: b64urlToBytes(c.id as string) as BufferSource,
    })),
  };
}

interface AttestationLike {
  id: string;
  rawId: ArrayBuffer;
  type: string;
  authenticatorAttachment?: string | null;
  response: {
    clientDataJSON: ArrayBuffer;
    attestationObject: ArrayBuffer;
    getTransports?: () => string[];
  };
  getClientExtensionResults?: () => unknown;
}

export function registrationToJson(c: AttestationLike): Json {
  return {
    id: c.id,
    rawId: bytesToB64url(c.rawId),
    type: c.type,
    authenticatorAttachment: c.authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bytesToB64url(c.response.clientDataJSON),
      attestationObject: bytesToB64url(c.response.attestationObject),
      transports: c.response.getTransports?.() ?? [],
    },
    clientExtensionResults: c.getClientExtensionResults?.() ?? {},
  };
}

interface AssertionLike {
  id: string;
  rawId: ArrayBuffer;
  type: string;
  response: {
    clientDataJSON: ArrayBuffer;
    authenticatorData: ArrayBuffer;
    signature: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
  };
  getClientExtensionResults?: () => unknown;
}

export function assertionToJson(c: AssertionLike): Json {
  return {
    id: c.id,
    rawId: bytesToB64url(c.rawId),
    type: c.type,
    response: {
      clientDataJSON: bytesToB64url(c.response.clientDataJSON),
      authenticatorData: bytesToB64url(c.response.authenticatorData),
      signature: bytesToB64url(c.response.signature),
      ...(c.response.userHandle ? { userHandle: bytesToB64url(c.response.userHandle) } : {}),
    },
    clientExtensionResults: c.getClientExtensionResults?.() ?? {},
  };
}
