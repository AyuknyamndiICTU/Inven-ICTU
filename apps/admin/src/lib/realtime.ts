'use client';

import type { AdminEventName, AdminEventPayload, RouteId } from '@labpass/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

/** Which cached queries each admin socket event makes stale (Socket.IO → TanStack Query bridge, S09 task 1). */
export const INVALIDATES: Record<AdminEventName, RouteId[]> = {
  'stock.changed': [
    'equipment.list',
    'equipment.get',
    'equipment.movements',
    'dashboard.summary',
    'dashboard.activity',
  ],
  activity: ['dashboard.activity', 'dashboard.summary', 'loans.list'],
  'credentialRequest.created': ['credentialRequests.list', 'dashboard.summary'],
  'kiosk.status': ['kiosks.list', 'dashboard.summary'],
  'alert.fired': ['alerts.occurrences', 'dashboard.summary', 'dashboard.activity'],
  'offlineConflict.created': ['offlineConflicts.list', 'dashboard.summary'],
};

type Handlers = { [E in AdminEventName]?: (payload: AdminEventPayload<E>) => void };

/**
 * Connects to the `/admin` namespace through the same-origin proxy (`/api/socket.io`, long-polling first so it also
 * works where WebSocket upgrades are not proxied). Returns whether the live connection is up.
 */
export function useRealtime(handlers: Handlers = {}) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    // The Next dev rewrite cannot proxy WebSocket upgrades; production goes through the reverse proxy, which can.
    const transports = process.env.NODE_ENV === 'production' ? ['polling', 'websocket'] : ['polling'];
    const socket: Socket = io('/admin', { path: '/api/socket.io', transports, withCredentials: true });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    for (const event of Object.keys(INVALIDATES) as AdminEventName[]) {
      socket.on(event, (payload: unknown) => {
        for (const id of INVALIDATES[event]) void qc.invalidateQueries({ queryKey: [id] });
        (ref.current[event] as ((p: unknown) => void) | undefined)?.(payload);
      });
    }
    return () => {
      socket.close();
    };
  }, [qc]);
  return connected;
}
