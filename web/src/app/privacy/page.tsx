import type { Metadata } from 'next';
import { Shell } from '@/components/Shell';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Privacy notice' };
// The CSP nonce is generated per request; on a static page the scripts would be blocked.
export const dynamic = 'force-dynamic';

// This is a template describing what the stock software does. Whoever runs the service is responsible
// for the accuracy of this text and must adapt it to their jurisdiction (GDPR, UK GDPR, CCPA, ...).
const SECTIONS: [string, string[]][] = [
    ['Who is responsible', [`The operator of this Discord server. Contact: ${env.privacyContact}.`]],
    ['Purpose', ['Keeping bots, fake accounts and duplicate (alt) accounts out of the server and protecting its members.']],
    ['Data that is processed', [
        'Your Discord user ID, username, account creation date and whether you have a profile picture and display name (based only on the "identify" permission; your email, server list and messages are never accessed).',
        'The country and timezone derived from your IP address, and an irreversible keyed hash of the address. The raw IP address is not written to the database.',
        'Browser language, timezone, and a device identifier (hashes derived from a cookie / local storage value and a browser fingerprint).',
        'Interaction on the page (mouse / touch / keyboard use, time spent) and signs of browser automation.',
        'The verification result, risk score and decisions made by staff.',
        'Your location is not requested or processed.',
    ]],
    ['Legal basis', ['The operator\'s legitimate interest in the security of the community, and your consent given when you started verification (including for transfers to the providers below).']],
    ['Who receives data', [
        'The hosting provider of this website, Cloudflare (Turnstile robot check) and an IP-reputation service (your IP address is sent to it to check for VPN / proxy use).',
        'Verification data itself is stored by the operator on the server that runs the bot; the website talks to it over signed requests.',
        'Some of these providers are located outside your country.',
    ]],
    ['Retention', [
        'Verification attempts and logs: 90 days.',
        'Temporary verification sessions: at most 1 day.',
        'Device links (used to stop several accounts on one device): 12 months after you leave the server.',
        'The fact that you are verified: for as long as you are a member of the server.',
    ]],
    ['Your rights', [
        'Depending on where you live you may have the right to access, correct or erase your data, to object to its processing, and to lodge a complaint with a supervisory authority.',
        `To have your verification records deleted, contact ${env.privacyContact}.`,
    ]],
];

export default function PrivacyPage() {
    return (
        <Shell>
            <article className="prose">
                <h1>Privacy notice</h1>
                <p className="lead">This notice explains how your personal data is processed when your account is verified on joining the Discord server.</p>
                {SECTIONS.map(([heading, items]) => (
                    <section key={heading}>
                        <h2>{heading}</h2>
                        <ul>
                            {items.map((item) => (
                                <li key={item}>{item}</li>
                            ))}
                        </ul>
                    </section>
                ))}
                <p className="back"><a className="btn" href="/verify">Back to verification</a></p>
            </article>
        </Shell>
    );
}
