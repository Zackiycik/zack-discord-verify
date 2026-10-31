import { CheckCircle, HourglassMedium, ShieldCheck, WarningOctagon, XCircle } from '@phosphor-icons/react/dist/ssr';
import type { ReactNode } from 'react';
import { env } from '@/lib/env';
import { text } from '@/lib/copy';

/**
 * Common page frame: a top bar (site name left, privacy button right) and the content.
 * `wide` pages lay out their own bento cards; the others sit in a single card.
 */
export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
    return (
        <div className={wide ? 'page wide' : 'page'}>
            <header className="top">
                <a className="logo" href="/">
                    <ShieldCheck size={24} weight="duotone" aria-hidden="true" />
                    <span>{env.siteName}</span>
                </a>
                <a className="btn small" href="/privacy">{text('privacy')}</a>
            </header>
            {wide ? <main className="bento">{children}</main> : <main className="panel">{children}</main>}
            <footer className="foot">
                Made by <a href="https://github.com/zackiycik" rel="noopener">Zack</a> (@zackiycik)
            </footer>
        </div>
    );
}

const TONE_LABEL = { info: 'In review', ok: 'Verified', warn: 'Attention', bad: 'Not completed' } as const;
const TONE_ICON = { info: HourglassMedium, ok: CheckCircle, warn: WarningOctagon, bad: XCircle } as const;

/** Status notice: an icon and a coloured label (colour + text, never colour alone), then title and body. */
export function Notice({ tone = 'info', title, label, children }: {
    tone?: 'info' | 'ok' | 'warn' | 'bad'; title: string; label?: string; children?: ReactNode;
}) {
    const Icon = TONE_ICON[tone];
    return (
        <section className={`notice ${tone}`} role={tone === 'bad' || tone === 'warn' ? 'alert' : 'status'}>
            <span className="tag"><Icon size={16} weight="fill" aria-hidden="true" />{label ?? TONE_LABEL[tone]}</span>
            <h1>{title}</h1>
            {children}
        </section>
    );
}
