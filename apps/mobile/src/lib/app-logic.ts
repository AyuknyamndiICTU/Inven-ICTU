/** `1.2.10` > `1.2.9`. Non-numeric parts count as 0, so malformed versions never block the app. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export type UpdateAdvice =
  { kind: 'none' } | { kind: 'optional' | 'required'; version: string; url: string; sha256: string };

/** Android: prompt when a newer APK is published; force it when the app is below `minSupportedVersion`. */
export function updateAdvice(
  current: string,
  config: { minSupportedVersion: string; androidApk: { version: string; url: string; sha256: string } | null },
): UpdateAdvice {
  const apk = config.androidApk;
  if (!apk || compareVersions(apk.version, current) <= 0) return { kind: 'none' };
  const required = compareVersions(current, config.minSupportedVersion) < 0;
  return { kind: required ? 'required' : 'optional', version: apk.version, url: apk.url, sha256: apk.sha256 };
}

/** Enrollment input validation mirroring the API (matricule charset, ISO date, names), for instant feedback. */
export function validateEnroll(v: { matricule: string; firstName: string; lastName: string; dateOfBirth: string }) {
  const errors: Partial<Record<keyof typeof v, 'required' | 'invalid'>> = {};
  if (!v.matricule.trim()) errors.matricule = 'required';
  else if (!/^[A-Za-z0-9/-]{3,32}$/.test(v.matricule.trim())) errors.matricule = 'invalid';
  if (!v.firstName.trim()) errors.firstName = 'required';
  if (!v.lastName.trim()) errors.lastName = 'required';
  if (!v.dateOfBirth) errors.dateOfBirth = 'required';
  else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.dateOfBirth);
    const d = m ? new Date(`${v.dateOfBirth}T00:00:00Z`) : null;
    const ok = d && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v.dateOfBirth;
    const year = m ? Number(m[1]) : 0;
    if (!ok || year < 1940 || year > new Date().getUTCFullYear() - 10) errors.dateOfBirth = 'invalid';
  }
  return errors;
}

/** iOS Safari cannot show the install prompt; the app shows "Add to Home Screen" instructions instead. */
export function installMode(ua: string, standalone: boolean): 'installed' | 'ios-guide' | 'prompt' {
  if (standalone) return 'installed';
  return /iPhone|iPad|iPod/i.test(ua) ? 'ios-guide' : 'prompt';
}
