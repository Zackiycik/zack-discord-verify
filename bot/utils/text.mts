// A Discord embed field value may hold at most 1024 characters; exceeding it makes the request fail.
export const FIELD_LIMIT = 1024;

export function clip(text: unknown, max = FIELD_LIMIT): string {
    const value = String(text ?? '');
    return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

// Lists many roles/tags so they fit the limit; whatever overflows is written as "+N".
export function joinLimited(items: unknown[], separator = ', ', max = FIELD_LIMIT): string {
    const parts = items.map(String);
    let out = '';
    for (let i = 0; i < parts.length; i++) {
        const next = out ? out + separator + parts[i] : parts[i]!;
        const rest = parts.length - i - 1;
        const suffix = rest > 0 ? ` … +${rest}` : '';
        if (next.length + suffix.length > max) return out + ` … +${parts.length - i}`;
        out = next;
    }
    return out;
}
