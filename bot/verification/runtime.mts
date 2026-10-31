import type { RaidMonitor } from './raid.mts';
import type { DiscordNotifier } from './staff.mts';
import type { VerificationService } from './service.mts';

// A single handle so the bot's events and commands can share the running verification service.
// getService() returns null until the service has started (or if it failed to start).
let currentService: VerificationService | null = null;
let currentRaid: RaidMonitor | null = null;
let currentNotifier: DiscordNotifier | null = null;

export const setService = (service: VerificationService | null): void => {
    currentService = service;
};
export const getService = (): VerificationService | null => currentService;

export const setRaid = (raid: RaidMonitor | null): void => {
    currentRaid = raid;
};
export const getRaid = (): RaidMonitor | null => currentRaid;

export const setNotifier = (notifier: DiscordNotifier | null): void => {
    currentNotifier = notifier;
};
export const getNotifier = (): DiscordNotifier | null => currentNotifier;

// Members joining while the service is starting up (or failing to) must not be handled as if there were no service.
let settled = false;
export const markStartupSettled = (): void => {
    settled = true;
};
export async function waitForStartup(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!settled && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
}
