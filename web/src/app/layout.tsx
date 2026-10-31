import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { env } from '@/lib/env';

// Fonts are downloaded at build time and served from the site itself (visitors never contact Google).
const geist = Geist({ subsets: ['latin', 'latin-ext'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export function generateMetadata(): Metadata {
    return {
        title: { default: env.siteName, template: `%s • ${env.siteName}` },
        // Verification pages must not show up in search engines.
        robots: { index: false, follow: false },
    };
}

export const viewport: Viewport = {
    width: 'device-width',
    initialScale: 1,
    colorScheme: 'dark light',
    themeColor: [
        { media: '(prefers-color-scheme: dark)', color: '#0e0f11' },
        { media: '(prefers-color-scheme: light)', color: '#f5f6f4' },
    ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
            <body>{children}</body>
        </html>
    );
}
