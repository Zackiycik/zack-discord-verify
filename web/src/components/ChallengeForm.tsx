'use client';

import { useEffect, useRef, useState } from 'react';
import { clearTransientState, readDeviceToken, writeDeviceToken } from '@/lib/client/deviceStorage';
import { detectHeadless, getFingerprint, localeInfo, trackInteractions } from '@/lib/client/signals';

declare global {
    interface Window {
        turnstile?: {
            render(element: HTMLElement, options: Record<string, unknown>): string;
            remove(widgetId: string): void;
            reset(widgetId?: string): void;
        };
    }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

function loadTurnstile(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (window.turnstile) return resolve();
        const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
        const script = existing ?? Object.assign(document.createElement('script'), { src: SCRIPT_SRC, async: true, defer: true });
        script.addEventListener('load', () => resolve(), { once: true });
        script.addEventListener('error', () => reject(new Error('turnstile-load')), { once: true });
        if (!existing) document.head.appendChild(script);
    });
}

interface Props {
    siteKey: string;
    /** Value issued by the bot (session id): the captcha token is only valid for this session. */
    cdata: string;
    labels: {
        verify: string; preparing: string; checking: string;
        captchaFailed: string; genericError: string; waitMore: string;
    };
}

export function ChallengeForm({ siteKey, cdata, labels }: Props) {
    const container = useRef<HTMLDivElement>(null);
    const widgetId = useRef<string | null>(null);
    const tracker = useRef<ReturnType<typeof trackInteractions> | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [phase, setPhase] = useState<'loading' | 'ready' | 'submitting'>('loading');
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        tracker.current = trackInteractions();
        let cancelled = false;

        loadTurnstile()
            .then(() => {
                if (cancelled || !container.current || !window.turnstile) return;
                widgetId.current = window.turnstile.render(container.current, {
                    sitekey: siteKey,
                    action: 'verify',
                    cData: cdata,
                    theme: 'auto',
                    callback: (value: string) => { setToken(value); setPhase('ready'); },
                    'expired-callback': () => setToken(null),
                    'error-callback': () => setError(labels.captchaFailed),
                });
            })
            .catch(() => setError(labels.captchaFailed));

        return () => {
            cancelled = true;
            tracker.current?.stop();
            if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
            widgetId.current = null;
        };
    }, [siteKey, cdata, labels.captchaFailed]);

    async function submit() {
        if (!token) return;
        setPhase('submitting');
        setError(null);
        try {
            const body = {
                turnstileToken: token,
                deviceToken: readDeviceToken(),
                fingerprint: await getFingerprint(),
                ...localeInfo(),
                interactions: tracker.current?.counts() ?? { pointer: 0, touch: 0, key: 0, focus: 0 },
                headless: detectHeadless(),
            };
            const response = await fetch('/api/verify/submit', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                credentials: 'same-origin',
            });
            const json = (await response.json().catch(() => null)) as { ok?: boolean; deviceToken?: string } | null;

            if (response.ok && json?.ok) {
                // The device token is also written to localStorage; transient session data is cleared. replace: back does not show the old step.
                if (json.deviceToken) writeDeviceToken(json.deviceToken);
                clearTransientState();
                tracker.current?.stop();
                window.location.replace('/verify/result');
                return;
            }
            if (response.status === 410) return void window.location.replace('/verify?e=expired');
            if (response.status === 503) return void window.location.replace('/verify/result?s=maintenance');
            setError(response.status === 429 ? labels.waitMore : labels.genericError);
        } catch {
            setError(labels.genericError);
        }
        // After a failed attempt the captcha token counts as used: get a new one.
        setToken(null);
        setPhase('loading');
        if (window.turnstile) window.turnstile.reset(widgetId.current ?? undefined);
    }

    const busy = phase === 'submitting';
    return (
        <div className="challenge">
            <div ref={container} className="turnstile" />
            {phase === 'loading' && !error && <p className="hint" role="status">{labels.preparing}</p>}
            <button type="button" className="btn primary" disabled={!token || busy} onClick={submit}>
                {busy ? labels.checking : labels.verify}
            </button>
            {error && <p className="error" role="alert">{error}</p>}
        </div>
    );
}
