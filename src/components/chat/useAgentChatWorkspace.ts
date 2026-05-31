import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	loadPendingWorkspacePaths,
	savePendingWorkspacePaths,
} from "../../features/chat/chat-session-store.ts";

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
	const [pendingWorkspacePaths, setPendingWorkspacePathsState] = useState<
		string[]
	>(() => loadPendingWorkspacePaths(paneId));
	const pendingWorkspacePathsRef = useRef<string[]>(pendingWorkspacePaths);
	const activeWorkspace = useMemo<ActiveWorkspace>(
		() => ({
			cwd: cwd ?? optimisticWorkspace?.cwd ?? null,
			referencePaths:
				cwd != null
					? (referencePaths ?? [])
					: (optimisticWorkspace?.referencePaths ?? referencePaths ?? []),
		}),
		[cwd, optimisticWorkspace, referencePaths]
	);
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
