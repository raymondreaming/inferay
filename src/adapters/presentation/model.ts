import wasmUrl from "../../../build/presentation/bytes.js";
import type { GitFilePresentation } from "../../../build/presentation/contracts/GitFilePresentation.ts";
import type { PanelSession } from "../../../build/presentation/contracts/PanelSession.ts";
import {
	initSync,
	presentation,
} from "../../../build/presentation/presentation.js";

// Both prerendering and the browser execute the same Rust models. Bundling the
// bytes also makes initialization independent of the desktop's loopback origin.
initSync({ module: Uint8Array.from(atob(wasmUrl), (c) => c.charCodeAt(0)) });

export function project<T>(operation: string, input: unknown): T {
	return JSON.parse(presentation(operation, JSON.stringify(input)));
}

export {
	ChatReplica,
	ease,
	LiquidBody,
	rounded_rect,
} from "../../../build/presentation/presentation.js";

export function adjacentGitFile<T>(
	files: readonly T[],
	isSelected: (file: T) => boolean,
	direction: -1 | 1,
	repeatBoundary = false,
): T | undefined {
	return (
		project<T | null>("adjacentFile", {
			files,
			current: files.findIndex(isSelected),
			direction,
			repeatBoundary,
		}) ?? undefined
	);
}
export function visibleGitFiles<T extends { path: string }>(
	files: readonly T[],
	presentation: GitFilePresentation | undefined,
	mode: "path" | "tree",
): T[] {
	return project("visibleFiles", { files, presentation, mode });
}
export function getFileSelectionAfterToggle<
	T extends { path: string; staged: boolean },
>(files: readonly T[], selected: { path: string; staged: boolean }): T | null {
	return project("selectionAfterToggle", { files, selected });
}
export function emptyGitWorkspacePanelSession(): PanelSession {
	return project("emptyPanels", null);
}
