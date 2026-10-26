/**
 * Splits a namespace URL such as `https://labpass.example/api/kiosk` into what socket.io-client expects.
 * socket.io reads the URL path as the namespace and takes the transport path separately, so an API behind a
 * reverse-proxy prefix (`/api`) needs `{ url: 'https://labpass.example/kiosk', path: '/api/socket.io' }`.
 */
export function socketTarget(namespaceUrl: string): { url: string; path: string } {
  const u = new URL(namespaceUrl);
  const pathname = u.pathname.replace(/\/+$/, '');
  const cut = pathname.lastIndexOf('/');
  const namespace = pathname.slice(cut) || '/';
  const prefix = pathname.slice(0, cut);
  return { url: `${u.origin}${namespace}`, path: `${prefix}/socket.io` };
}
