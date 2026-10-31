import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { AutoRedirect } from '@/components/AutoRedirect';
import { Notice, Shell } from '@/components/Shell';
import { botCall } from '@/lib/botClient';
import { COOKIES } from '@/lib/cookies';
import { env } from '@/lib/env';
import { text } from '@/lib/copy';
import { clientNetwork } from '@/lib/net';

export const metadata: Metadata = { title: 'Result' };
export const dynamic = 'force-dynamic';

type View = 'verified' | 'already' | 'manual' | 'blocked' | 'role_failed' | 'expired' | 'not_member' | 'rate' | 'bot' | 'maintenance';
const VIEWS = new Set<View>(['already', 'role_failed', 'not_member', 'rate', 'bot', 'maintenance']);

export default async function ResultPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const query = await searchParams;
    let view: View;

    // States shown without ever calling the bot (the URL parameter grants nothing, it only picks a message).
    const special = typeof query['s'] === 'string' ? (query['s'] as View) : null;
    if (special && VIEWS.has(special)) {
        view = special;
    } else {
        const resultToken = (await cookies()).get(COOKIES.result)?.value;
        if (!resultToken) redirect('/verify');

        const result = await botCall<{ status: string }>('/v1/result/get', {
            resultToken,
            ip: clientNetwork(await headers()).ip,
        });
        if (!result.ok) {
            view = result.error === 'unreachable' ? 'maintenance' : 'expired';
        } else {
            switch (result.data.status) {
                case 'verified': view = 'verified'; break;
                case 'manual': view = 'manual'; break;
                case 'blocked': view = 'blocked'; break;
                case 'role_failed': view = 'role_failed'; break;
                default: view = 'expired';
            }
        }
    }

    return (
        <Shell>
            {render(view, typeof query['m'] === 'string' ? query['m'] : undefined)}
        </Shell>
    );
}

function render(view: View, minutesParam: string | undefined) {
    const discordUrl = `https://discord.com/channels/${env.guildId}`;
    const minutes = Math.min(1440, Math.max(1, Number.parseInt(minutesParam ?? '', 10) || 5));

    switch (view) {
        case 'verified':
        case 'already':
            return (
                <Notice tone="ok" title={text(view === 'verified' ? 'r_verified_title' : 'r_already_title')}>
                    <p>{text(view === 'verified' ? 'r_verified_body' : 'r_already_body')}</p>
                    <div className="actions">
                        <a className="btn primary" href={discordUrl} rel="noopener">{text('r_open_discord')}</a>
                        <a className="btn" href="/">{text('r_open_site')}</a>
                    </div>
                    {view === 'verified' && <AutoRedirect url={discordUrl} />}
                </Notice>
            );
        case 'manual':
            return (
                <Notice tone="info" title={text('r_manual_title')} label="In review">
                    <p>{text('r_manual_body')}</p>
                    <div className="actions"><a className="btn" href="/">{text('r_open_site')}</a></div>
                </Notice>
            );
        case 'blocked':
            return (
                <Notice tone="bad" title={text('r_blocked_title')}>
                    <p>{text('r_blocked_body')}</p>
                    <div className="actions">
                        <a className="btn primary" href="/verify">{text('r_retry')}</a>
                        <a className="btn" href="/">{text('r_open_site')}</a>
                    </div>
                </Notice>
            );
        case 'role_failed':
            return <Notice tone="bad" title={text('r_role_failed_title')}><p>{text('r_role_failed_body')}</p><div className="actions"><a className="btn" href="/">{text('r_open_site')}</a></div></Notice>;
        case 'not_member':
            return (
                <Notice tone="warn" title={text('r_not_member_title')}>
                    <p>{text('r_not_member_body')}</p>
                    <div className="actions">
                        <a className="btn primary" href="/verify">{text('startOver')}</a>
                        <a className="btn" href="/">{text('r_open_site')}</a>
                    </div>
                </Notice>
            );
        case 'rate':
            return <Notice tone="warn" title={text('r_rate_title')}><p>{text('r_rate_body', { minutes })}</p><div className="actions"><a className="btn" href="/">{text('r_open_site')}</a></div></Notice>;
        case 'bot':
            return <Notice tone="bad" title={text('r_bot_title')}><p>{text('r_bot_body')}</p><div className="actions"><a className="btn" href="/">{text('r_open_site')}</a></div></Notice>;
        case 'maintenance':
            return <Notice tone="warn" title={text('maintenanceTitle')} label="Unavailable"><p>{text('maintenanceBody')}</p><div className="actions"><a className="btn" href="/">{text('r_open_site')}</a></div></Notice>;
        default:
            return (
                <Notice tone="warn" title={text('r_expired_title')}>
                    <p>{text('r_expired_body')}</p>
                    <div className="actions">
                        <a className="btn primary" href="/verify">{text('startOver')}</a>
                        <a className="btn" href="/">{text('r_open_site')}</a>
                    </div>
                </Notice>
            );
    }
}
