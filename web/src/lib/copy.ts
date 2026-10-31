// All user-facing text in one place, so it is easy to reword or translate.
export const dict = {
    privacy: 'Privacy notice',

    // Landing page
    landingTitle: 'Server verification',
    landingLead: 'To get access to the server we need to confirm that your account is used by a real person. It takes about a minute.',
    step1: 'Sign in with your Discord account',
    step2: 'Complete a short security check',
    step3: 'Your role is granted automatically once you pass',
    collectTitle: 'What data is used?',
    collect1: 'Your Discord user ID, username, account creation date and whether you have a profile picture',
    collect2: 'The country derived from your IP address and an irreversible hash of it',
    collect3: 'Browser language, timezone and a device identifier',
    collect4: 'Interaction on the page (whether mouse/touch/keyboard was used and how long it took)',
    collectNote: 'Your location, email and server list are never requested.',
    consent: 'I have read the privacy notice and consent to my data being processed for verification and transferred to the service providers it lists (hosting, Cloudflare, IP reputation).',
    start: 'Continue with Discord',
    startHint: 'Tick the box to continue.',
    redirecting: 'Redirecting…',

    // Errors (/verify?e=)
    err_expired: 'Your session expired. Please start over.',
    err_state: 'The sign-in security check failed. Please try again.',
    err_oauth: 'Signing in with Discord did not complete. Please try again.',
    err_consent: 'You need to tick the checkbox to continue.',

    maintenanceTitle: 'Verification is unavailable right now',
    maintenanceBody: 'The system is under maintenance or temporarily unreachable. Please try again in a few minutes.',

    // Security check
    challengeTitle: 'Security check',
    challengeHello: 'Hello, {name}',
    challengeLead: 'Complete the check below to prove you are not a robot, then press Verify.',
    verify: 'Verify',
    preparing: 'Preparing the check…',
    checking: 'Checking…',
    captchaFailed: 'The security check could not be loaded. Refresh the page and try again.',
    genericError: 'Something went wrong. Please try again.',
    waitMore: 'Too many attempts. Wait a bit and try again.',

    // Result
    r_verified_title: "You're verified!",
    r_verified_body: 'Your role has been granted. You will be taken back to Discord shortly.',
    r_open_discord: 'Back to Discord',
    r_open_site: 'Back to the website',
    r_already_title: 'You are already verified',
    r_already_body: 'Your role was checked again. You can go back to Discord.',
    r_manual_title: 'Your request was received',
    r_manual_body: 'A staff member will review your verification. Your role is granted automatically once approved; you can close this page.',
    r_blocked_title: 'Verification could not be completed',
    r_blocked_body: 'We could not complete your verification right now. If you use a VPN or proxy, turn it off and try again. If the problem persists, contact the staff through the support channel in the server.',
    r_retry: 'Try again',
    r_role_failed_title: 'Role could not be granted',
    r_role_failed_body: 'Your verification was received but the role could not be granted. Staff have been notified; please contact them through the support channel.',
    r_expired_title: 'Time ran out',
    r_expired_body: 'This page has expired. Please start over.',
    r_not_member_title: 'Join the server first',
    r_not_member_body: 'Your account does not appear to be in the server. Come back to this page after joining.',
    r_rate_title: 'Too many attempts',
    r_rate_body: 'You tried to verify too many times in a short period. You can try again in about {minutes} minutes.',
    r_bot_title: 'Verification is not possible',
    r_bot_body: 'Bot accounts cannot be verified with this system.',
    startOver: 'Start over',
} as const;

export type TextKey = keyof typeof dict;

export function text(key: TextKey, vars: Record<string, string | number> = {}): string {
    let value: string = dict[key];
    for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(replacement));
    return value;
}

/** Only the strings a client component needs (keys stay type-checked). */
export function pick<K extends TextKey>(keys: readonly K[]): Record<K, string> {
    return Object.fromEntries(keys.map((key) => [key, text(key)])) as Record<K, string>;
}
