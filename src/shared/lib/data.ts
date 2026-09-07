import { writeStoredValue } from "../../adapters/storage/stored-values.ts";

export function noop(): void {}
export function hasId(id: unknown, item: { id: string }): boolean {
	return item.id === id;
}

export function basename(value: string): string {
	return value.split("/").pop() || value;
}
let activeLocks = 0;
const preventSelection = (event: Event) => event.preventDefault();
let restorePointerSelection = () => {};
export function lockPointerSelection(): () => void {
	if (activeLocks === 0) {
		const saved = [document.body, document.documentElement].flatMap(
			({ style }) =>
				["user-select", "-webkit-user-select"].map((property) => ({
					style,
					property,
					value: style.getPropertyValue(property),
					priority: style.getPropertyPriority(property),
				})),
		);
		for (const { style, property } of saved)
			style.setProperty(property, "none");
		restorePointerSelection = () => {
			for (const { style, property, value, priority } of saved)
				style.setProperty(property, value, priority);
		};
		document.addEventListener("selectstart", preventSelection, true);
		window.getSelection()?.removeAllRanges();
	}
	activeLocks++;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		if (--activeLocks === 0) {
			restorePointerSelection();
			document.removeEventListener("selectstart", preventSelection, true);
			window.getSelection()?.removeAllRanges();
		}
	};
}

export function trackPointerResize(
	pointerId: number,
	onMove: (event: PointerEvent) => void,
	onEnd: () => void = noop,
) {
	const release = lockPointerSelection();
	const move = (event: PointerEvent) => {
		if (event.pointerId === pointerId) onMove(event);
	};
	const end = (event: PointerEvent) => {
		if (event.pointerId !== pointerId) return;
		for (const stop of cleanup) stop();
		release();
		onEnd();
	};
	const cleanup = [
		listenWindowEvent("pointermove", move),
		listenWindowEvent("pointerup", end),
		listenWindowEvent("pointercancel", end),
	];
}

import { QueryClient } from "@octanejs/tanstack-query";
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: 1,
			staleTime: 15_000,
		},
	},
});
export function listenWindowEvent<K extends keyof WindowEventMap | string>(
	type: K,
	listener: K extends keyof WindowEventMap
		? (event: WindowEventMap[K]) => void
		: EventListenerOrEventListenerObject,
): () => void {
	const eventListener = listener as EventListenerOrEventListenerObject;
	window.addEventListener(type, eventListener);
	return window.removeEventListener.bind(
		window,
		type,
		eventListener,
	) as () => void;
}
export function setInputValue(
	setValue: (value: string) => void,
	event: InputEvent & {
		currentTarget: HTMLInputElement | HTMLTextAreaElement;
	},
): void {
	setValue(event.currentTarget.value);
}
export function dispatchWindowEvent<T>(name: string, detail: T): void {
	window.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

export const OPEN_ACTIVE_GIT_GRAPH_EVENT = "inferay-open-active-git-graph";
export const TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT =
	"inferay-toggle-active-git-sidebar";
export function dispatchOpenActiveGitGraph(): void {
	window.dispatchEvent(new CustomEvent(OPEN_ACTIVE_GIT_GRAPH_EVENT));
}
export function dispatchToggleActiveGitSidebar(): void {
	window.dispatchEvent(new CustomEvent(TOGGLE_ACTIVE_GIT_SIDEBAR_EVENT));
}

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
	dispatchWindowEvent<OpenSettingsModalDetail>(OPEN_SETTINGS_MODAL_EVENT, {
		section,
	});
}
export const OPEN_SKILLS_EVENT = "inferay-open-skills";
export type SkillsTarget =
	| { mode: "browse" }
	| { mode: "create" }
	| { mode: "edit"; skillId: string };
export function openSkills(
	target: SkillsTarget = {
		mode: "browse",
	},
): void {
	dispatchWindowEvent(OPEN_SKILLS_EVENT, target);
}

export type MutableRef<T> = { current: T };
export const REMOVE_AGENT_PANE_REQUEST_EVENT =
	"inferay-remove-agent-pane-request";
export interface RemoveAgentPaneRequestDetail {
	paneId: string;
}
export const dispatchRemoveAgentPaneRequest = (paneId: string) =>
	dispatchWindowEvent<RemoveAgentPaneRequestDetail>(
		REMOVE_AGENT_PANE_REQUEST_EVENT,
		{ paneId },
	);
export const CREATE_AGENT_CHAT_EVENT = "create-agent-chat",
	FOCUS_AGENT_CHAT_COMPOSER_EVENT = "inferay-focus-agent-chat-composer";
export type CreateAgentChatTarget = "active-repository" | "new-repository";
export interface CreateAgentChatDetail {
	target: CreateAgentChatTarget;
}
export interface FocusAgentChatComposerDetail {
	paneId: string;
}
export const dispatchCreateAgentChat = (
	target: CreateAgentChatTarget = "active-repository",
) =>
	dispatchWindowEvent<CreateAgentChatDetail>(CREATE_AGENT_CHAT_EVENT, {
		target,
	});
export const dispatchFocusAgentChatComposer = (paneId: string) =>
	dispatchWindowEvent<FocusAgentChatComposerDetail>(
		FOCUS_AGENT_CHAT_COMPOSER_EVENT,
		{ paneId },
	);
export const WORKSPACE_SIDEBAR_COLLAPSED_EVENT =
	"inferay-workspace-sidebar-collapsed";
export interface WorkspaceSidebarCollapsedDetail {
	collapsed: boolean;
}
export function setWorkspaceSidebarCollapsed(collapsed: boolean) {
	writeStoredValue("sidebar-collapsed", String(collapsed));
	dispatchWindowEvent<WorkspaceSidebarCollapsedDetail>(
		WORKSPACE_SIDEBAR_COLLAPSED_EVENT,
		{ collapsed },
	);
}

export const DOCUMENT_OPEN_EVENT = "workspace-file-open";
export type DocumentOpenDetail = {
	readonly cwd: string;
	readonly path: string;
};
export function dispatchDocumentOpen(detail: DocumentOpenDetail) {
	dispatchWindowEvent<DocumentOpenDetail>(DOCUMENT_OPEN_EVENT, detail);
}
