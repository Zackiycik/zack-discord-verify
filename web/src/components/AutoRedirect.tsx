'use client';

import { useEffect } from 'react';

/** Navigates away after a delay (replace: this step does not show up when pressing back). */
export function AutoRedirect({ url, delayMs = 3000 }: { url: string; delayMs?: number }) {
    useEffect(() => {
        const timer = window.setTimeout(() => window.location.replace(url), delayMs);
        return () => window.clearTimeout(timer);
    }, [url, delayMs]);
    return null;
}
