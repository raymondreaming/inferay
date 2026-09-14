import type { DockLayout, DockRequest } from "@contracts";
import type { DockSession } from "@shared/lib/native.tsx";
import { readStoredJson } from "@shared/lib/native.tsx";

export function beginDockLayout(
	model: DockSession,
	request: DockRequest,
	deduplicate = false,
): { revision: number; layout?: DockLayout } | null {
	const read = (prefix: string, id?: string) =>
		id ? readStoredJson<unknown>(`${prefix}:${id}`, null) : null;
	const stored =
		read("native-workspace-dock", request.workspaceId) ??
		read("native-workspace-dock", request.legacyWorkspaceId);
	const legacy =
		read("agent-workspace-dock", request.workspaceId) ??
		read("agent-workspace-dock", request.legacyWorkspaceId);
	return JSON.parse(
		model.begin(
			JSON.stringify(request),
			stored === null ? undefined : JSON.stringify(stored),
			legacy === null ? undefined : JSON.stringify(legacy),
			deduplicate,
		),
	);
}
