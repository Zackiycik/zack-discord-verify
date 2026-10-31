import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
    reactStrictMode: true,
    poweredByHeader: false,
    // Keep the monorepo parent from being mistaken for the project root.
    turbopack: { root: path.resolve(import.meta.dirname) },
    async headers() {
        // The CSP needs a per-request nonce, so it is set in src/proxy.ts.
        return [
            {
                source: '/:path*',
                headers: [
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
                    { key: 'X-Frame-Options', value: 'DENY' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    // Location, camera, microphone etc. are never requested (data minimisation).
                    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
                    { key: 'Cache-Control', value: 'no-store' },
                ],
            },
        ];
    },
};

export default config;
