export const OPEN_SETTINGS_MODAL_EVENT = "inferay-open-settings-modal";

export function openSettingsModal(): void {
	window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_MODAL_EVENT));
}
