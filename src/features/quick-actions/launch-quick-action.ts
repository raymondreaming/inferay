import { DEFAULT_APP_ROUTE } from "../../lib/app-navigation.tsx";
import {
	loadAppThemeId,
	mapAppThemeToTerminalTheme,
} from "../../lib/app-theme.ts";
import { TERMINAL_MAIN_VIEW_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { postJson } from "../../lib/fetch-json.ts";
import { writeStoredValue } from "../../lib/stored-json.ts";
import {
	savePendingSend,
	saveStoredModel,
	saveStoredReasoningLevel,
} from "../chat/chat-session-store.ts";
import {
	createTerminalPane,
	DEFAULT_FONT_FAMILY,
	DEFAULT_FONT_SIZE,
	DEFAULT_OPACITY,
	getInitialGroups,
	loadTerminalState,
	saveSyncedTerminalState,
	type TerminalGroupModel,
} from "../terminal/terminal-utils.ts";
import { markQuickActionLaunched } from "./quick-actions-store.ts";
import type { QuickActionProfile } from "./types.ts";

interface WorktreeResponse {
	ok: boolean;
	worktreePath?: string;
	error?: string;
}

async function resolveLaunchCwd(profile: QuickActionProfile): Promise<string> {
	if (!profile.useWorktree || !profile.cwd.trim()) return profile.cwd;
	const response = await postJson<WorktreeResponse>("/api/git/worktree", {
		cwd: profile.cwd,
		name: profile.name,
	});
	if (!response.ok || !response.worktreePath) {
		throw new Error(response.error || "Unable to create worktree");
	}
	return response.worktreePath;
}

export async function launchQuickAction(
	profile: QuickActionProfile,
	navigate: (path: string) => void
) {
	const launchCwd = await resolveLaunchCwd(profile);
	const state = loadTerminalState();
	const groups = (state?.groups ?? getInitialGroups()).map((group) => ({
		...group,
		panes: [...group.panes],
	}));
	const selectedGroupId = state?.selectedGroupId ?? groups[0]?.id ?? null;
	const selectedGroup =
		groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;
	if (!selectedGroup) return;

	const pane = createTerminalPane(
		profile.agentKind,
		launchCwd || undefined,
		false
	);
	selectedGroup.panes.unshift(pane);
	selectedGroup.selectedPaneId = pane.id;

	if (profile.model) saveStoredModel(pane.id, profile.model);
	if (profile.reasoningLevel) {
		saveStoredReasoningLevel(pane.id, profile.reasoningLevel);
	}
	if (profile.prompt) savePendingSend(pane.id, profile.prompt);
	markQuickActionLaunched(profile.id);
	writeStoredValue(TERMINAL_MAIN_VIEW_STORAGE_KEY, "chat");

	saveSyncedTerminalState(
		{
			groups: groups.map(
				(group): TerminalGroupModel =>
					group.id === selectedGroup.id ? selectedGroup : group
			),
			selectedGroupId: selectedGroup.id,
			themeId: state?.themeId ?? mapAppThemeToTerminalTheme(loadAppThemeId()),
			fontSize: state?.fontSize ?? DEFAULT_FONT_SIZE,
			fontFamily: state?.fontFamily ?? DEFAULT_FONT_FAMILY,
			opacity: state?.opacity ?? DEFAULT_OPACITY,
		},
		"quick-action"
	);
	navigate(DEFAULT_APP_ROUTE);
}
