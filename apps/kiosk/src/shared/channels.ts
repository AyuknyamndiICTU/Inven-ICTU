// Dependency-free so the sandboxed preload can bundle it (sandboxed preloads cannot require node_modules).
export const EVENT_CHANNEL = 'lp:event';
export const commandChannel = (command: string) => `lp:cmd:${command}`;
