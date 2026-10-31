import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ChallengeForm } from '@/components/ChallengeForm';
import { Notice, Shell } from '@/components/Shell';
import { botCall } from '@/lib/botClient';
import { COOKIES } from '@/lib/cookies';
import { env } from '@/lib/env';
import { pick, text } from '@/lib/copy';

export const metadata: Metadata = { title: 'Security check' };
export const dynamic = 'force-dynamic';

type ViewData = { ok: false } | { ok: true; username: string; expiresInSec: number; cdata: string };

export default async function ChallengePage() {
    const sessionToken = (await cookies()).get(COOKIES.session)?.value;
    if (!sessionToken) redirect('/verify?e=expired');

    // Time on the page is measured by the BOT from this call on; the client is not trusted.
    const view = await botCall<ViewData>('/v1/session/view', { sessionToken });

    if (!view.ok && view.error === 'unreachable') {
        return (
            <Shell>
                <Notice tone="warn" title={text('maintenanceTitle')} label="Unavailable"><p>{text('maintenanceBody')}</p><div className="actions"><a className="btn" href="/">{text('r_open_site')}</a></div></Notice>
            </Shell>
        );
    }
    if (!view.ok || !view.data.ok) redirect('/verify?e=expired');

    return (
        <Shell>
            <h1>{text('challengeTitle')}</h1>
            <p className="lead">
                <strong>{text('challengeHello', { name: view.data.username })}</strong>
                <br />
                {text('challengeLead')}
            </p>
            <ChallengeForm
                siteKey={env.turnstileSiteKey}
                cdata={view.data.cdata}
                labels={pick(['verify', 'preparing', 'checking', 'captchaFailed', 'genericError', 'waitMore'])}
            />
        </Shell>
    );
}
