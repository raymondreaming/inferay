export type RenderChatMessage = {
	id: string;
	role: "user" | "assistant" | "tool" | "system" | "btw";
	content: string;
	toolName?: string;
	isStreaming?: boolean;
	btwQuestion?: string;
	images?: string[];
};

export type RenderItem =
	| { type: "message"; message: RenderChatMessage }
	| { type: "edit-group"; filePath: string; edits: RenderChatMessage[] };

export function getEditFilePath(msg: RenderChatMessage): string | null {
	if (msg.role !== "tool" || msg.toolName !== "Edit" || !msg.content)
		return null;
	try {
		const parsed = JSON.parse(msg.content);
		return parsed.file_path || null;
	} catch {
		return null;
	}
}

export function buildRenderItems(messages: RenderChatMessage[]): RenderItem[] {
	const items: RenderItem[] = [];
	const filtered = messages.filter(
		(msg) =>
			!(
				msg.role === "tool" &&
				msg.toolName !== "AskUserQuestion" &&
				msg.toolName !== "Edit"
			)
	);
	const editGroups = new Map<
		number,
		{ filePath: string; edits: RenderChatMessage[]; lastIdx: number }
	>();
	const skipIndices = new Set<number>();

	for (let i = 0; i < filtered.length; i++) {
		if (skipIndices.has(i)) continue;
		const msg = filtered[i]!;
		const filePath = getEditFilePath(msg);
		if (!filePath) continue;
		const edits: RenderChatMessage[] = [msg];
		const editIndices: number[] = [i];
		let j = i + 1;

		while (j < filtered.length) {
			const nextMsg = filtered[j]!;
			const nextFilePath = getEditFilePath(nextMsg);
			if (nextFilePath === filePath) {
				edits.push(nextMsg);
				editIndices.push(j);
				j++;
			} else {
				break;
			}
		}

		if (edits.length > 1) {
			for (const idx of editIndices) skipIndices.add(idx);
			const lastEditIdx = editIndices[editIndices.length - 1]!;
			editGroups.set(lastEditIdx, { filePath, edits, lastIdx: lastEditIdx });
		}
	}

	for (let i = 0; i < filtered.length; i++) {
		const group = editGroups.get(i);
		if (group) {
			items.push({
				type: "edit-group",
				filePath: group.filePath,
				edits: group.edits,
			});
			continue;
		}
		if (skipIndices.has(i)) continue;
		items.push({ type: "message", message: filtered[i]! });
	}

	return items;
}
