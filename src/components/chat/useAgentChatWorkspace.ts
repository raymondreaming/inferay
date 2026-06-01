import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	loadPendingWorkspacePaths,
	loadStoredChatSession,
	savePendingWorkspacePaths,
} from "../../features/chat/chat-session-store.ts";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../lib/client-storage-sync.ts";
import { CHAT_SESSION_INDEX_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";

export interface ActiveWorkspace {
	cwd: string | null;
	referencePaths: string[];
}

interface UseAgentChatWorkspaceOptions {
	paneId: string;
	cwd?: string;
	referencePaths?: string[];
	onWorkspaceConsumed?: (
		paneId: string,
		cwd: string,
		referencePaths?: string[]
	) => void;
}

export function useAgentChatWorkspace({
	paneId,
	cwd,
	referencePaths,
	onWorkspaceConsumed,
}: UseAgentChatWorkspaceOptions) {
	const [optimisticWorkspace, setOptimisticWorkspace] =
		useState<ActiveWorkspace | null>(null);
	const [storedWorkspaceCwd, setStoredWorkspaceCwd] = useState<string | null>(
		() => loadStoredChatSession(paneId)?.cwd ?? null
	);
	const [pendingWorkspacePaths, setPendingWorkspacePathsState] = useState<
		string[]
	>(() => loadPendingWorkspacePaths(paneId));
	const pendingWorkspacePathsRef = useRef<string[]>(pendingWorkspacePaths);
	const activeWorkspace = useMemo<ActiveWorkspace>(() => {
		if (cwd != null) {
			return { cwd, referencePaths: referencePaths ?? [] };
		}
		if (optimisticWorkspace) {
			return optimisticWorkspace;
		}
		return {
			cwd: storedWorkspaceCwd,
			referencePaths: referencePaths ?? [],
		};
	}, [cwd, optimisticWorkspace, referencePaths, storedWorkspaceCwd]);
	const visibleWorkspace = useMemo<ActiveWorkspace>(() => {
		if (activeWorkspace.cwd || pendingWorkspacePaths.length === 0) {
			return activeWorkspace;
		}
		return {
			cwd: pendingWorkspacePaths[0] ?? null,
			referencePaths: pendingWorkspacePaths.slice(1),
		};
	}, [activeWorkspace, pendingWorkspacePaths]);
	const activeWorkspaceRef = useRef<ActiveWorkspace>(activeWorkspace);
	activeWorkspaceRef.current = activeWorkspace;

	useEffect(() => {
		if (cwd) setOptimisticWorkspace(null);
	}, [cwd]);
	useEffect(() => {
		setStoredWorkspaceCwd(loadStoredChatSession(paneId)?.cwd ?? null);
	}, [paneId]);
	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (key !== CHAT_SESSION_INDEX_STORAGE_KEY) return;
				setStoredWorkspaceCwd(loadStoredChatSession(paneId)?.cwd ?? null);
			}),
		[paneId]
	);

	const setPendingWorkspacePaths = useCallback(
		(paths: string[]) => {
			pendingWorkspacePathsRef.current = paths;
			setPendingWorkspacePathsState(paths);
			savePendingWorkspacePaths(paneId, paths);
		},
		[paneId]
	);

	const getPendingWorkspacePaths = useCallback(() => {
		const paths =
			pendingWorkspacePathsRef.current.length > 0
				? pendingWorkspacePathsRef.current
				: loadPendingWorkspacePaths(paneId);
		return paths.filter(Boolean);
	}, [paneId]);

	const clearPendingWorkspacePaths = useCallback(() => {
		setPendingWorkspacePaths([]);
	}, [setPendingWorkspacePaths]);

	const consumePendingWorkspace = useCallback(() => {
		const paths = getPendingWorkspacePaths();
		const selectedWorkspace =
			!activeWorkspaceRef.current.cwd && paths.length > 0
				? {
						cwd: paths[0]!,
						referencePaths: paths.slice(1),
					}
				: undefined;

		if (selectedWorkspace) {
			setOptimisticWorkspace(selectedWorkspace);
			activeWorkspaceRef.current = selectedWorkspace;
			onWorkspaceConsumed?.(
				paneId,
				selectedWorkspace.cwd,
				selectedWorkspace.referencePaths
			);
		}

		clearPendingWorkspacePaths();
		return selectedWorkspace;
	}, [
		clearPendingWorkspacePaths,
		getPendingWorkspacePaths,
		onWorkspaceConsumed,
		paneId,
	]);

	useEffect(() => {
		if (activeWorkspace.cwd && pendingWorkspacePathsRef.current.length > 0) {
			clearPendingWorkspacePaths();
		}
	}, [activeWorkspace.cwd, clearPendingWorkspacePaths]);

	return {
		activeWorkspace,
		visibleWorkspace,
		activeWorkspaceRef,
		setPendingWorkspacePaths,
		consumePendingWorkspace,
	};
}
