import { syncStoredValue } from "./client-storage-sync.ts";

export function readStoredJson<T>(key: string, fallback: T): T {
	try {
		const stored = localStorage.getItem(key);
		return stored ? (JSON.parse(stored) as T) : fallback;
	} catch {
		return fallback;
	}
}

export function writeStoredJson<T>(key: string, value: T): boolean {
	try {
		const stored = JSON.stringify(value);
		localStorage.setItem(key, stored);
		syncStoredValue(key, stored);
		return true;
	} catch {}
	return false;
}

export function readStoredValue(
	key: string,
	fallback: string | null = null
): string | null {
	try {
		return localStorage.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}

export function writeStoredValue(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
		syncStoredValue(key, value);
	} catch {}
}

export function removeStoredValue(key: string): void {
	try {
		localStorage.removeItem(key);
		syncStoredValue(key, null);
	} catch {}
}

export function readStoredBoolean(key: string, fallback = false): boolean {
	const stored = readStoredValue(key);
	if (stored === null) return fallback;
	return stored === "true";
}
