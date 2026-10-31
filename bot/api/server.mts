import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ZodType } from 'zod';
import { NonceStore, verifyRequest } from './auth.mts';
import { RateLimiter } from './ratelimit.mts';
import { resultSchema, sessionCreateSchema, sessionViewSchema, submitSchema } from './schemas.mts';
import type { VerificationService } from '../verification/service.mts';

const MAX_BODY_BYTES = 16 * 1024;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface ApiDeps {
    service: VerificationService;
    secret: string;
    now?: () => number;
    nonces?: NonceStore;
    limiter?: RateLimiter;
    maxBodyBytes?: number;
    /** If it returns false, /health answers 503 (the bot is not connected to Discord yet). */
    ready?: () => boolean;
    logger?: Pick<Console, 'error' | 'warn'>;
}

class HttpError extends Error {
    readonly status: number;
    readonly code: string;
    readonly extra: Record<string, unknown>;

    constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
        super(code);
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const declared = Number(req.headers['content-length'] ?? 0);
        if (declared > limit) return reject(new HttpError(413, 'too_large'));

        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > limit) {
                reject(new HttpError(413, 'too_large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
        'cache-control': 'no-store',
    });
    res.end(body);
}

export function createApiServer(deps: ApiDeps): http.Server {
    const now = deps.now ?? Date.now;
    const nonces = deps.nonces ?? new NonceStore();
    const limiter = deps.limiter ?? new RateLimiter();
    const limit = deps.maxBodyBytes ?? MAX_BODY_BYTES;
    const logger = deps.logger ?? console;
    const { service } = deps;

    /** Throws 429 when the limit is exceeded. Keyed by IP; the limits are deliberately generous (CGNAT). */
    const throttle = (route: string, ip: string, max: number, windowMs: number): void => {
        const result = limiter.hit(`${route}:${ip}`, max, windowMs, now());
        if (!result.allowed) throw new HttpError(429, 'rate_limited', { retryAfterSec: result.retryAfterSec });
    };

    type Handler = (body: unknown) => Promise<unknown> | unknown;
    const routes: Record<string, { schema: ZodType; handle: Handler; maxBytes?: number }> = {
        '/v1/session/create': {
            schema: sessionCreateSchema,
            handle: async (raw) => {
                const b = raw as import('zod').infer<typeof sessionCreateSchema>;
                throttle('create', b.ip, 60, HOUR);
                return service.createSession(
                    {
                        id: b.user.id,
                        username: b.user.username,
                        avatar: b.user.avatar ?? null,
                        globalName: b.user.global_name ?? null,
                        publicFlags: b.user.public_flags ?? 0,
                        bot: b.user.bot ?? false,
                        system: b.user.system ?? false,
                    },
                    { ip: b.ip, ipCountry: b.ipCountry, ipTimezone: b.ipTimezone },
                );
            },
        },
        '/v1/session/view': {
            schema: sessionViewSchema,
            handle: (raw) => service.viewSession((raw as import('zod').infer<typeof sessionViewSchema>).sessionToken),
        },
        '/v1/verify/submit': {
            schema: submitSchema,
            handle: async (raw) => {
                const b = raw as import('zod').infer<typeof submitSchema>;
                throttle('submit', b.ip, 30, 10 * MINUTE);
                const result = await service.submit(b);
                if (result.status === 'invalid_session') return result;
                // The decision is not returned to the site: it reads the outcome via /v1/result/get. The approve / manual / block
                // distinction is only visible on the result page, and only as much as needed.
                return { status: 'done', deviceToken: result.deviceToken, resultToken: result.resultToken };
            },
        },
        '/v1/result/get': {
            schema: resultSchema,
            handle: (raw) => {
                const b = raw as import('zod').infer<typeof resultSchema>;
                throttle('result', b.ip, 120, MINUTE);
                const { status } = service.getResult(b.resultToken);
                // A staff rejection and an automatic block look the same to the user.
                return { status: status === 'rejected' ? 'blocked' : status };
            },
        },
    };

    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = new URL(req.url ?? '/', 'http://localhost');

        if (url.pathname === '/health') {
            if (req.method !== 'GET') throw new HttpError(405, 'method_not_allowed');
            return send(res, deps.ready && !deps.ready() ? 503 : 200, { ok: deps.ready?.() ?? true });
        }

        const route = routes[url.pathname];
        if (!route) throw new HttpError(404, 'not_found');
        if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');

        const body = await readBody(req, route.maxBytes ?? limit);
        const auth = verifyRequest(req.headers, req.method, url.pathname, body, {
            secret: deps.secret,
            now: now(),
            nonces,
        });
        if (!auth.ok) {
            logger.warn(`Unauthorized API request (${auth.reason}): ${url.pathname}`);
            throw new HttpError(401, 'unauthorized');
        }

        let json: unknown;
        try {
            json = JSON.parse(body);
        } catch {
            throw new HttpError(400, 'bad_request');
        }
        const parsed = route.schema.safeParse(json);
        if (!parsed.success) {
            logger.warn(`Invalid API body ${url.pathname}: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}`);
            throw new HttpError(400, 'bad_request');
        }

        send(res, 200, { ok: true, data: await route.handle(parsed.data) });
    }

    return http.createServer((req, res) => {
        handle(req, res).catch((error: unknown) => {
            if (res.headersSent) return;
            if (error instanceof HttpError) {
                return send(res, error.status, { ok: false, error: error.code, ...error.extra });
            }
            // Details never leak out, they are only logged.
            logger.error('API error:', error);
            send(res, 500, { ok: false, error: 'internal' });
        });
    });
}

/** Listens on the local interface only; expose it through a tunnel or reverse proxy. */
export function startApi(deps: ApiDeps, port: number, host = '127.0.0.1'): Promise<http.Server> {
    const server = createApiServer(deps);
    // Slow/hung connections must not eat resources.
    server.headersTimeout = 10_000;
    server.requestTimeout = 15_000;
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server));
    });
}
