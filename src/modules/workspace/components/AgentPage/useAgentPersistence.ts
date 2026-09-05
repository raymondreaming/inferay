import { useCallback, useEffect, useRef } from "octane";

import { AGENT_MAIN_VIEW_STORAGE_KEY } from "../../../../adapters/storage/keys.ts";
import {
	readStoredValue,
	writeStoredValue,
} from "../../../../adapters/storage/stored-values.ts";

import {
	DEFAULT_AGENT_MAIN_VIEW,
	isAgentMainView,
} from "../../../../app/model/navigation.tsx";
import { listenWindowEvent } from "../../../../shared/lib/react-events.ts";
import {
	type AgentShellChangeDetail,
	dispatchAgentShellChange,
	syncAgentLayoutMode,
} from "../../model/workspace-model.ts";

import type { AgentPersistenceArgs } from "./shared.ts";

export function useAgentPersistence({
	applySelection,
	setWorkspaceError,
	fontFamily,
	fontSize,
	groups,
	latestStateRef,
	mainView,
	mainViewRef,
	opacity,
	restoreSavedState,
	selectedGroupId,
	setAppearance,
	setLayoutMode,
	setMainView,
	themeId,
}: AgentPersistenceArgs): void {
	useEffect(() => {
		latestStateRef.current = {
			groups,
			selectedGroupId,
			themeId,
			fontSize,
			fontFamily,
			opacity,
		};
	}, [
		groups,
		selectedGroupId,
		themeId,
		fontSize,
		fontFamily,
		opacity,
		latestStateRef,
	]);
	const previousView = useRef(mainView);
	useEffect(() => {
		writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, mainView);
		if (previousView.current === mainView) return;
		previousView.current = mainView;
		dispatchAgentShellChange({ source: "view", reason: "main-view-switch" });
	}, [mainView]);

	const handleShellChange = useCallback(
		(event: Event) => {
			const detail = (event as CustomEvent<AgentShellChangeDetail>).detail;
			const requestedMainView = detail?.mainView ?? null;
			if (
				detail?.source === "view" &&
				detail.reason === "main-view" &&
				isAgentMainView(requestedMainView)
			) {
				if (requestedMainView !== mainViewRef.current) {
					setMainView(requestedMainView);
				}
				return;
			}
			if (detail?.state) {
				latestStateRef.current = detail.state;
				restoreSavedState(detail.state);
			}
			if (detail?.selection) applySelection(detail.selection);
			if (detail?.error) setWorkspaceError(detail.error);
			else if (detail?.saved) setWorkspaceError(null);
			const storedView = readStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY);
			const nextMainView = isAgentMainView(storedView)
				? storedView
				: DEFAULT_AGENT_MAIN_VIEW;
			if (nextMainView !== mainViewRef.current) {
				setMainView(nextMainView);
			}
			syncAgentLayoutMode(setLayoutMode);
		},
		[
			applySelection,
			setWorkspaceError,
			latestStateRef,
			mainViewRef,
			restoreSavedState,
			setAppearance,
			setLayoutMode,
			setMainView,
		],
	);
	useEffect(() => {
		return listenWindowEvent("agent-shell-change", handleShellChange);
	}, [handleShellChange]);
}
