import net from 'node:net';
import { z } from 'zod';

// Every field the site sends is validated here; unexpected fields or sizes are rejected.
const snowflake = z.string().regex(/^\d{17,20}$/);
const ip = z.string().max(45).refine((value) => net.isIP(value) !== 0, 'invalid IP');
const shortText = (max: number) => z.string().max(max);
const count = z.number().int().min(0).max(1_000_000);

const network = {
    ip,
    ipCountry: z.string().length(2).toUpperCase().nullable(),
    ipTimezone: shortText(64).nullable(),
};

export const sessionCreateSchema = z.strictObject({
    user: z.strictObject({
        id: snowflake,
        username: shortText(64),
        global_name: shortText(64).nullable().optional(),
        avatar: shortText(64).nullable().optional(),
        public_flags: z.number().int().min(0).max(2 ** 53).optional(),
        bot: z.boolean().optional(),
        system: z.boolean().optional(),
    }),
    ...network,
});

const token = z.string().min(20).max(100);

export const sessionViewSchema = z.strictObject({ sessionToken: token });

export const submitSchema = z.strictObject({
    sessionToken: token,
    turnstileToken: z.string().min(1).max(4096),
    deviceToken: shortText(200).nullable(),
    fingerprint: z.string().min(1).max(256),
    clientTz: shortText(64).nullable(),
    clientLangs: z.array(shortText(35)).max(10),
    interactions: z.strictObject({ pointer: count, touch: count, key: count, focus: count }),
    headless: z.strictObject({
        webdriver: z.boolean(),
        headlessUa: z.boolean(),
        chromeObjectMissing: z.boolean(),
        zeroOuterSize: z.boolean(),
        pluginsEmpty: z.boolean(),
        swiftShader: z.boolean(),
        languagesEmpty: z.boolean(),
    }),
    ...network,
});

export const resultSchema = z.strictObject({ resultToken: token, ip });
