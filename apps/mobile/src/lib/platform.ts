export type PlatformTarget = 'web' | 'android' | 'ios';

/** Which LabPass student target is running (decision Q10: web app for every phone, Android app for NFC tap). */
export function platformTarget(os: string): PlatformTarget {
  if (os === 'android') return 'android';
  if (os === 'ios') return 'ios';
  return 'web';
}

/** Only the Android app can emulate an NFC card (HCE). Browsers cannot (ARCH §2). */
export function canTap(target: PlatformTarget, hasNfc: boolean): boolean {
  return target === 'android' && hasNfc;
}
