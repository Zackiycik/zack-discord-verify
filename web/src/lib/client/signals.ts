// RAW signals collected in the browser. All of them can be faked; the bot only turns them into score,
// no decision is ever left to the client.

export interface InteractionCounts { pointer: number; touch: number; key: number; focus: number }

export interface HeadlessFlags {
    webdriver: boolean;
    headlessUa: boolean;
    chromeObjectMissing: boolean;
    zeroOuterSize: boolean;
    pluginsEmpty: boolean;
    swiftShader: boolean;
    languagesEmpty: boolean;
}

const CAP = 100_000;

/** Counts mouse/touch/keyboard/focus events. The returned `stop` removes the listeners. */
export function trackInteractions(target: Window = window) {
    const counts: InteractionCounts = { pointer: 0, touch: 0, key: 0, focus: 0 };
    const bump = (name: keyof InteractionCounts) => () => {
        if (counts[name] < CAP) counts[name]++;
    };
    const handlers: [string, () => void][] = [
        ['pointermove', bump('pointer')],
        ['pointerdown', bump('pointer')],
        ['touchstart', bump('touch')],
        ['keydown', bump('key')],
        ['focus', bump('focus')],
    ];
    for (const [type, handler] of handlers) target.addEventListener(type, handler, { passive: true, capture: true });
    return {
        counts: () => ({ ...counts }),
        stop: () => handlers.forEach(([type, handler]) => target.removeEventListener(type, handler, true)),
    };
}

function webglRenderer(): string {
    try {
        const canvas = document.createElement('canvas');
        const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
        const info = gl?.getExtension('WEBGL_debug_renderer_info');
        return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    } catch {
        return '';
    }
}

export function detectHeadless(win: Window = window): HeadlessFlags {
    const nav = win.navigator;
    const ua = nav.userAgent || '';
    const isChromium = /Chrome\//.test(ua);
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua);
    return {
        webdriver: nav.webdriver === true,
        headlessUa: /HeadlessChrome/i.test(ua),
        // A browser that claims to be Chrome but has no window.chrome object is a sign of automation.
        chromeObjectMissing: isChromium && !('chrome' in win),
        zeroOuterSize: win.outerWidth === 0 && win.outerHeight === 0,
        // Desktop Chromium always has at least one plugin (the PDF viewer).
        pluginsEmpty: isChromium && !isMobile && nav.plugins.length === 0,
        swiftShader: /SwiftShader/i.test(webglRenderer()),
        languagesEmpty: !nav.languages || nav.languages.length === 0,
    };
}

export function localeInfo(): { clientTz: string | null; clientLangs: string[] } {
    let clientTz: string | null = null;
    try {
        clientTz = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
        clientTz = null;
    }
    return { clientTz, clientLangs: Array.from(navigator.languages ?? []).slice(0, 10) };
}

/** FingerprintJS is only loaded when needed. If it fails a fixed marker is returned, not an empty value. */
export async function getFingerprint(): Promise<string> {
    try {
        const FingerprintJS = await import('@fingerprintjs/fingerprintjs');
        const agent = await FingerprintJS.load();
        const result = await agent.get();
        return result.visitorId;
    } catch {
        return 'fp-unavailable';
    }
}
