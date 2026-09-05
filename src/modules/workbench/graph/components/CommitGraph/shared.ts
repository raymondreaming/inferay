import type { GitGraphRef } from "../../../../repository/hooks/useGitGraph";
import type { GraphColumnKey } from "../../model/graph-model.ts";

export interface GraphSelectionIntent {
	additive: boolean;
	range: boolean;
}

export interface ColumnVisibility {
	author: boolean;
	sha: boolean;
	date: boolean;
}

export type ColumnKey = GraphColumnKey;

export interface ColumnWidths {
	date: number;
	refs: number;
	graph: number;
	message: number;
	author: number;
	sha: number;
}

export const ROW_HEIGHT = 23;

export const COLUMN_WIDTH = 18;

export const GRAPH_PADDING = 18;

export const TOOLS_WIDTH = 32;

export function hexToRgba(hex: string, alpha: number) {
	const c = hex.replace("#", "");
	const n =
		c.length === 3
			? c
					.split("")
					.map((ch) => `${ch}${ch}`)
					.join("")
			: c;
	return `rgba(${Number.parseInt(n.slice(0, 2), 16)}, ${Number.parseInt(n.slice(2, 4), 16)}, ${Number.parseInt(n.slice(4, 6), 16)}, ${alpha})`;
}

export function refPresentationLabel(ref: GitGraphRef): string {
	if (ref.kind !== "remoteBranch" || !ref.remoteName) return ref.displayName;
	const remotePrefix = `${ref.remoteName}/`;
	return ref.displayName.startsWith(remotePrefix)
		? ref.displayName.slice(remotePrefix.length)
		: ref.displayName;
}
export { AVATAR_SIZE } from "./styles.ts";
