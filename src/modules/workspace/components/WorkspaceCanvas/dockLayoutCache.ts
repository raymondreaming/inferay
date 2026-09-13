import { project, readStoredJson } from "@shared/lib/native.tsx";
import type { DockTree } from "./dockTypes.ts";

export type DockRequest = {
	workspaceId: string;
	legacyWorkspaceId?: string;
	ids: string[];
	columns: number;
	mode: string;
	visibleColumns: number;
	action?: object;
};
export type DockLayout = {
	tree: DockTree | null;
	horizontal: number;
	vertical: number;
	saved: { tree: DockTree | null; preset: [string, number] };
};
const savedLayouts = new Map<string, DockLayout["saved"]>();
export function rememberDockLayout(workspaceId: string, layout: DockLayout) {
	savedLayouts.delete(workspaceId);
	savedLayouts.set(workspaceId, layout.saved);
	while (savedLayouts.size > 32)
		savedLayouts.delete(savedLayouts.keys().next().value!);
}
/** Use the same Rust model as the server before waiting for persistence. */
export function previewDockLayout(request: DockRequest): DockLayout {
	const read = (prefix: string, id?: string) =>
		id ? readStoredJson<unknown>(`${prefix}:${id}`, null) : null;
	const saved =
		savedLayouts.get(request.workspaceId) ??
		read("native-workspace-dock", request.workspaceId) ??
		read("native-workspace-dock", request.legacyWorkspaceId);
	const legacy =
		read("agent-workspace-dock", request.workspaceId) ??
		read("agent-workspace-dock", request.legacyWorkspaceId);
	return project("workspaceDock", { ...request, saved, legacy });
}
