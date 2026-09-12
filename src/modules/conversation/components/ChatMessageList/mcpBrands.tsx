import type { JSX } from "@solidjs/web";

/**
 * Brand marks for MCP servers, keyed by the `serverId` the native resolver
 * derives from the tool name (`mcp__claude_ai_Appllama__get_app` → `appllama`).
 *
 * No catalog can cover every server anyone installs, and it does not have to:
 * an unlisted server falls back to a monogram tinted from its own name, which
 * stays stable across the transcript. Adding a logo is one entry here, and the
 * monogram for that server disappears on its own.
 */
const MARKS: Record<string, () => JSX.Element> = {};

export function brandMark(serverId: string): (() => JSX.Element) | undefined {
	return MARKS[serverId];
}
