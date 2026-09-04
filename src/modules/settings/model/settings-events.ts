export const OPEN_SETTINGS_MODAL_EVENT = "inferay-open-settings-modal";

export type SettingsModalTarget =
	| "agents"
	| "appearance"
	| "workspace"
	| "github";

export interface OpenSettingsModalDetail {
	readonly section: SettingsModalTarget;
}

export function openSettingsModal(
	section: SettingsModalTarget = "agents",
): void {
	window.dispatchEvent(
		new CustomEvent<OpenSettingsModalDetail>(OPEN_SETTINGS_MODAL_EVENT, {
			detail: { section },
		}),
	);
}
