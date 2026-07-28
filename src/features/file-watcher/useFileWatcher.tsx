import { useEffect, useRef } from "octane";
import type { DiffRequest } from "../../features/git/useGitDiff.tsx";
import { sendJson } from "../../lib/fetch-json.ts";
import { wsClient } from "../../lib/websocket.ts";

interface UseFileWatcherOptions {
	enabled: boolean;
	cwd: string | undefined;
	paneId: string | undefined;
	currentFile: string | undefined;
	diffReady: boolean;
	loadDiff: (req: DiffRequest) => void;
	setSelectedFile: (path: string, staged: boolean) => void;
	onDiffLoaded: () => void;
}

function isFileChangedMessage(
	msg: unknown
): msg is { type: "file:changed"; cwd: string; file: string } {
	return (
		!!msg &&
		typeof msg === "object" &&
		(msg as { type?: unknown }).type === "file:changed" &&
		typeof (msg as { cwd?: unknown }).cwd === "string" &&
		typeof (msg as { file?: unknown }).file === "string"
	);
}

export function useFileWatcher({
	enabled,
	cwd,
	paneId,
	currentFile,
	diffReady,
	loadDiff,
	setSelectedFile,
	onDiffLoaded,
}: UseFileWatcherOptions) {
	const pendingScrollRef = useRef(false);
	const enabledRef = useRef(enabled);
	const cwdRef = useRef(cwd);
	const currentFileRef = useRef(currentFile);
	const loadDiffRef = useRef(loadDiff);
	const setSelectedFileRef = useRef(setSelectedFile);
	const onDiffLoadedRef = useRef(onDiffLoaded);

	enabledRef.current = enabled;
	cwdRef.current = cwd;
	currentFileRef.current = currentFile;
	loadDiffRef.current = loadDiff;
	setSelectedFileRef.current = setSelectedFile;
	onDiffLoadedRef.current = onDiffLoaded;

	useEffect(() => {
		if (!enabled || !cwd) return;

		void sendJson("/api/git/watch", { cwd }, { method: "POST" });

		return () => {
			void sendJson("/api/git/unwatch", { cwd }, { method: "POST" });
		};
	}, [enabled, cwd]);

	useEffect(() => {
		if (!cwd || !paneId) return;

		let reloadTimer: ReturnType<typeof setTimeout> | undefined;

		const handleMessage = (msg: unknown) => {
			if (!enabledRef.current) return;
			if (!isFileChangedMessage(msg) || msg.cwd !== cwdRef.current) return;

			if (reloadTimer) {
				clearTimeout(reloadTimer);
			}

			reloadTimer = setTimeout(() => {
				reloadTimer = undefined;
				if (!enabledRef.current || !cwdRef.current) return;
				const changedFile = msg.file;
				pendingScrollRef.current = true;
				loadDiffRef.current({
					cwd: cwdRef.current,
					file: changedFile,
					staged: false,
				});
				if (currentFileRef.current !== changedFile) {
					setSelectedFileRef.current(changedFile, false);
				}
			}, 400);
		};

		const unsubscribe = wsClient.onMessage(handleMessage);

		return () => {
			if (reloadTimer) {
				clearTimeout(reloadTimer);
			}
			unsubscribe();
		};
	}, [cwd, paneId]);

	useEffect(() => {
		if (!diffReady || !pendingScrollRef.current) return;
		pendingScrollRef.current = false;
		onDiffLoadedRef.current();
	}, [diffReady]);
}
