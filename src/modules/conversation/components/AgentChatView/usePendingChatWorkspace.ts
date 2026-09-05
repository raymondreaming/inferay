import { useCallback, useMemo, useRef, useState } from "octane";

import {
	loadPendingWorkspacePaths,
	savePendingWorkspacePaths,
} from "../../model/chat-session-store.ts";

export function usePendingChatWorkspace(
	paneId: string,
	cwd: string | undefined,
	onDirectoryChange:
		| ((paneId: string, cwd: string, referencePaths?: string[]) => void)
		| undefined,
) {
	const pendingWorkspacePathsRef = useRef<string[]>([]);
	const [pendingWorkspacePaths, setPendingWorkspacePaths] = useState(() =>
		loadPendingWorkspacePaths(paneId).filter(Boolean),
	);
	const visibleCwd = cwd ?? pendingWorkspacePaths[0];
	const cwdList = useMemo(() => (visibleCwd ? [visibleCwd] : []), [visibleCwd]);
	const clearPendingWorkspacePaths = useCallback(() => {
		pendingWorkspacePathsRef.current = [];
		setPendingWorkspacePaths([]);
		savePendingWorkspacePaths(paneId, []);
	}, [paneId]);
	const consumePendingWorkspace = useCallback(() => {
		const paths = (
			pendingWorkspacePathsRef.current.length > 0
				? pendingWorkspacePathsRef.current
				: loadPendingWorkspacePaths(paneId)
		).filter(Boolean);
		const selectedWorkspace =
			!cwd && paths.length > 0
				? { cwd: paths[0], referencePaths: paths.slice(1) }
				: undefined;
		if (selectedWorkspace?.cwd) {
			onDirectoryChange?.(
				paneId,
				selectedWorkspace.cwd,
				selectedWorkspace.referencePaths,
			);
			clearPendingWorkspacePaths();
		}
		return selectedWorkspace;
	}, [clearPendingWorkspacePaths, cwd, onDirectoryChange, paneId]);
	const savePendingWorkspaceSelection = useCallback(
		(paths: string[]) => {
			const nextPaths = paths.filter(Boolean);
			pendingWorkspacePathsRef.current = nextPaths;
			setPendingWorkspacePaths(nextPaths);
			savePendingWorkspacePaths(paneId, nextPaths);
		},
		[paneId],
	);

	return {
		consumePendingWorkspace,
		cwdList,
		savePendingWorkspaceSelection,
		visibleCwd,
	};
}
