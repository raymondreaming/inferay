export function basename(value: string): string {
	return value.split("/").pop() || value;
}

export function trimText(value: string, max = 40): string {
	return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function formatElapsedMs(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes < 1) return `${seconds}s`;
	const hours = Math.floor(minutes / 60);
	if (hours < 1) return `${minutes}m ${seconds}s`;
	return `${hours}h ${minutes % 60}m`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatKilobytes(kilobytes: number): string {
	if (kilobytes >= 1024 * 1024) {
		return `${(kilobytes / (1024 * 1024)).toFixed(1)}G`;
	}
	if (kilobytes >= 1024) return `${Math.round(kilobytes / 1024)}M`;
	return `${kilobytes}K`;
}

export function formatRelativeTime(timestamp: number): string {
	const date = new Date(timestamp);
	const now = new Date();
	const diff = now.getTime() - timestamp;
	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	if (date.getFullYear() === now.getFullYear()) {
		return date.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
		});
	}
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}
