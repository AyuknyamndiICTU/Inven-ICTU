import type { NextConfig } from 'next';

const apiOrigin = process.env.LABPASS_API_ORIGIN ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  // Same-origin API: the browser talks to /api/*, Next proxies to the NestJS API so session cookies stay first-party.
  async rewrites() {
    return [
      // Engine.IO only answers on "/socket.io/" (trailing slash); the generic rule below would drop it.
      { source: '/api/socket.io', destination: `${apiOrigin}/socket.io/` },
      { source: '/api/:path*', destination: `${apiOrigin}/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
