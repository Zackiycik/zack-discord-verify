import { DiscordLogo, Robot, SealCheck } from '@phosphor-icons/react/dist/ssr';
import type { Metadata } from 'next';
import { Notice, Shell } from '@/components/Shell';
import { StartButton } from '@/components/StartButton';
import { botHealthy } from '@/lib/botClient';
import { pick, text } from '@/lib/copy';
import type { TextKey } from '@/lib/copy';

export const metadata: Metadata = { title: 'Verify' };
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, TextKey> = {
    expired: 'err_expired', state: 'err_state', oauth: 'err_oauth', consent: 'err_consent',
};

export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const query = await searchParams;
    const errorKey = typeof query['e'] === 'string' ? ERRORS[query['e']] : undefined;
    const healthy = await botHealthy();

    return (
        <Shell wide>
            <section className="card intro">
                <div>
                    <h1>{text('landingTitle')}</h1>
                    <p className="lead">{text('landingLead')}</p>
                </div>
                <ol className="steps">
                    <li><DiscordLogo size={22} weight="duotone" aria-hidden="true" /><span>{text('step1')}</span></li>
                    <li><Robot size={22} weight="duotone" aria-hidden="true" /><span>{text('step2')}</span></li>
                    <li><SealCheck size={22} weight="duotone" aria-hidden="true" /><span>{text('step3')}</span></li>
                </ol>
            </section>

            <section className="card action">
                {errorKey && <p className="error" role="alert">{text(errorKey)}</p>}
                {healthy ? (
                    <StartButton labels={pick(['consent', 'start', 'startHint', 'redirecting'])} />
                ) : (
                    <Notice tone="warn" title={text('maintenanceTitle')} label="Unavailable">
                        <p>{text('maintenanceBody')}</p>
                    </Notice>
                )}
            </section>

            <section className="card data">
                <h2>{text('collectTitle')}</h2>
                <ul>
                    <li>{text('collect1')}</li>
                    <li>{text('collect2')}</li>
                    <li>{text('collect3')}</li>
                    <li>{text('collect4')}</li>
                </ul>
                <p className="hint">{text('collectNote')}</p>
            </section>
        </Shell>
    );
}
