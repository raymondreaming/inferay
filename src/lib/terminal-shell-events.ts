export const TERMINAL_SHELL_CHANGE_EVENT = "terminal-shell-change";

export interface TerminalShellChangeDetail {
	readonly source?: "local" | "client-storage";
	readonly reason?: string;
	readonly changedKeys?: readonly string[];
}

export function dispatchTerminalShellChange(
	detail: TerminalShellChangeDetail = { source: "local" }
): void {
	window.dispatchEvent(
		new CustomEvent<TerminalShellChangeDetail>(TERMINAL_SHELL_CHANGE_EVENT, {
			detail,
		})
	);
}

export function isClientStorageTerminalShellChange(event: Event): boolean {
	const detail = event instanceof CustomEvent ? event.detail : null;
	return (
		typeof detail === "object" &&
		detail !== null &&
		(detail as TerminalShellChangeDetail).source === "client-storage"
	);
}
