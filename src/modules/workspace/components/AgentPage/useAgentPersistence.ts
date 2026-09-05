import { useCallback, useEffect } from "octane";

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
	createAgentViewSwitchHealth,
	dispatchAgentShellChange,
	getPrimaryProductLoopContext,
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
	mainViewHealthRef,
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
	useEffect(() => {
		writeStoredValue(AGENT_MAIN_VIEW_STORAGE_KEY, mainView);
		const previous = mainViewHealthRef.current;
		const timestamp = Date.now();
		if (previous.timestamp === null) {
			mainViewHealthRef.current = { timestamp, view: mainView };
			return;
		}
		if (previous.view === mainView) return;
		dispatchAgentShellChange({
			source: "view",
			reason: "main-view-switch",
			productHealth: createAgentViewSwitchHealth({
				context: getPrimaryProductLoopContext(latestStateRef.current),
				from: previous.view,
				previousTimestamp: previous.timestamp,
				timestamp,
				to: mainView,
			}),
		});
		mainViewHealthRef.current = { timestamp, view: mainView };
	}, [latestStateRef, mainView, mainViewHealthRef]);
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
