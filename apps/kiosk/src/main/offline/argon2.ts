import { argon2id } from 'hash-wasm';

/**
 * argon2id raw digest for `pin` using the server's encoded parameters and salt
 * (`$argon2id$v=19$m=…,t=…,p=…$<base64 salt>`), so the kiosk reproduces the server-side digest exactly.
 */
export async function argon2Digest(pin: string, pinParams: string, hashLength = 32): Promise<Uint8Array> {
  const parts = pinParams.split('$');
  // ['', 'argon2id', 'v=19', 'm=…,t=…,p=…', salt]
  if (parts[1] !== 'argon2id' || parts.length < 5) throw new Error('Unsupported PIN parameters');
  const params = Object.fromEntries(parts[3]!.split(',').map((kv) => kv.split('=') as [string, string]));
  const salt = Buffer.from(parts[4]!, 'base64');
  return argon2id({
    password: pin,
    salt: new Uint8Array(salt),
    parallelism: Number(params.p),
    iterations: Number(params.t),
    memorySize: Number(params.m),
    hashLength,
    outputType: 'binary',
  });
}
