import type { DocumentSession, FileContent } from "@contracts";
export type DocumentViewerProps = {
	readonly cwd: string;
	readonly sessionId?: string;
	readonly initialFile?: FileContent;
	readonly onClose: () => void;
	readonly onFileTabDragStart?: (
		event: PointerEvent,
		file: FileContent,
		completeMove: () => void,
	) => void;
	readonly draggable?: boolean;
	readonly onDragStart?: (event: PointerEvent) => void;
	readonly onDragEnd?: () => void;
	readonly openRequest?: {
		readonly path: string;
		readonly token: number;
	} | null;
	readonly workspaceId: string;
	readonly onSessionChange?: (
		sessionId: string,
		session: DocumentSession,
	) => void;
};
