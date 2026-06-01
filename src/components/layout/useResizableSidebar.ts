import {
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { CLIENT_STORAGE_CHANGED_EVENT } from "../../lib/client-storage-sync.ts";
import { MAIN_SIDEBAR_WIDTH_STORAGE_KEY } from "../../lib/client-storage-keys.ts";
import { listenWindowEvent } from "../../lib/react-events.ts";
import { readStoredValue, writeStoredValue } from "../../lib/stored-json.ts";

const DEFAULT_SIDEBAR_WIDTH = 192;
const MIN_SIDEBAR_WIDTH = 152;
const MAX_SIDEBAR_WIDTH = 340;

function loadSidebarWidth() {
	const stored = Number(readStoredValue(MAIN_SIDEBAR_WIDTH_STORAGE_KEY));
	return Number.isFinite(stored)
		? Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, stored))
		: DEFAULT_SIDEBAR_WIDTH;
}

export function useResizableSidebar() {
	const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
	const [resizing, setResizing] = useState(false);
	const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const resizeWidthRef = useRef(sidebarWidth);

	useEffect(
		() =>
			listenWindowEvent(CLIENT_STORAGE_CHANGED_EVENT, (event) => {
				const key = (event as CustomEvent<{ key?: string }>).detail?.key;
				if (key === MAIN_SIDEBAR_WIDTH_STORAGE_KEY) {
					setSidebarWidth(loadSidebarWidth());
				}
			}),
		[]
	);

	const handleResizeStart = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			setResizing(true);
			resizeWidthRef.current = sidebarWidth;
			resizeRef.current = { startX: event.clientX, startWidth: sidebarWidth };
			const handleMove = (moveEvent: MouseEvent) => {
				if (!resizeRef.current) return;
				const delta = moveEvent.clientX - resizeRef.current.startX;
				const nextWidth = Math.min(
					MAX_SIDEBAR_WIDTH,
					Math.max(MIN_SIDEBAR_WIDTH, resizeRef.current.startWidth + delta)
				);
				resizeWidthRef.current = nextWidth;
				setSidebarWidth(nextWidth);
			};
			const handleUp = () => {
				resizeRef.current = null;
				setResizing(false);
				writeStoredValue(
					MAIN_SIDEBAR_WIDTH_STORAGE_KEY,
					String(resizeWidthRef.current)
				);
				window.removeEventListener("mousemove", handleMove);
				window.removeEventListener("mouseup", handleUp);
			};
			window.addEventListener("mousemove", handleMove);
			window.addEventListener("mouseup", handleUp);
		},
		[sidebarWidth]
	);

	return { sidebarWidth, resizing, handleResizeStart };
}
