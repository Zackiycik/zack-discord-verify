'use client';

import { ArrowRight } from '@phosphor-icons/react';
import { useState } from 'react';

interface Props {
    labels: { consent: string; start: string; startHint: string; redirecting: string };
}

export function StartButton({ labels }: Props) {
    const [accepted, setAccepted] = useState(false);
    const [busy, setBusy] = useState(false);

    const go = () => {
        setBusy(true);
        // replace: pressing back must not return to this step.
        window.location.replace('/api/auth/discord/login?consent=1');
    };

    return (
        <div className="start">
            <label className="consent">
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                <span>{labels.consent}</span>
            </label>
            <button type="button" className="btn primary" disabled={!accepted || busy} onClick={go}>
                {busy ? labels.redirecting : labels.start}
                {!busy && <ArrowRight className="arrow" size={16} weight="bold" aria-hidden="true" />}
            </button>
            {!accepted && <p className="hint">{labels.startHint}</p>}
        </div>
    );
}
