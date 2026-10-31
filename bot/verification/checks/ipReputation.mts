import net from 'node:net';
import { LIMITS, WEIGHTS } from '../weights.mts';
import { block, review, score } from '../types.mts';
import type { IpFailMode, Signal } from '../types.mts';

export interface IpInfo {
    proxy: boolean;
    vpn: boolean;
    tor: boolean;
    datacenter: boolean;
    risk: number;
    country: string | null;
    /** Timezone of the IP (fallback for the timezone comparison when the Vercel header is missing). */
    timezone: string | null;
    type: string;
}

export interface IpLookupResult {
    ok: boolean;
    info?: IpInfo;
    error?: string;
    /** Private/local address: not looked up (development). */
    skipped?: boolean;
}

/** Non-public addresses such as 127.x, 10.x, 192.168.x, 172.16-31.x, ::1, fc00::/7, fe80::/10. */
export function isPrivateIp(ip: string): boolean {
    const version = net.isIP(ip);
    if (version === 4) {
        const [a = 0, b = 0] = ip.split('.').map(Number);
        return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
    }
    if (version === 6) {
        const lower = ip.toLowerCase();
        return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
    }
    return false;
}

export interface ProxycheckRequest {
    ip: string;
    apiKey?: string | undefined;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}

/**
 * Reads a proxycheck.io v2 response (`proxy: yes|no`, `type`, `risk`, `isocode`). An unexpected
 * response counts as "lookup failed" and is never silently treated as "clean".
 */
export async function lookupProxycheck(request: ProxycheckRequest): Promise<IpLookupResult> {
    if (net.isIP(request.ip) === 0) return { ok: false, error: 'invalid IP' };
    if (isPrivateIp(request.ip)) return { ok: true, skipped: true };

    const doFetch = request.fetchImpl ?? fetch;
    const query = new URLSearchParams({ vpn: '1', risk: '1', asn: '1' });
    if (request.apiKey) query.set('key', request.apiKey);

    try {
        const response = await doFetch(`https://proxycheck.io/v2/${encodeURIComponent(request.ip)}?${query}`, {
            signal: AbortSignal.timeout(request.timeoutMs ?? 4000),
        });
        if (!response.ok) return { ok: false, error: `http-${response.status}` };

        const data = (await response.json()) as Record<string, unknown>;
        const status = String(data['status'] ?? '');
        const entry = data[request.ip] as Record<string, unknown> | undefined;
        if ((status !== 'ok' && status !== 'warning') || !entry || typeof entry !== 'object') {
            return { ok: false, error: `status=${status || 'none'}` };
        }

        const type = String(entry['type'] ?? '');
        const isProxy = String(entry['proxy'] ?? '').toLowerCase() === 'yes';
        return {
            ok: true,
            info: {
                proxy: isProxy,
                vpn: /vpn/i.test(type),
                tor: /tor/i.test(type),
                datacenter: /hosting|data ?cent/i.test(type),
                risk: Number(entry['risk']) || 0,
                country: typeof entry['isocode'] === 'string' ? entry['isocode'].toUpperCase() : null,
                timezone: typeof entry['timezone'] === 'string' ? entry['timezone'].slice(0, 64) : null,
                type,
            },
        };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.name : 'network-error' };
    }
}

export function ipSignals(result: IpLookupResult, failMode: IpFailMode): Signal[] {
    if (result.skipped) return [];

    if (!result.ok || !result.info) {
        const detail = result.error ?? 'unknown';
        if (failMode === 'closed') return [block('IP_CHECK_FAILED', detail)];
        if (failMode === 'review') return [review('IP_CHECK_FAILED', detail)];
        return [score('IP_CHECK_FAILED', WEIGHTS.IP_CHECK_FAILED_OPEN, detail)];
    }

    const { info } = result;
    const signals: Signal[] = [];

    // VPN/proxy/Tor/datacenter is not blocked outright, it goes to manual review (real members use VPNs).
    if (info.proxy || info.vpn || info.tor || info.datacenter) {
        signals.push(review('IP_PROXY', info.type || 'proxy'));
    }
    if (info.risk >= LIMITS.IP_RISK_THRESHOLD) {
        signals.push(score('IP_HIGH_RISK', WEIGHTS.IP_HIGH_RISK, `risk ${info.risk}`));
    }
    return signals;
}
