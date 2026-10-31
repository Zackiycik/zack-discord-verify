// The device token is kept both in an httpOnly cookie (written by the server) and in localStorage. If one is
// cleared the other keeps the identity. If storage is disabled/broken (private tab etc.) this is silently skipped.

const KEY = 'verify_device';

export function readDeviceToken(): string | null {
    try {
        const value = window.localStorage.getItem(KEY);
        return value && value.length <= 200 ? value : null;
    } catch {
        return null;
    }
}

export function writeDeviceToken(token: string): void {
    try {
        window.localStorage.setItem(KEY, token);
    } catch {
        // no storage
    }
}

/** Clears transient session data; the token needed for the device lock is KEPT. */
export function clearTransientState(): void {
    try {
        window.sessionStorage.clear();
    } catch {
        // no storage
    }
}
