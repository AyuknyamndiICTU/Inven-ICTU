import { adminEvents, routes } from '@labpass/contracts';
import { describe, expect, it, vi } from 'vitest';

vi.mock('socket.io-client', () => ({ io: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: vi.fn() }));

describe('realtime → query cache bridge', () => {
  it('maps every admin socket event to real contract routes', async () => {
    const { INVALIDATES } = await import('./realtime');
    expect(Object.keys(INVALIDATES).sort()).toEqual(Object.keys(adminEvents).sort());
    for (const ids of Object.values(INVALIDATES)) for (const id of ids) expect(routes).toHaveProperty(id);
  });
});
