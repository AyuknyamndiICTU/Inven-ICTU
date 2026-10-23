import { describe, expect, it } from 'vitest';
import { hardenedWebPreferences, isAllowedNavigation } from './security';

describe('kiosk security', () => {
  it('hardens the renderer', () => {
    const prefs = hardenedWebPreferences('/preload.js');
    expect(prefs).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true });
  });

  it('blocks navigation to remote sites', () => {
    expect(isAllowedNavigation('file:///C:/app/index.html')).toBe(true);
    expect(isAllowedNavigation('http://localhost:3101/', 'http://localhost:3101')).toBe(true);
    expect(isAllowedNavigation('https://evil.example.com/')).toBe(false);
    expect(isAllowedNavigation('http://localhost:3101/', undefined)).toBe(false);
  });
});
