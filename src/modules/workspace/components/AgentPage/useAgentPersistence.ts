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
	agentStateKey,
	agentStateScore,
	cacheAgentState,
	createAgentViewSwitchHealth,
	dispatchAgentShellChange,
	getPrimaryProductLoopContext,
	loadAgentState,
	loadCanonicalAgentState,
	normalizeAgentState,
	saveSyncedAgentState,
	syncAgentLayoutMode,
} from "../../model/workspace-model.ts";

import type { AgentPersistenceArgs } from "./shared.ts";

export function useAgentPersistence({
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
	setSelectedGroupId,
	themeId,
}: AgentPersistenceArgs): void {
	const pendingSaveRef = useRef(false);
	const startupRestoreCompleteRef = useRef(false);
	const canonicalShellKeyRef = useRef<string | null>(null);
	const latestStateKey = agentStateKey({
		groups,
		selectedGroupId,
		themeId,
		fontSize,
		fontFamily,
		opacity,
	});
	useEffect(() => {
		const nextState = {
			groups,
			selectedGroupId,
			themeId,
			fontSize,
			fontFamily,
			opacity,
		};
		const canonicalShellKey = canonicalShellKeyRef.current;
		if (
			canonicalShellKey &&
			agentStateKey(nextState) !== canonicalShellKey &&
			agentStateScore(nextState) < agentStateScore(latestStateRef.current)
		) {
			return;
		}
		latestStateRef.current = nextState;
		cacheAgentState(latestStateRef.current);
	}, [
		fontFamily,
		fontSize,
		groups,
		latestStateRef,
		opacity,
		selectedGroupId,
		themeId,
	]);
	useEffect(() => {
		void latestStateKey;
		pendingSaveRef.current = true;
		const id = setTimeout(() => {
			if (!startupRestoreCompleteRef.current) {
				pendingSaveRef.current = false;
				return;
			}
			const saved = loadAgentState();
			if (
				saved &&
				agentStateScore(latestStateRef.current) < agentStateScore(saved)
			) {
				pendingSaveRef.current = false;
				return;
			}
			saveSyncedAgentState(
				latestStateRef.current,
				"agent-page-save",
				"canonical",
			);
			pendingSaveRef.current = false;
		}, 100);
		return () => clearTimeout(id);
	}, [latestStateKey, latestStateRef]);
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
	useEffect(
		() => () => {
			if (!startupRestoreCompleteRef.current) return;
			const saved = loadAgentState();
			if (
				saved &&
				agentStateScore(latestStateRef.current) < agentStateScore(saved)
			) {
				return;
			}
			saveSyncedAgentState(
				latestStateRef.current,
				"agent-page-unmount",
				"canonical",
			);
		},
		[latestStateRef],
	);
	useEffect(() => {
		let cancelled = false;
		const restoreCanonicalState = async () => {
			const canonicalState = await loadCanonicalAgentState();
			if (cancelled) return;
			if (!canonicalState) {
				startupRestoreCompleteRef.current = true;
				return;
			}
			const currentState = latestStateRef.current;
			const canonicalKey = agentStateKey(canonicalState);
			const currentKey = agentStateKey(currentState);
			if (
				canonicalKey !== currentKey &&
				agentStateScore(canonicalState) >= agentStateScore(currentState)
			) {
				canonicalShellKeyRef.current = canonicalKey;
				latestStateRef.current = canonicalState;
				restoreSavedState(canonicalState);
				saveSyncedAgentState(
					canonicalState,
					"startup-canonical-restore",
					"canonical",
				);
			}
			startupRestoreCompleteRef.current = true;
		};
		restoreCanonicalState().catch(() => {
			startupRestoreCompleteRef.current = true;
		});
		return () => {
			cancelled = true;
		};
	}, [latestStateRef, restoreSavedState]);
	const handleShellChange = useCallback(
		(event: Event) => {
			const currentState = latestStateRef.current;
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
			const saved =
				normalizeAgentState(detail?.state) ??
				(detail?.source === "canonical" ? loadAgentState() : null);
			const savedState = saved;
			const isRegressiveSnapshot =
				savedState &&
				detail?.reason !== "remove-pane" &&
				detail?.reason !== "remove-workspace" &&
				detail?.reason !== "select-repository-workspace" &&
				agentStateScore(savedState) < agentStateScore(currentState);
			if (
				!isRegressiveSnapshot &&
				savedState?.selectedGroupId &&
				savedState.selectedGroupId !== currentState.selectedGroupId
			) {
				setSelectedGroupId(savedState.selectedGroupId);
				latestStateRef.current = {
					...latestStateRef.current,
					selectedGroupId: savedState.selectedGroupId,
				};
			}
			if (savedState && !isRegressiveSnapshot) {
				const savedShellKey = agentStateKey(savedState);
				const currentShellKey = agentStateKey(latestStateRef.current);
				if (savedShellKey !== currentShellKey) {
					latestStateRef.current = savedState;
					restoreSavedState(savedState);
					pendingSaveRef.current = false;
				}
			}
			if (pendingSaveRef.current) {
				return;
			}
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
			latestStateRef,
			mainViewRef,
			restoreSavedState,
			setAppearance,
			setLayoutMode,
			setMainView,
			setSelectedGroupId,
		],
	);
	useEffect(() => {
		return listenWindowEvent("agent-shell-change", handleShellChange);
	}, [handleShellChange]);
}
