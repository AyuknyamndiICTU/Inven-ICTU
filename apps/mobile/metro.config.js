// Metro config for the student app. In development the web app calls `/api/*` on its own origin (as in production,
// where Caddy proxies `/api` to the API — ADR-0010), so the dev server forwards `/api` to the local API.
const { getDefaultConfig } = require('expo/metro-config');
const http = require('node:http');

const config = getDefaultConfig(__dirname);
const target = new URL(process.env.LABPASS_DEV_API ?? 'http://127.0.0.1:4000');

/** Forwards `/api/*` (minus the prefix) to the API, keeping method, headers, body and cookies. */
function apiProxy(req, res, next) {
  if (!req.url || !req.url.startsWith('/api/')) return next();
  const path = req.url.slice('/api'.length);
  const headers = { ...req.headers, host: target.host };
  const upstream = http.request(
    { hostname: target.hostname, port: target.port, method: req.method, path, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/problem+json' });
    res.end(JSON.stringify({ status: 502, code: 'NETWORK', title: 'API unreachable', detail: e.message }));
  });
  req.pipe(upstream);
}

const previous = config.server?.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const inner = previous ? previous(middleware, server) : middleware;
    return (req, res, next) => apiProxy(req, res, () => inner(req, res, next));
  },
};

module.exports = config;
